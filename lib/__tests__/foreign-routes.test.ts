// Τα δύο routes που αντικαθιστούν την ΑΑΔΕ για ΞΕΝΟΥΣ εκδότες: VIES lookup και
// ανάλυση διεύθυνσης. Καλούνται ΑΠΕΥΘΕΙΑΣ ως handlers, με mocked rbac/fetch.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { rbac, db, cacheRows } = vi.hoisted(() => {
  // Η μνήμη geocoding ζει σε ένα Map: έτσι οι δοκιμές ελέγχουν ΠΡΑΓΜΑΤΙΚΗ
  // συμπεριφορά μνήμης (δεύτερη κλήση = καμία επίσκεψη στον πάροχο).
  const cacheRows = new Map<string, Record<string, unknown>>();
  return {
    cacheRows,
    rbac: { requirePermission: vi.fn(), hasPermission: vi.fn() },
    db: {
      vatCheck: { findFirst: vi.fn(async (): Promise<Record<string, unknown> | null> => null), create: vi.fn(async () => ({})), findMany: vi.fn(async () => []) },
      geocodeCache: {
        findUnique: vi.fn(async ({ where }: { where: { key: string } }) => cacheRows.get(where.key) ?? null),
        update: vi.fn(async () => null),
        upsert: vi.fn(async ({ where, create }: { where: { key: string }; create: Record<string, unknown> }) => {
          cacheRows.set(where.key, { ...create });
          return create;
        }),
      },
    },
  };
});
vi.mock('@/lib/rbac', () => rbac);
vi.mock('@/lib/db', () => ({ prisma: db }));

import { GET as vies } from '@/app/api/admin/vies/route';
import { POST as geocode } from '@/app/api/admin/geocode/route';
import { MISS_RETRY_DAYS } from '@/lib/geocode-cache';
import { resetViesStatusCache } from '@/lib/vat-check/vies';

const viesReq = (vat: string) =>
  new Request(`http://localhost/api/admin/vies?vat=${encodeURIComponent(vat)}`);
const post = (body: unknown) =>
  new Request('http://localhost/api/admin/geocode', { method: 'POST', body: JSON.stringify(body) });
