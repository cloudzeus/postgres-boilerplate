import { describe, it, expect, beforeEach } from 'vitest';
import { checkVat, parseVatTarget, parseRequester, type VatCheckConfig } from '../index';
import { resetViesStatusCache } from '../vies';
import { resetHmrcToken } from '../hmrc';
import { validNorwegianOrgNr } from '../brreg';
import { parseUidOrganisation } from '../uid';

type Call = { url: string; init?: RequestInit };
/** Mock fetch: κάθε κλήση παίρνει την επόμενη απάντηση της λίστας που ταιριάζει στο URL. */
function mockFetch(routes: [RegExp, (() => Response) | Response[]][]) {
  const calls: Call[] = [];
  const queues = routes.map(([re, r]) => [re, Array.isArray(r) ? [...r] : r] as const);
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    for (const [re, r] of queues) {
      if (!re.test(url)) continue;
      if (typeof r === 'function') return r();
      const next = r.shift();
      if (next) return next;
    }
    throw new Error(`unexpected ${url}`);
  }) as unknown as typeof fetch;
  return { f, calls };
}
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
const STATUS_OK = () => json({ vow: { available: true }, countries: [{ countryCode: 'IT', availability: 'Available' }, { countryCode: 'DE', availability: 'Unavailable' }] });
const cfg = (f: typeof fetch, extra: Partial<VatCheckConfig> = {}): VatCheckConfig => ({ fetch: f, sleep: async () => {}, ...extra });

beforeEach(() => { resetViesStatusCache(); resetHmrcToken(); });

describe('parseVatTarget', () => {
  it('αναγνωρίζει αρχή και μορφή από ό,τι γράφει το χαρτί', () => {
    expect(parseVatTarget('VAT No: IT 01808880270')).toMatchObject({ countryCode: 'IT', number: '01808880270', provider: 'vies' });
    expect(parseVatTarget('CHE-116.281.710 MWST')).toMatchObject({ countryCode: 'CH', number: '116281710', vat: 'CHE116281710', provider: 'uid' });
    expect(parseVatTarget('NO 923 609 016 MVA')).toMatchObject({ countryCode: 'NO', number: '923609016', provider: 'brreg' });
    expect(parseVatTarget('GB 553 5578 81')).toMatchObject({ countryCode: 'GB', number: '553557881', provider: 'hmrc' });
    expect(parseVatTarget('UK553557881')?.countryCode).toBe('GB');
    expect(parseVatTarget('XI123456789')?.provider).toBe('vies');
    expect(parseVatTarget('GR094014201')?.countryCode).toBe('EL');
    expect(parseVatTarget('TR1234567890')?.provider).toBeNull();
    expect(parseVatTarget('123')).toBeNull();
  });
  it('αιτών: σκέτα 9 ψηφία = ελληνικός ΑΦΜ', () => {
    expect(parseRequester('094014201')).toEqual({ countryCode: 'EL', number: '094014201' });
    expect(parseRequester('EL094014201')).toEqual({ countryCode: 'EL', number: '094014201' });
    expect(parseRequester('')).toBeNull();
  });
});

