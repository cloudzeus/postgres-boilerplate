// MapTiler geocoding helpers. Uses MAPTILER_API_KEY from env.
// Docs: https://docs.maptiler.com/cloud/api/geocoding/
import { COUNTRY_NAMES_EL } from './countries';
import { validCoords } from './coords';
import { splitGluedAddress } from './ocr/address';

export { validCoords } from './coords';

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
  /** ISO-3166-1 alpha-2, κεφαλαία (π.χ. «CY») — `null` όταν δεν αναγνωρίστηκε. */
  countryCode: string | null;
  /** Όνομα χώρας όπως το δίνει ο πάροχος. */
  country: string;
  city: string | null;
  zip: string | null;
  /** Πλήρης διεύθυνση όπως την κανονικοποίησε ο πάροχος. */
  formatted: string;
  /**
   * Γεωγραφικό πλάτος / μήκος του αποτελέσματος — `null` όταν ο πάροχος δεν έδωσε
   * σημείο. Γράφονται στα `TRDR.LATITUDE` / `TRDR.LONGITUDE` του SoftOne, οπότε
   * ΠΟΤΕ δεν «στρογγυλοποιούνται» σε 0: άγνωστο σημαίνει `null`.
   */
  lat: number | null;
  lng: number | null;
}

/** Πόσο περιμένουμε τον geocoder πριν τα παρατήσουμε. Καμία επανάληψη. */
const GEOCODE_TIMEOUT_MS = 8_000;
/** Το Nominatim απαιτεί αναγνωρίσιμο User-Agent (usage policy). */
const NOMINATIM_UA = 'DGEspa-OCR/1.0 (gkozyris@i4ria.com)';

/**
 * Ο πάροχος **δεν απάντησε**: δίκτυο κάτω, προθεσμία, 429 (rate limit), 4xx/5xx,
 * ή σώμα που δεν είναι JSON.
 *
 * Είναι ΡΗΤΑ διαφορετικό από «ο πάροχος απάντησε ότι δεν ξέρει τη διεύθυνση».
 * Η μνήμη ({@link ../geocode-cache}) γράφει μόνο το δεύτερο: μια στιγμιαία
 * αστοχία δικτύου δεν επιτρέπεται να κλειδώσει μια διεύθυνση ως «δεν βρέθηκε».
 */
export class GeocodeUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'GeocodeUnavailableError';
  }
}

/**
 * `fetch` με προθεσμία. Πετάει {@link GeocodeUnavailableError} όταν ο πάροχος δεν
 * απάντησε — ΠΟΤΕ `null`: το `null` θα ήταν αδιάκριτο από «κανένα αποτέλεσμα».
 */
async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), GEOCODE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, cache: 'no-store', signal: ac.signal });
    // Κάθε non-2xx είναι «δεν απάντησε»: το 429 και το 5xx είναι προφανώς παροδικά,
    // αλλά και ένα 403 (λάθος/ληγμένο κλειδί) δεν λέει τίποτα για τη ΔΙΕΥΘΥΝΣΗ.
    if (!res.ok) throw new GeocodeUnavailableError(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    if (e instanceof GeocodeUnavailableError) throw e;
    throw new GeocodeUnavailableError((e as Error)?.message || 'fetch failed');
  } finally {
    clearTimeout(timer);
  }
}

const trimOrNull = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s || null;
};

/**
 * Ονόματα χωρών → ISO-3166-1 alpha-2, για όταν το MapTiler δίνει μόνο το
 * `text` της χώρας χωρίς `country_code`. Καλύπτει ΕΕ + ΕΟΧ στα ελληνικά
 * (από το {@link COUNTRY_NAMES_EL}), στα αγγλικά και στην εθνική γλώσσα.
 */