const jsonRes = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  cacheRows.clear();
  rbac.requirePermission.mockResolvedValue({ id: 'u1', email: 'a@b.gr' });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('MAPTILER_API_KEY', '');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('GET /api/admin/vies — επίσημες δωρεάν αρχές (VIES / Brønnøysund / UID / HMRC)', () => {
  const STATUS = { vow: { available: true }, countries: [{ countryCode: 'DE', availability: 'Available' }, { countryCode: 'CY', availability: 'Available' }, { countryCode: 'FR', availability: 'Unavailable' }] };
  /** Δρομολόγηση ανά URL: το VIES ρωτά πρώτα `check-status`, μετά `check-vat-number`. */
  const route = (handlers: Record<string, () => unknown>) => fetchMock.mockImplementation(async (url: string) => {
    for (const [k, h] of Object.entries(handlers)) if (url.includes(k)) return h();
    throw new Error(`unexpected ${url}`);
  });
  const vatCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes('check-vat-number'));

  beforeEach(() => {
    resetViesStatusCache();
    vi.stubEnv('TAXID_API_KEY', '');
    vi.stubEnv('COMPANY_OWN_VAT', '');
    vi.stubEnv('HMRC_CLIENT_ID', '');
    db.vatCheck.findFirst.mockResolvedValue(null);
  });

  it('σπάει το id σε countryCode + vatNumber, επιστρέφει επωνυμία/διεύθυνση και γράφει ιστορικό', async () => {
    route({ 'check-status': () => jsonRes(STATUS), 'check-vat-number': () => jsonRes({ valid: true, name: 'MUSTER GMBH', address: 'Friedrichstr. 1\n10117 Berlin' }) });
    const res = await vies(viesReq('DE 144 960 040'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      vat: 'DE144960040', countryCode: 'DE', valid: true, provider: 'vies', source: 'VIES',
      name: 'MUSTER GMBH', address: 'Friedrichstr. 1, 10117 Berlin',
    });
    expect(JSON.parse(String((vatCalls()[0][1] as RequestInit).body))).toEqual({ countryCode: 'DE', vatNumber: '144960040' });
    expect(db.vatCheck.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ vat: 'DE144960040', valid: true, createdById: 'u1' }) }));
  });

  it('ιστορικό 30 ημερών: καμία κλήση· με force=1 ρωτά ξανά', async () => {
    db.vatCheck.findFirst.mockResolvedValue({ vat: 'CY10123456A', countryCode: 'CY', valid: true, name: 'X LTD', address: null, provider: 'vies', source: 'VIES', consultationNumber: 'WAPI1', createdAt: new Date('2026-10-10T10:00:00Z'), match: null, message: null });
    const body = await (await vies(viesReq('CY10123456A'))).json();
    expect(body).toMatchObject({ valid: true, cached: true, consultationNumber: 'WAPI1' });
    expect(fetchMock).not.toHaveBeenCalled();
    route({ 'check-status': () => jsonRes(STATUS), 'check-vat-number': () => jsonRes({ valid: true, name: 'X LTD' }) });
    await vies(new Request('http://localhost/api/admin/vies?vat=CY10123456A&force=1'));
    expect(vatCalls()).toHaveLength(1);
  });

  it('«---» (κρυμμένο από το κράτος-μέλος) γίνεται null, όχι κείμενο', async () => {
    route({ 'check-status': () => jsonRes(STATUS), 'check-vat-number': () => jsonRes({ valid: true, name: '---', address: '---' }) });
    expect(await (await vies(viesReq('CY10123456A'))).json()).toMatchObject({ valid: true, name: null, address: null });
  });

  it('άκυρο ΑΦΜ στο VIES → valid:false', async () => {
    route({ 'check-status': () => jsonRes(STATUS), 'check-vat-number': () => jsonRes({ valid: false, name: '', address: '' }) });
    expect(await (await vies(viesReq('CY99999999X'))).json()).toMatchObject({ valid: false, name: null, address: null });
  });

  it('κράτος εκτός λειτουργίας (check-status) → valid:null χωρίς κλήση ελέγχου', async () => {
    route({ 'check-status': () => jsonRes(STATUS) });
    expect(await (await vies(viesReq('FR12345678901'))).json()).toMatchObject({ valid: null, error: 'unavailable' });
    expect(vatCalls()).toHaveLength(0);
  });

  it('VAT_BLOCKED μέσα σε 200 → valid:null, blocked', async () => {
    route({ 'check-status': () => jsonRes(STATUS), 'check-vat-number': () => jsonRes({ actionSucceed: false, errorWrappers: [{ error: 'VAT_BLOCKED' }] }) });
    expect(await (await vies(viesReq('CY10123456A'))).json()).toMatchObject({ valid: null, error: 'blocked' });
  });

  it('δίκτυο κάτω → valid:null χωρίς exception (μετά τις επαναλήψεις)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      fetchMock.mockRejectedValue(new Error('ECONNRESET'));
      const p = vies(viesReq('CY10123456A'));
      await vi.runAllTimersAsync();
      const res = await p;
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ valid: null, error: 'network' });
    } finally { vi.useRealTimers(); }
  });

  it.each(['094073495', 'EL094073495', 'abc', ''])('ελληνικό/άκυρο id → χωρίς κλήση (%j)', async (vat) => {
    const res = await vies(viesReq(vat));
    expect((await res.json()).error).toBe('invalid_format');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Νορβηγία → Brønnøysund (δωρεάν, χωρίς κλειδί)', async () => {
    route({ 'data.brreg.no': () => jsonRes({ navn: 'NORSK AS', registrertIMvaregisteret: true }) });
    expect(await (await vies(viesReq('NO974760827'))).json()).toMatchObject({ valid: true, name: 'NORSK AS', provider: 'brreg' });
  });

  it('ΗΒ χωρίς HMRC: εφεδρεία taxid.dev μόνο αν υπάρχει κλειδί', async () => {
    expect(await (await vies(viesReq('GB553557881'))).json()).toMatchObject({ valid: null, error: 'not_configured' });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.stubEnv('TAXID_API_KEY', 'vat_test_key');
    route({ 'taxid.dev': () => jsonRes({ valid: true, company_name: 'UK LTD', source: 'HMRC' }) });
    const body = await (await vies(viesReq('GB553557881'))).json();
    expect(body).toMatchObject({ valid: true, name: 'UK LTD', provider: 'fallback' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://www.taxid.dev/api/v1/validate/GB/553557881');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer vat_test_key');
  });
});

