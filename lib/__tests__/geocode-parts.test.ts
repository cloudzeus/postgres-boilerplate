// Ο geocoder της ουράς «Νέοι συναλλασσόμενοι»: και οι δύο πάροχοι με mocked
// `fetch`, ώστε καμία δοκιμή να μη βγαίνει στο δίκτυο.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { geocodeAddressParts, validCoords, type GeocodeOutcome } from '../geocode';

/** Τα μέρη μιας επιτυχίας — πετάει αν ο geocoder δεν είπε `match`. */
const partsOf = async (p: Promise<GeocodeOutcome>) => {
  const r = await p;
  expect(r.status).toBe('match');
  return r.parts;
};

/** Τυπική απάντηση MapTiler: το feature είναι διεύθυνση, τα υπόλοιπα στο `context`. */
const MAPTILER_OK = {
  features: [{
    place_name: 'Friedrichstraße 1, 10117 Berlin, Deutschland',
    place_type: ['address'],
    // MapTiler δίνει [lng, lat] — η σειρά ελέγχεται ρητά παρακάτω.
    center: [13.3888, 52.517],
    text: 'Friedrichstraße',
    context: [
      { id: 'postal_code.123', text: '10117' },
      { id: 'place.456', text: 'Berlin' },
      { id: 'region.789', text: 'Berlin' },
      { id: 'country.14', text: 'Deutschland', country_code: 'de' },
    ],
  }],
};

const NOMINATIM_OK = [{
  display_name: 'Friedrichstraße 1, Mitte, Berlin, 10117, Deutschland',
  lat: '52.517', lon: '13.3888',
  address: {
    road: 'Friedrichstraße', suburb: 'Mitte', city: 'Berlin',
    postcode: '10117', country: 'Deutschland', country_code: 'de',
  },
}];

const jsonRes = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('MAPTILER_API_KEY', '');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('geocodeAddressParts — MapTiler (με κλειδί)', () => {
  beforeEach(() => vi.stubEnv('MAPTILER_API_KEY', 'test-key'));

  it('βγάζει χώρα / πόλη / ΤΚ από το context', async () => {
    fetchMock.mockResolvedValue(jsonRes(MAPTILER_OK));
    await expect(partsOf(geocodeAddressParts('Friedrichstraße 1, Berlin'))).resolves.toEqual({
      countryCode: 'DE',
      country: 'Deutschland',
      city: 'Berlin',
      zip: '10117',
      formatted: 'Friedrichstraße 1, 10117 Berlin, Deutschland',
      lat: 52.517,
      lng: 13.3888,
    });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('api.maptiler.com/geocoding/');
    expect(url).toContain('key=test-key');
    expect(url).toContain('limit=1');
  });

  it('ΔΕΝ περιορίζει σε χώρα χωρίς ρητό countryHint (εκεί είναι όλο το νόημα)', async () => {
    fetchMock.mockResolvedValue(jsonRes(MAPTILER_OK));
    await geocodeAddressParts('Friedrichstraße 1, Berlin');
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('country=');
  });

  it('περνά το countryHint ως country=…', async () => {
    fetchMock.mockResolvedValue(jsonRes(MAPTILER_OK));
    await geocodeAddressParts('Friedrichstraße 1', { countryHint: 'DE' });
    expect(String(fetchMock.mock.calls[0][0])).toContain('country=de');
  });

  it('δέχεται το ίδιο το feature όταν αυτό είναι ο Τ.Κ. / η πόλη', async () => {
    fetchMock.mockResolvedValue(jsonRes({ features: [{
      place_name: '1065, Λευκωσία, Κύπρος',
      place_type: ['postal_code'],
      text: '1065',
      context: [
        { id: 'place.1', text: 'Λευκωσία' },
        { id: 'country.2', text: 'Κύπρος', country_code: 'cy' },
      ],
    }] }));
    await expect(partsOf(geocodeAddressParts('1065 Nicosia'))).resolves.toMatchObject({
      countryCode: 'CY', city: 'Λευκωσία', zip: '1065',
    });
  });

  it('βρίσκει τον ISO κωδικό από το όνομα της χώρας όταν λείπει το country_code', async () => {
    fetchMock.mockResolvedValue(jsonRes({ features: [{
      place_name: 'Dublin 2, Ireland',
      place_type: ['place'],
      text: 'Dublin',
      context: [{ id: 'country.9', text: 'Ireland' }],
    }] }));
    await expect(partsOf(geocodeAddressParts('Dublin 2'))).resolves.toMatchObject({
      countryCode: 'IE', country: 'Ireland', city: 'Dublin',
    });
  });

  it('άγνωστη χώρα → countryCode null (όχι σκουπίδια), τα υπόλοιπα πεδία μένουν', async () => {
    fetchMock.mockResolvedValue(jsonRes({ features: [{
      place_name: 'Kalamazoo',
      place_type: ['place'],
      text: 'Kalamazoo',
      context: [{ id: 'country.9', text: 'Ουτοπία' }],
    }] }));
    await expect(partsOf(geocodeAddressParts('Kalamazoo'))).resolves.toMatchObject({
      countryCode: null, city: 'Kalamazoo',
    });
  });

  it('σπάει τις κολλημένες γραμμές του OCR πριν ρωτήσει τον πάροχο', async () => {
    fetchMock.mockResolvedValue(jsonRes(MAPTILER_OK));
    await geocodeAddressParts('VelascoClanwilliam PlaceDublin 2Ireland');
    expect(decodeURIComponent(String(fetchMock.mock.calls[0][0])))
      .toContain('Velasco, Clanwilliam Place, Dublin 2, Ireland');
  });

  it('κανένα feature → no_match (ο πάροχος ΑΠΑΝΤΗΣΕ)', async () => {
    fetchMock.mockResolvedValue(jsonRes({ features: [] }));
    await expect(geocodeAddressParts('—')).resolves.toEqual({ status: 'no_match', parts: null });
  });
});

