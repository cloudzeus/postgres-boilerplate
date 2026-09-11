// Ο geocoder της ουράς «Νέοι συναλλασσόμενοι»: και οι δύο πάροχοι με mocked
// `fetch`, ώστε καμία δοκιμή να μη βγαίνει στο δίκτυο.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { geocodeAddressParts } from '../geocode';

const GOOGLE_OK = {
  results: [{
    formatted_address: 'Leof. Archiepiskopou Makariou III 1, Lefkosia 1065, Cyprus',
    address_components: [
      { long_name: '1', short_name: '1', types: ['street_number'] },
      { long_name: 'Lefkosia', short_name: 'Lefkosia', types: ['locality', 'political'] },
      { long_name: 'Cyprus', short_name: 'CY', types: ['country', 'political'] },
      { long_name: '1065', short_name: '1065', types: ['postal_code'] },
    ],
  }],
};

const NOMINATIM_OK = [{
  display_name: 'Friedrichstraße 1, Mitte, Berlin, 10117, Deutschland',
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
  vi.stubEnv('GOOGLE_GEOCODING_API_KEY', '');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('geocodeAddressParts — Google (με κλειδί)', () => {
  beforeEach(() => vi.stubEnv('GOOGLE_GEOCODING_API_KEY', 'test-key'));

  it('βγάζει χώρα / πόλη / ΤΚ από τα address_components', async () => {
    fetchMock.mockResolvedValue(jsonRes(GOOGLE_OK));
    await expect(geocodeAddressParts('Makariou 1, Nicosia')).resolves.toEqual({
      countryCode: 'CY',
      country: 'Cyprus',
      city: 'Lefkosia',
      zip: '1065',
      formatted: 'Leof. Archiepiskopou Makariou III 1, Lefkosia 1065, Cyprus',
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain('maps.googleapis.com');
  });

  it('δέχεται postal_town όταν λείπει το locality', async () => {
    fetchMock.mockResolvedValue(jsonRes({ results: [{
      formatted_address: 'London EC1A, UK',
      address_components: [
        { long_name: 'London', short_name: 'London', types: ['postal_town'] },
        { long_name: 'United Kingdom', short_name: 'GB', types: ['country'] },
      ],
    }] }));
    const r = await geocodeAddressParts('EC1A, London');
    expect(r).toMatchObject({ countryCode: 'GB', city: 'London', zip: null });
  });

  it('περνά το countryHint ως components=country:…', async () => {
    fetchMock.mockResolvedValue(jsonRes(GOOGLE_OK));
    await geocodeAddressParts('Makariou 1', { countryHint: 'cy' });
    expect(String(fetchMock.mock.calls[0][0])).toContain('components=country%3ACY');
  });

  it('κανένα αποτέλεσμα → null', async () => {
    fetchMock.mockResolvedValue(jsonRes({ results: [], status: 'ZERO_RESULTS' }));
    await expect(geocodeAddressParts('—')).resolves.toBeNull();
  });
});

describe('geocodeAddressParts — Nominatim (χωρίς κλειδί)', () => {
  it('βγάζει χώρα / πόλη / ΤΚ από το address object', async () => {
    fetchMock.mockResolvedValue(jsonRes(NOMINATIM_OK));
    await expect(geocodeAddressParts('Friedrichstraße 1, Berlin')).resolves.toEqual({
      countryCode: 'DE',
      country: 'Deutschland',
      city: 'Berlin',
      zip: '10117',
      formatted: 'Friedrichstraße 1, Mitte, Berlin, 10117, Deutschland',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('nominatim.openstreetmap.org');
    expect((init as RequestInit).headers).toMatchObject({ 'User-Agent': expect.stringContaining('DGEspa-OCR') });
  });

  it('πέφτει σε town/village όταν λείπει το city', async () => {
    fetchMock.mockResolvedValue(jsonRes([{
      display_name: 'X', address: { village: 'Χωριό', country: 'Ελλάδα', country_code: 'gr' },
    }]));
    expect((await geocodeAddressParts('X'))?.city).toBe('Χωριό');
  });

  it('άδειο αποτέλεσμα → null', async () => {
    fetchMock.mockResolvedValue(jsonRes([]));
    await expect(geocodeAddressParts('X')).resolves.toBeNull();
  });
});

describe('geocodeAddressParts — αποτυχίες δεν φτάνουν ΠΟΤΕ στο UI', () => {
  it('timeout / abort → null', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
    await expect(geocodeAddressParts('Οδός 1')).resolves.toBeNull();
  });
  it('HTTP 500 → null', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    await expect(geocodeAddressParts('Οδός 1')).resolves.toBeNull();
  });
  it('κενή διεύθυνση δεν χτυπά καν τον πάροχο', async () => {
    await expect(geocodeAddressParts('   ')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