describe('POST /api/admin/geocode', () => {
  it('επιστρέφει χώρα/πόλη/ΤΚ από τη διεύθυνση', async () => {
    fetchMock.mockResolvedValue(jsonRes([{
      display_name: 'Makariou 1, Λευκωσία, 1065, Κύπρος',
      address: { city: 'Λευκωσία', postcode: '1065', country: 'Κύπρος', country_code: 'cy' },
    }]));
    const res = await geocode(post({ address: 'Makariou 1, Nicosia', countryHint: 'CY' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      found: true, countryCode: 'CY', city: 'Λευκωσία', zip: '1065',
    });
  });

  it('χωρίς αποτέλεσμα → found:false (όχι 5xx)', async () => {
    fetchMock.mockResolvedValue(jsonRes([]));
    const res = await geocode(post({ address: 'ααα' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ found: false, cached: false });
  });

  it('επιστρέφει συντεταγμένες όταν τις δίνει ο πάροχος', async () => {
    fetchMock.mockResolvedValue(jsonRes([{
      display_name: 'Makariou 1', lat: '35.1721', lon: '33.3642',
      address: { city: 'Λευκωσία', country: 'Κύπρος', country_code: 'cy' },
    }]));
    expect(await (await geocode(post({ address: 'Makariou 1, Nicosia' }))).json())
      .toMatchObject({ found: true, lat: 35.1721, lng: 33.3642 });
  });

  it('η ΙΔΙΑ διεύθυνση ρωτά τον πάροχο ΜΙΑ φορά (quota)', async () => {
    fetchMock.mockResolvedValue(jsonRes([{
      display_name: 'Makariou 1', lat: '35.1721', lon: '33.3642',
      address: { city: 'Λευκωσία', country: 'Κύπρος', country_code: 'cy' },
    }]));
    const first = await (await geocode(post({ address: 'Makariou 1, Nicosia' }))).json();
    expect(first).toMatchObject({ found: true, cached: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Ίδια διεύθυνση με άλλα σημεία στίξης / πεζά-κεφαλαία = ΙΔΙΟ κλειδί.
    const second = await (await geocode(post({ address: 'MAKARIOU  1 -- nicosia.' }))).json();
    expect(second).toMatchObject({ found: true, cached: true, city: 'Λευκωσία', lat: 35.1721 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('θυμάται ΚΑΙ την αστοχία — μια άγνωστη διεύθυνση δεν ξαναρωτιέται', async () => {
    fetchMock.mockResolvedValue(jsonRes([]));
    expect(await (await geocode(post({ address: 'ααα βββ' }))).json())
      .toEqual({ found: false, cached: false });
    expect(await (await geocode(post({ address: 'ααα βββ' }))).json())
      .toEqual({ found: false, cached: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // ── Βλάβη του παρόχου ≠ «δεν βρέθηκε» ────────────────────────────────────────
  //
  // Το πιο επικίνδυνο σενάριο της ουράς: ο geocoder τρέχει ΑΥΤΟΜΑΤΑ σε κάθε άνοιγμα
  // εκδότη. Αν μια στιγμιαία βλάβη γραφόταν ως μόνιμη αστοχία, ένα λεπτό κακού
  // δικτύου θα άδειαζε χώρα/πόλη/ΤΚ/συντεταγμένες για ΚΑΘΕ εκδότη που ανοίχτηκε όσο
  // κρατούσε — χωρίς κανέναν τρόπο να διορθωθεί από την εφαρμογή.
  const outages: [string, () => void][] = [
    ['δίκτυο κάτω (TypeError: fetch failed)', () => fetchMock.mockRejectedValue(new TypeError('fetch failed'))],
    ['προθεσμία / abort', () => fetchMock.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }))],
    ['HTTP 429 (rate limit)', () => fetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) })],
    ['HTTP 500', () => fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })],
  ];

  it.each(outages)('%s → ΚΑΜΙΑ εγγραφή στη μνήμη', async (_label, arrange) => {
    arrange();
    const res = await geocode(post({ address: 'Makariou 1, Nicosia' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ found: false, cached: false, unavailable: true });
    expect(db.geocodeCache.upsert).not.toHaveBeenCalled();
    expect(cacheRows.size).toBe(0);
  });

  it.each(outages)('%s → η επόμενη κλήση ΞΑΝΑΡΩΤΑ τον πάροχο', async (_label, arrange) => {
    arrange();
    await geocode(post({ address: 'Makariou 1, Nicosia' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Ο πάροχος συνήλθε: η ίδια διεύθυνση πρέπει να λυθεί κανονικά, χωρίς χειρωνακτικό SQL.
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(jsonRes([{
      display_name: 'Makariou 1', lat: '35.1721', lon: '33.3642',
      address: { city: 'Λευκωσία', country: 'Κύπρος', country_code: 'cy' },
    }]));
    expect(await (await geocode(post({ address: 'Makariou 1, Nicosia' }))).json())
      .toMatchObject({ found: true, cached: false, city: 'Λευκωσία' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cacheRows.size).toBe(1);
  });

  it('η ΓΝΗΣΙΑ αστοχία γράφεται και ξαναχρησιμοποιείται (αντίθετα από τη βλάβη)', async () => {
    fetchMock.mockResolvedValue(jsonRes([]));
    expect(await (await geocode(post({ address: 'ααα βββ' }))).json())
      .toEqual({ found: false, cached: false });
    expect(db.geocodeCache.upsert).toHaveBeenCalledTimes(1);
    expect(cacheRows.size).toBe(1);
    expect([...cacheRows.values()][0]).toMatchObject({ found: false });

    expect(await (await geocode(post({ address: 'ααα βββ' }))).json())
      .toEqual({ found: false, cached: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('μια παλιά αστοχία ξαναρωτιέται μετά το παράθυρο επανελέγχου', async () => {
    fetchMock.mockResolvedValue(jsonRes([]));
    await geocode(post({ address: 'ααα βββ' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Γυρνάμε το ρολόι της εγγραφής πίσω πέρα από το παράθυρο.
    const [key, row] = [...cacheRows.entries()][0];
    cacheRows.set(key, { ...row, checkedAt: new Date(Date.now() - (MISS_RETRY_DAYS + 1) * 86_400_000) });

    fetchMock.mockResolvedValue(jsonRes([{
      display_name: 'ααα βββ', address: { city: 'Λευκωσία', country: 'Κύπρος', country_code: 'cy' },
    }]));
    expect(await (await geocode(post({ address: 'ααα βββ' }))).json())
      .toMatchObject({ found: true, cached: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('η ΕΠΙΤΥΧΙΑ δεν λήγει ποτέ, όσο παλιά κι αν είναι', async () => {
    fetchMock.mockResolvedValue(jsonRes([{
      display_name: 'Makariou 1', address: { city: 'Λευκωσία', country: 'Κύπρος', country_code: 'cy' },
    }]));
    await geocode(post({ address: 'Makariou 1' }));
    const [key, row] = [...cacheRows.entries()][0];
    cacheRows.set(key, { ...row, checkedAt: new Date(2000, 0, 1) });
    expect(await (await geocode(post({ address: 'Makariou 1' }))).json())
      .toMatchObject({ found: true, cached: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('δύο ταυτόχρονες κλήσεις για την ίδια διεύθυνση = ΜΙΑ κλήση στον πάροχο', async () => {
    fetchMock.mockResolvedValue(jsonRes([{
      display_name: 'Makariou 1', address: { city: 'Λευκωσία', country: 'Κύπρος', country_code: 'cy' },
    }]));
    const both = await Promise.all([
      geocode(post({ address: 'Makariou 1, Nicosia' })),
      geocode(post({ address: 'MAKARIOU 1 nicosia' })),
    ]);
    for (const r of both) expect((await r.json()).found).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('κενή / υπερμεγέθης διεύθυνση → 400 χωρίς κλήση παρόχου', async () => {
    for (const address of ['', 'x'.repeat(301)]) {
      const res = await geocode(post({ address }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('invalid_body');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('απορρίπτει countryHint που δεν είναι ISO-2', async () => {
    const res = await geocode(post({ address: 'Οδός 1', countryHint: 'Κύπρος' }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