describe('VIES', () => {
  it('ενεργό, με αριθμό ελέγχου και σύγκριση', async () => {
    const { f, calls } = mockFetch([
      [/check-status/, STATUS_OK],
      [/check-vat-number/, [json({ valid: true, name: 'BAT S.P.A.', address: 'VIA H FORD 4 \n30020 NOVENTA\n', requestIdentifier: 'WAPI123', requestDate: '2026-10-16T06:00:00Z', traderNameMatch: 'VALID', traderCityMatch: 'NOT_PROCESSED' })]],
    ]);
    const r = await checkVat('IT01808880270', cfg(f, { requesterVat: 'EL094014201' }), { name: 'BAT' });
    expect(r).toMatchObject({ valid: true, name: 'BAT S.P.A.', address: 'VIA H FORD 4, 30020 NOVENTA', consultationNumber: 'WAPI123', source: 'VIES' });
    expect(r.match).toMatchObject({ name: 'VALID' });
    const body = JSON.parse(String(calls[1].init?.body));
    expect(body).toMatchObject({ countryCode: 'IT', vatNumber: '01808880270', requesterMemberStateCode: 'EL', requesterNumber: '094014201', traderName: 'BAT' });
  });
  it('φόρτος: επανάληψη και επιτυχία', async () => {
    const { f, calls } = mockFetch([
      [/check-status/, STATUS_OK],
      [/check-vat-number/, [json({ actionSucceed: false, errorWrappers: [{ error: 'MS_MAX_CONCURRENT_REQ' }] }), json({ valid: false, name: '---' })]],
    ]);
    const r = await checkVat('IT00000000000', cfg(f));
    expect(r.valid).toBe(false);
    expect(r.name).toBeNull();
    expect(calls.filter((c) => /check-vat-number/.test(c.url))).toHaveLength(2);
  });
  it('κράτος εκτός λειτουργίας: καμία κλήση ελέγχου', async () => {
    const { f, calls } = mockFetch([[/check-status/, STATUS_OK]]);
    const r = await checkVat('DE123456789', cfg(f));
    expect(r).toMatchObject({ valid: null, error: 'unavailable' });
    expect(calls).toHaveLength(1);
  });
  it('μόνιμος φόρτος: rate_limited μετά τις επαναλήψεις', async () => {
    const busy = () => json({ actionSucceed: false, errorWrappers: [{ error: 'GLOBAL_MAX_CONCURRENT_REQ' }] });
    const { f } = mockFetch([[/check-status/, STATUS_OK], [/check-vat-number/, busy]]);
    expect((await checkVat('IT01808880270', cfg(f))).error).toBe('rate_limited');
  });
  it('λάθος ΑΦΜ αιτούντος: ξανά χωρίς αυτόν', async () => {
    const { f, calls } = mockFetch([
      [/check-status/, STATUS_OK],
      [/check-vat-number/, [json({ actionSucceed: false, errorWrappers: [{ error: 'VOW-ERR-2700' }] }, 400), json({ valid: true, name: 'X' })]],
    ]);
    const r = await checkVat('IT01808880270', cfg(f, { requesterVat: 'EL000000000' }));
    expect(r.valid).toBe(true);
    expect(JSON.parse(String(calls[2].init?.body))).not.toHaveProperty('requesterNumber');
  });
  it('μορφή εκτός προτύπου ⇒ invalid_format', async () => {
    const { f } = mockFetch([[/check-status/, STATUS_OK], [/check-vat-number/, [json({ errorWrappers: [{ error: 'VOW-ERR-2600' }] }, 400)]]]);
    expect((await checkVat('IT1', cfg(f))).error).toBe('invalid_format');
  });
});

describe('Νορβηγία (Brønnøysund)', () => {
  it('mod-11 του αριθμού οργανισμού', () => {
    expect(validNorwegianOrgNr('923609016')).toBe(true);
    expect(validNorwegianOrgNr('923609017')).toBe(false);
  });
  it('εγγεγραμμένο στο ΦΠΑ / όχι / ανύπαρκτο', async () => {
    const ok = mockFetch([[/brreg/, [json({ navn: 'EQUINOR ASA', registrertIMvaregisteret: true, forretningsadresse: { adresse: ['Forusbeen 50'], postnummer: '4035', poststed: 'STAVANGER', land: 'Norge' } })]]]);
    expect(await checkVat('NO923609016MVA', cfg(ok.f))).toMatchObject({ valid: true, name: 'EQUINOR ASA', address: 'Forusbeen 50, 4035 STAVANGER, Norge' });
    const noMva = mockFetch([[/brreg/, [json({ navn: 'X AS', registrertIMvaregisteret: false })]]]);
    expect((await checkVat('NO923609016', cfg(noMva.f))).valid).toBe(false);
    const missing = mockFetch([[/brreg/, [new Response('', { status: 404 })]]]);
    expect((await checkVat('NO923609016', cfg(missing.f))).valid).toBe(false);
  });
});

