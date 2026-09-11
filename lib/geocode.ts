// MapTiler geocoding helpers. Uses MAPTILER_API_KEY from env.
// Docs: https://docs.maptiler.com/cloud/api/geocoding/

const MAPTILER_KEY = process.env.MAPTILER_API_KEY ?? '';

export type GeocodeResult = {
  lat: number;
  lng: number;
  formatted: string;
  country?: string;
  region?: string;
  city?: string;
  relevance?: number;
};

async function maptilerFetch(url: string): Promise<any> {
  if (!MAPTILER_KEY) throw new Error('MAPTILER_API_KEY is not configured');
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`MapTiler ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  return res.json();
}

export async function forwardGeocode(query: string, country = 'gr'): Promise<any> {
  const url = `https://api.maptiler.com/geocoding/${encodeURIComponent(query)}.json?key=${MAPTILER_KEY}&country=${country}&limit=1`;
  return maptilerFetch(url);
}

export async function reverseGeocode(lat: number, lng: number): Promise<any> {
  const url = `https://api.maptiler.com/geocoding/${lng},${lat}.json?key=${MAPTILER_KEY}`;
  return maptilerFetch(url);
}

/** High-level helper: builds a query from address parts and returns first match coords. */
export async function geocodeAddress(parts: {
  address?: string | null;
  city?: string | null;
  zip?: string | null;
  country?: string | null;
}): Promise<GeocodeResult | null> {
  if (!MAPTILER_KEY) return null;
  const query = [parts.address, parts.zip, parts.city, parts.country]
    .filter((v) => v && String(v).trim())
    .join(', ');
  if (!query.trim()) return null;
  try {
    const data = await forwardGeocode(query, (parts.country ?? 'GR').toLowerCase());
    const f = data?.features?.[0];
    if (!f?.center || f.center.length < 2) return null;
    const [lng, lat] = f.center;
    return {
      lat, lng,
      formatted: f.place_name ?? query,
      country: f.context?.find((c: any) => c.id?.startsWith('country'))?.text,
      region: f.context?.find((c: any) => c.id?.startsWith('region'))?.text,
      city: f.context?.find((c: any) => c.id?.startsWith('place'))?.text,
      relevance: f.relevance,
    };
  } catch {
    return null;
  }
}

/** Returns a MapTiler Static Maps URL for the given coordinates.
 *  Marker format per MapTiler docs: `markers=lng,lat,color` (color optional). */
export function staticMapUrl(opts: {
  lat: number; lng: number;
  zoom?: number; width?: number; height?: number;
  style?: 'streets-v2' | 'streets' | 'basic-v2' | 'bright-v2' | 'hybrid';
  marker?: boolean;
}): string {
  const { lat, lng, zoom = 15, width = 600, height = 320, style = 'streets-v2', marker = true } = opts;
  const params = new URLSearchParams();
  if (marker) params.set('markers', `${lng},${lat}`);
  params.set('key', MAPTILER_KEY);
  return `https://api.maptiler.com/maps/${style}/static/${lng},${lat},${zoom}/${width}x${height}@2x.png?${params.toString()}`;
}

// ============================================================
// Ανάλυση διεύθυνσης σε χώρα / πόλη / Τ.Κ.
// ============================================================

/**
 * Τα δομικά μέρη μιας διεύθυνσης όπως τα επιστρέφει ο geocoder.
 * Χρησιμοποιείται από την ουρά «Νέοι συναλλασσόμενοι» για να συμπληρωθούν
 * χώρα/πόλη/ΤΚ ενός ΞΕΝΟΥ εκδότη, όπου δεν υπάρχει μητρώο ΑΑΔΕ.
 */
export interface AddressParts {
  /** ISO-3166-1 alpha-2, κεφαλαία (π.χ. «CY»). */
  countryCode: string;
  /** Όνομα χώρας όπως το δίνει ο πάροχος. */
  country: string;
  city: string | null;
  zip: string | null;
  /** Πλήρης διεύθυνση όπως την κανονικοποίησε ο πάροχος. */
  formatted: string;
}