const COUNTRY_NAME_TO_ISO: Record<string, string> = {
  // Ελληνικά — από το μητρώο ονομάτων της εφαρμογής.
  ...Object.fromEntries(Object.entries(COUNTRY_NAMES_EL).map(([iso, name]) => [name.toLowerCase(), iso])),
  ελλας: 'GR', 'ηνωμενο βασιλειο': 'GB',
  // Αγγλικά
  greece: 'GR', austria: 'AT', belgium: 'BE', bulgaria: 'BG', cyprus: 'CY',
  czechia: 'CZ', 'czech republic': 'CZ', germany: 'DE', denmark: 'DK', estonia: 'EE',
  spain: 'ES', finland: 'FI', france: 'FR', croatia: 'HR', hungary: 'HU',
  ireland: 'IE', italy: 'IT', lithuania: 'LT', luxembourg: 'LU', latvia: 'LV',
  malta: 'MT', netherlands: 'NL', 'the netherlands': 'NL', poland: 'PL',
  portugal: 'PT', romania: 'RO', sweden: 'SE', slovenia: 'SI', slovakia: 'SK',
  'united kingdom': 'GB', switzerland: 'CH', norway: 'NO', iceland: 'IS',
  liechtenstein: 'LI', 'san marino': 'SM', monaco: 'MC',
  // Εθνικές ονομασίες
  ελλάδα: 'GR', österreich: 'AT', oesterreich: 'AT', belgië: 'BE', belgique: 'BE',
  българия: 'BG', κύπρος: 'CY', česko: 'CZ', 'česká republika': 'CZ',
  deutschland: 'DE', danmark: 'DK', eesti: 'EE', españa: 'ES', suomi: 'FI',
  hrvatska: 'HR', magyarország: 'HU', éire: 'IE', eire: 'IE', italia: 'IT',
  lietuva: 'LT', 'lëtzebuerg': 'LU', latvija: 'LV', nederland: 'NL',
  polska: 'PL', românia: 'RO', sverige: 'SE', slovenija: 'SI', slovensko: 'SK',
  schweiz: 'CH', suisse: 'CH', svizzera: 'CH', norge: 'NO', ísland: 'IS',
  island: 'IS', 'san marino / repubblica di san marino': 'SM',
};

/** «Deutschland» → «DE». Άγνωστο όνομα → `null`. */
function isoFromCountryName(name: string | null): string | null {
  if (!name) return null;
  return COUNTRY_NAME_TO_ISO[name.trim().toLowerCase()] ?? null;
}

/** Μια εγγραφή του MapTiler (context ή το ίδιο το feature) σε κοινή μορφή. */
type MapTilerEntry = { type: string; text: string | null; countryCode: string | null };

/**
 * MapTiler Geocoding → {@link AddressParts}.
 *
 * ΔΕΝ στέλνουμε `country=` χωρίς ρητό `countryHint`: όλο το νόημα της κλήσης
 * είναι να ΒΡΕΘΕΙ η χώρα του ξένου εκδότη.
 */