describe('Ελβετία (UID)', () => {
  const ORG = '<organisationName xmlns="x">Groupe TVA, Nestlé S.A.</organisationName><street>Avenue Nestlé</street><houseNumber>55</houseNumber><town>Vevey</town><swissZipCode>1800</swissZipCode><countryIdISO2>CH</countryIdISO2><vatStatus>2</vatStatus>';
  it('ανάλυση οργανισμού', () => {
    expect(parseUidOrganisation(ORG)).toEqual({ name: 'Groupe TVA, Nestlé S.A.', address: 'Avenue Nestlé 55, 1800 Vevey, CH', vatStatus: '2' });
  });
  it('ValidateVatNumber + GetByUID', async () => {
    const { f, calls } = mockFetch([[/uid-wse/, [
      new Response('<s:Envelope><s:Body><ValidateVatNumberResponse><ValidateVatNumberResult>true</ValidateVatNumberResult></ValidateVatNumberResponse></s:Body></s:Envelope>'),
      new Response(`<s:Envelope><s:Body>${ORG}</s:Body></s:Envelope>`),
    ]]]);
    const r = await checkVat('CHE-116.281.710 MWST', cfg(f));
    expect(r).toMatchObject({ valid: true, name: 'Groupe TVA, Nestlé S.A.', source: 'UID-Register' });
    expect(String(calls[0].init?.body)).toContain('CHE-116.281.710');
  });
});

describe('Ηνωμένο Βασίλειο (HMRC)', () => {
  it('χωρίς διαπιστευτήρια ⇒ not_configured, ή εφεδρεία αν υπάρχει', async () => {
    const { f } = mockFetch([]);
    expect((await checkVat('GB553557881', cfg(f))).error).toBe('not_configured');
    const fb = await checkVat('GB553557881', cfg(f, {
      fallback: async (t) => ({ vat: t.vat, countryCode: 'GB', valid: true, name: 'FB', address: null, provider: 'fallback', source: 'x', consultationNumber: null, checkedAt: '' }),
    }));
    expect(fb.name).toBe('FB');
  });
  it('OAuth + αναζήτηση με αριθμό ελέγχου· 404 ⇒ μη εγγεγραμμένο', async () => {
    const { f, calls } = mockFetch([
      [/oauth\/token/, [json({ access_token: 'tok', expires_in: 14400 })]],
      [/lookup\/553557881\/123456789/, [json({ target: { name: 'Credite Sberger Donal Inc.', vatNumber: '553557881', address: { line1: '131B Barton Hamlet', postcode: 'SW97 5CK', countryCode: 'GB' } }, consultationNumber: 'ypAeKRPlW', processingDate: '2019-01-31T12:53:05+00:00' })]],
      [/lookup\/111111111/, [json({ code: 'NOT_FOUND' }, 404)]],
    ]);
    const c = cfg(f, { hmrc: { clientId: 'id', clientSecret: 's', env: 'sandbox', requesterVrn: '123456789' } });
    const r = await checkVat('GB553557881', c);
    expect(r).toMatchObject({ valid: true, name: 'Credite Sberger Donal Inc.', consultationNumber: 'ypAeKRPlW', address: '131B Barton Hamlet, SW97 5CK, GB' });
    expect(calls[0].url).toContain('test-api.service.hmrc.gov.uk/oauth/token');
    expect((calls[1].init?.headers as Record<string, string>).Accept).toBe('application/vnd.hmrc.2.0+json');
    // Το token ξαναχρησιμοποιείται.
    expect((await checkVat('GB111111111', c)).valid).toBe(false);
    expect(calls.filter((x) => /oauth/.test(x.url))).toHaveLength(1);
  });
});