/** Πόσο περιμένουμε τον geocoder πριν τα παρατήσουμε. Καμία επανάληψη. */
const GEOCODE_TIMEOUT_MS = 8_000;
/** Το Nominatim απαιτεί αναγνωρίσιμο User-Agent (usage policy). */
const NOMINATIM_UA = 'DGEspa-OCR/1.0 (gkozyris@i4ria.com)';

/** `fetch` με προθεσμία — επιστρέφει `null` αντί να πετάξει. */
async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<any | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), GEOCODE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, cache: 'no-store', signal: ac.signal });
    if (!res.ok) {
      console.warn(`[geocode] HTTP ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn('[geocode] αποτυχία:', (e as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const trimOrNull = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s || null;
};

/** Google Geocoding API → {@link AddressParts}. */
async function googleParts(q: string, key: string, countryHint?: string): Promise<AddressParts | null> {
  const params = new URLSearchParams({ address: q, key, language: 'el' });
  if (countryHint) params.set('components', `country:${countryHint.toUpperCase()}`);
  const data = await fetchJson(`https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`);
  const r = data?.results?.[0];
  if (!r) return null;
  const comps: { long_name?: string; short_name?: string; types?: string[] }[] = r.address_components ?? [];
  const pick = (type: string) => comps.find((c) => c.types?.includes(type));
  const country = pick('country');
  const countryCode = String(country?.short_name ?? '').toUpperCase();
  if (!countryCode) return null;
  // `locality` λείπει σε αρκετές χώρες (UK/IE): το `postal_town` είναι το αντίστοιχο.
  const city = pick('locality') ?? pick('postal_town') ?? pick('administrative_area_level_3');
  return {
    countryCode,
    country: trimOrNull(country?.long_name) ?? countryCode,
    city: trimOrNull(city?.long_name),
    zip: trimOrNull(pick('postal_code')?.long_name),
    formatted: trimOrNull(r.formatted_address) ?? q,
  };
}

/** OpenStreetMap Nominatim → {@link AddressParts} (fallback χωρίς κλειδί). */
async function nominatimParts(q: string, countryHint?: string): Promise<AddressParts | null> {
  const params = new URLSearchParams({ format: 'jsonv2', addressdetails: '1', limit: '1', q });
  if (countryHint) params.set('countrycodes', countryHint.toLowerCase());
  const data = await fetchJson(
    `https://nominatim.openstreetmap.org/search?${params.toString()}`,
    { 'User-Agent': NOMINATIM_UA, 'Accept-Language': 'el,en' },
  );
  const r = Array.isArray(data) ? data[0] : null;
  const a = r?.address;
  if (!a) return null;
  const countryCode = String(a.country_code ?? '').toUpperCase();
  if (!countryCode) return null;
  return {
    countryCode,
    country: trimOrNull(a.country) ?? countryCode,
    city: trimOrNull(a.city) ?? trimOrNull(a.town) ?? trimOrNull(a.village) ?? trimOrNull(a.municipality),
    zip: trimOrNull(a.postcode),
    formatted: trimOrNull(r.display_name) ?? q,
  };
}

/**
 * Αναλύει μια ΕΛΕΥΘΕΡΗ διεύθυνση σε χώρα / πόλη / Τ.Κ.
 *
 * Πάροχος: Google Geocoding όταν υπάρχει `GOOGLE_GEOCODING_API_KEY` (ή το υπάρχον `GOOGLE_MAPS_API_KEY`), αλλιώς
 * Nominatim (OpenStreetMap, χωρίς κλειδί). Καμία επανάληψη, προθεσμία 8s και
 * ΠΟΤΕ exception προς το UI: μια αποτυχία είναι απλώς `null`.
 */
export async function geocodeAddressParts(
  q: string,
  opts: { countryHint?: string } = {},
): Promise<AddressParts | null> {
  const query = String(q ?? '').trim();
  if (!query) return null;
  const key = process.env.GOOGLE_GEOCODING_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';
  return key
    ? googleParts(query, key, opts.countryHint)
    : nominatimParts(query, opts.countryHint);
}