async function maptilerParts(q: string, key: string, countryHint?: string): Promise<AddressParts | null> {
  const params = new URLSearchParams({ key, limit: '1', language: 'el,en' });
  if (countryHint) params.set('country', countryHint.toLowerCase());
  const data = await fetchJson(
    `https://api.maptiler.com/geocoding/${encodeURIComponent(q)}.json?${params.toString()}`,
  );
  const f = data?.features?.[0];
  if (!f) return null;

  // Τα context entries πρώτα· το ίδιο το feature στο τέλος ως εφεδρεία —
  // ένα αποτέλεσμα μπορεί να ΕΙΝΑΙ ο Τ.Κ. ή η πόλη (`place_type`).
  const entries: MapTilerEntry[] = [];
  for (const c of Array.isArray(f.context) ? f.context : []) {
    const type = String(c?.id ?? '').split('.')[0];
    if (!type) continue;
    entries.push({
      type,
      text: trimOrNull(c?.text),
      countryCode: trimOrNull(c?.country_code) ?? trimOrNull(c?.properties?.country_code),
    });
  }
  for (const t of Array.isArray(f.place_type) ? f.place_type : []) {
    entries.push({
      type: String(t ?? ''),
      text: trimOrNull(f.text),
      countryCode: trimOrNull(f.properties?.country_code),
    });
  }

  // `center` του MapTiler είναι [lng, lat] — η σειρά είναι εύκολο να αντιστραφεί κατά λάθος.
  const center = Array.isArray(f.center) ? f.center : [];
  const coords = validCoords(center[1], center[0]);

  const pick = (...types: string[]) => entries.find((e) => types.includes(e.type));
  const country = pick('country');
  const countryCode =
    (trimOrNull(country?.countryCode) ?? isoFromCountryName(country?.text ?? null))?.toUpperCase() ?? null;

  return {
    countryCode,
    country: country?.text ?? countryCode ?? '',
    // Η «πόλη» έρχεται ως `place`, αλλά σε κάποιες χώρες ως `municipality`/`locality`.
    city: pick('place', 'municipality', 'locality')?.text ?? null,
    zip: pick('postal_code')?.text ?? null,
    formatted: trimOrNull(f.place_name) ?? q,
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
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
  const coords = validCoords(r.lat, r.lon);
  return {
    countryCode,
    country: trimOrNull(a.country) ?? countryCode,
    city: trimOrNull(a.city) ?? trimOrNull(a.town) ?? trimOrNull(a.village) ?? trimOrNull(a.municipality),
    zip: trimOrNull(a.postcode),
    formatted: trimOrNull(r.display_name) ?? q,
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
  };
}

/**
 * Το αποτέλεσμα του geocoder, με τις ΤΡΕΙΣ περιπτώσεις ξεχωριστές.
 *
 * Ο λόγος που δεν είναι απλώς `AddressParts | null`: το `null` έκρυβε μαζί
 * «ο πάροχος είπε ότι δεν υπάρχει τέτοια διεύθυνση» και «ο πάροχος δεν μίλησε».
 * Η πρώτη είναι απάντηση και αξίζει να μπει στη μνήμη· η δεύτερη είναι βλάβη και
 * ΔΕΝ πρέπει να γραφτεί πουθενά — αλλιώς ένα δευτερόλεπτο κακού δικτύου αφήνει
 * μια διεύθυνση σημειωμένη «δεν βρέθηκε» για πάντα.
 */
export type GeocodeOutcome =
  /** Ο πάροχος αναγνώρισε τη διεύθυνση. */
  | { status: 'match'; parts: AddressParts }
  /** Ο πάροχος ΑΠΑΝΤΗΣΕ και δεν έχει τέτοια διεύθυνση. Έγκυρη, μόνιμη απάντηση. */
  | { status: 'no_match'; parts: null }
  /** Ο πάροχος ΔΕΝ απάντησε (δίκτυο / προθεσμία / 429 / 5xx). Δεν ξέρουμε τίποτα. */
  | { status: 'unavailable'; parts: null; reason: string };

/**
 * Αναλύει μια ΕΛΕΥΘΕΡΗ διεύθυνση σε χώρα / πόλη / Τ.Κ.
 *
 * Πάροχος: **MapTiler** όταν υπάρχει `MAPTILER_API_KEY` (το ίδιο κλειδί που
 * χρησιμοποιεί ήδη η εφαρμογή για χάρτες), αλλιώς **Nominatim** (OpenStreetMap,
 * χωρίς κλειδί). Καμία επανάληψη, προθεσμία 8s και ΠΟΤΕ exception προς τον καλούντα:
 * μια βλάβη γυρίζει ως `status: 'unavailable'` — δες {@link GeocodeOutcome}.
 */
export async function geocodeAddressParts(
  q: string,
  opts: { countryHint?: string } = {},
): Promise<GeocodeOutcome> {
  // Το OCR ενώνει συχνά τις γραμμές της διεύθυνσης χωρίς διαχωριστικό
  // («…PlaceDublin 2Ireland»): κανένας πάροχος δεν το αναγνωρίζει έτσι.
  const query = splitGluedAddress(String(q ?? ''));
  // Κενή διεύθυνση: δεν υπάρχει τίποτα να ρωτηθεί — δεν είναι βλάβη.
  if (!query) return { status: 'no_match', parts: null };
  // Διαβάζεται εδώ (όχι module-level) ώστε να ακολουθεί το περιβάλλον εκτέλεσης.
  const key = process.env.MAPTILER_API_KEY ?? '';
  try {
    const parts = key
      ? await maptilerParts(query, key, opts.countryHint)
      : await nominatimParts(query, opts.countryHint);
    return parts ? { status: 'match', parts } : { status: 'no_match', parts: null };
  } catch (e) {
    const reason = (e as Error)?.message || 'unknown';
    console.warn('[geocode] ο πάροχος δεν απάντησε:', reason);
    return { status: 'unavailable', parts: null, reason };
  }
}