describe('geocodeAddressParts — Nominatim (χωρίς κλειδί)', () => {
  it('βγάζει χώρα / πόλη / ΤΚ από το address object', async () => {
    fetchMock.mockResolvedValue(jsonRes(NOMINATIM_OK));
    await expect(partsOf(geocodeAddressParts('Friedrichstraße 1, Berlin'))).resolves.toEqual({
      countryCode: 'DE',
      country: 'Deutschland',
      city: 'Berlin',
      zip: '10117',
      formatted: 'Friedrichstraße 1, Mitte, Berlin, 10117, Deutschland',
      lat: 52.517,
      lng: 13.3888,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('nominatim.openstreetmap.org');
    expect((init as RequestInit).headers).toMatchObject({ 'User-Agent': expect.stringContaining('DGEspa-OCR') });
  });

  it('πέφτει σε town/village όταν λείπει το city', async () => {
    fetchMock.mockResolvedValue(jsonRes([{
      display_name: 'X', address: { village: 'Χωριό', country: 'Ελλάδα', country_code: 'gr' },
    }]));
    expect((await geocodeAddressParts('X')).parts?.city).toBe('Χωριό');
  });

  it('άδειο αποτέλεσμα → no_match', async () => {
    fetchMock.mockResolvedValue(jsonRes([]));
    await expect(geocodeAddressParts('X')).resolves.toEqual({ status: 'no_match', parts: null });
  });
});

// Η κρίσιμη διάκριση: «ο πάροχος είπε όχι» ≠ «ο πάροχος δεν μίλησε». Το δεύτερο
// ΔΕΝ επιτρέπεται να γραφτεί στη μνήμη ως μόνιμη αστοχία — δες `geocode-cache`.
describe('geocodeAddressParts — βλάβη ≠ «δεν βρέθηκε»', () => {
  it('timeout / abort → unavailable (MapTiler)', async () => {
    vi.stubEnv('MAPTILER_API_KEY', 'test-key');
    fetchMock.mockRejectedValue(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
    await expect(geocodeAddressParts('Οδός 1')).resolves.toMatchObject({ status: 'unavailable', parts: null });
  });
  it('timeout / abort → unavailable (Nominatim)', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
    await expect(geocodeAddressParts('Οδός 1')).resolves.toMatchObject({ status: 'unavailable' });
  });
  it('«fetch failed» (δίκτυο κάτω) → unavailable', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(geocodeAddressParts('Οδός 1')).resolves.toMatchObject({ status: 'unavailable', reason: 'fetch failed' });
  });
  it.each([429, 500, 502, 403])('HTTP %i → unavailable, ΟΧΙ no_match', async (status) => {
    fetchMock.mockResolvedValue({ ok: false, status, json: async () => ({}) });
    await expect(geocodeAddressParts('Οδός 1')).resolves.toMatchObject({
      status: 'unavailable', reason: `HTTP ${status}`,
    });
  });
  it('χαλασμένο JSON σε 200 → unavailable', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } });
    await expect(geocodeAddressParts('Οδός 1')).resolves.toMatchObject({ status: 'unavailable' });
  });
  it('καμία αποτυχία δεν φτάνει ως exception στον καλούντα', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(geocodeAddressParts('Οδός 1')).resolves.toBeDefined();
  });
  it('κενή διεύθυνση δεν χτυπά καν τον πάροχο (no_match, όχι βλάβη)', async () => {
    await expect(geocodeAddressParts('   ')).resolves.toEqual({ status: 'no_match', parts: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('συντεταγμένες', () => {
  it('MapTiler: το center είναι [lng, lat] και ΔΕΝ αντιστρέφεται', async () => {
    vi.stubEnv('MAPTILER_API_KEY', 'test-key');
    fetchMock.mockResolvedValue(jsonRes(MAPTILER_OK));
    const r = (await geocodeAddressParts('Friedrichstraße 1, Berlin')).parts;
    expect(r?.lat).toBe(52.517);
    expect(r?.lng).toBe(13.3888);
  });

  it('χωρίς center → null, όχι 0 (το 0 θα γραφόταν στο SoftOne ως πραγματικό σημείο)', async () => {
    vi.stubEnv('MAPTILER_API_KEY', 'test-key');
    fetchMock.mockResolvedValue(jsonRes({ features: [{ ...MAPTILER_OK.features[0], center: undefined }] }));
    const r = (await geocodeAddressParts('Friedrichstraße 1, Berlin')).parts;
    expect(r?.lat).toBeNull();
    expect(r?.lng).toBeNull();
  });

  it('validCoords απορρίπτει (0,0), εκτός ορίων και μη αριθμούς', () => {
    expect(validCoords(52.517, 13.3888)).toEqual({ lat: 52.517, lng: 13.3888 });
    expect(validCoords(0, 0)).toBeNull();
    expect(validCoords(91, 0)).toBeNull();
    expect(validCoords(0, 181)).toBeNull();
    expect(validCoords(null, undefined)).toBeNull();
    expect(validCoords('abc', 'def')).toBeNull();
    // Το 0 σε ΜΙΑ μόνο συντεταγμένη είναι έγκυρο (ισημερινός / Γκρίνουιτς).
    expect(validCoords(0, 13.3888)).toEqual({ lat: 0, lng: 13.3888 });
  });
});
