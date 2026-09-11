// Τα δύο routes που αντικαθιστούν την ΑΑΔΕ για ΞΕΝΟΥΣ εκδότες: VIES lookup και
// ανάλυση διεύθυνσης. Καλούνται ΑΠΕΥΘΕΙΑΣ ως handlers, με mocked rbac/fetch.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { rbac } = vi.hoisted(() => ({ rbac: { requirePermission: vi.fn(), hasPermission: vi.fn() } }));
vi.mock('@/lib/rbac', () => rbac);

import { GET as vies } from '@/app/api/admin/vies/route';
import { POST as geocode } from '@/app/api/admin/geocode/route';

const viesReq = (vat: string) =>
  new Request(`http://localhost/api/admin/vies?vat=${encodeURIComponent(vat)}`);
const post = (body: unknown) =>
  new Request('http://localhost/api/admin/geocode', { method: 'POST', body: JSON.stringify(body) });
const jsonRes = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  rbac.requirePermission.mockResolvedValue({ id: 'u1', email: 'a@b.gr' });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('GOOGLE_GEOCODING_API_KEY', '');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('GET /api/admin/vies', () => {
  it('σπάει το id σε countryCode + vatNumber και επιστρέφει επωνυμία/διεύθυνση', async () => {
    fetchMock.mockResolvedValue(jsonRes({
      countryCode: 'DE', vatNumber: '144960040', valid: true,
      name: 'MUSTER GMBH', address: 'Friedrichstr. 1\n10117 Berlin',
    }));
    const res = await vies(viesReq('DE 144 960 040'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      vat: 'DE144960040', countryCode: 'DE', valid: true,
      name: 'MUSTER GMBH', address: 'Friedrichstr. 1 10117 Berlin',
    });
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)))
      .toEqual({ countryCode: 'DE', vatNumber: '144960040' });
  });

  it('«---» (κρυμμένο από το κράτος-μέλος) γίνεται null, όχι κείμενο', async () => {
    fetchMock.mockResolvedValue(jsonRes({ valid: true, name: '---', address: '---' }));
    const body = await (await vies(viesReq('CY10123456A'))).json();
    expect(body).toMatchObject({ valid: true, name: null, address: null });
  });

  it('άκυρο ΑΦΜ στο VIES → valid:false', async () => {
    fetchMock.mockResolvedValue(jsonRes({ valid: false, name: '', address: '' }));
    expect(await (await vies(viesReq('CY99999999X'))).json())
      .toMatchObject({ valid: false, name: null, address: null });
  });

  it('σφάλμα του VIES μέσα σε 200 → valid:null', async () => {
    fetchMock.mockResolvedValue(jsonRes({ userError: 'MS_UNAVAILABLE', valid: false }));
    expect(await (await vies(viesReq('CY10123456A'))).json())
      .toMatchObject({ valid: null, error: 'vies_error' });
  });

  it('δίκτυο κάτω → valid:null χωρίς exception', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    const res = await vies(viesReq('CY10123456A'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ valid: null, error: 'vies_unreachable' });
  });

  it.each(['094073495', 'EL094073495', 'NO974760827', 'abc', ''])(
    'δεν ρωτά το VIES για μη-ΕΕ/ελληνικό id (%j)', async (vat) => {
      const res = await vies(viesReq(vat));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('invalid_vat');
      expect(fetchMock).not.toHaveBeenCalled();
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
    expect(await res.json()).toEqual({ found: false });
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
