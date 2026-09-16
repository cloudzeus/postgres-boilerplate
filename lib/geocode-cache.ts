// Μνήμη geocoding: μια διεύθυνση κοστίζει ΜΙΑ κλήση στον πάροχο.
//
// Το MapTiler είναι ΜΕΤΡΗΜΕΝΟ (quota ανά κλήση). Η ουρά «Νέοι συναλλασσόμενοι»
// πλέον ρωτά τον geocoder ΑΥΤΟΜΑΤΑ όταν ανοίγει ένας εκδότης — χωρίς μνήμη αυτό θα
// σήμαινε μια κλήση σε κάθε άνοιγμα, σε κάθε refresh της λίστας, σε κάθε re-render.
// Εδώ η ΑΠΑΝΤΗΣΗ του παρόχου γράφεται μια φορά και ξαναδιαβάζεται από τη βάση.
//
// «Απάντηση» σημαίνει και «δεν υπάρχει τέτοια διεύθυνση»: κι αυτή καίει quota, άρα
// αποθηκεύεται. ΔΕΝ σημαίνει «ο πάροχος δεν μίλησε» — μια βλάβη δικτύου, ένα 429 ή
// ένα 5xx δεν γράφονται ΠΟΤΕ, γιατί αλλιώς ένα δευτερόλεπτο κακού δικτύου θα άδειαζε
// χώρα/πόλη/ΤΚ/συντεταγμένες για κάθε εκδότη που ανοίχτηκε όσο κρατούσε.
import { prisma } from '@/lib/db';
import { geocodeAddressParts, type AddressParts } from '@/lib/geocode';
import { splitGluedAddress } from '@/lib/ocr/address';

/**
 * Το κλειδί της μνήμης: κανονικοποιημένη διεύθυνση (+ country hint όταν υπάρχει).
 *
 * Κανονικοποίηση: το ίδιο «σπάσιμο» κολλημένων γραμμών που κάνει και ο geocoder,
 * μετά πεζά, χωρίς τόνους, χωρίς σημεία στίξης, με ένα κενό ανάμεσα στις λέξεις.
 * Έτσι «ΛΕΩΦ. ΚΗΦΙΣΙΑΣ 12, Αθήνα» και «Λεωφ Κηφισίας 12 Αθήνα» είναι Η ΙΔΙΑ
 * διεύθυνση και ρωτιούνται μία φορά συνολικά.
 *
 * Το `countryHint` ΜΠΑΙΝΕΙ στο κλειδί επίτηδες: με hint ο πάροχος ρωτιέται
 * περιορισμένος σε μια χώρα και μπορεί να δώσει άλλο αποτέλεσμα. Η ίδια οδός με
 * δύο διαφορετικά hint είναι επομένως δύο εγγραφές — δύο κλήσεις συνολικά.
 */
export function geocodeCacheKey(address: string, countryHint?: string | null): string {
  const norm = splitGluedAddress(String(address ?? ''))
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  const hint = String(countryHint ?? '').trim().toUpperCase();
  return hint ? `${hint}|${norm}` : norm;
}

/** Ό,τι γυρίζει η μνήμη: τα μέρη της διεύθυνσης + από πού ήρθαν. */
export interface CachedGeocode {
  found: boolean;
  parts: AddressParts | null;
  /** `true` = διαβάστηκε από τη βάση, καμία κλήση στον πάροχο (καμία χρέωση). */
  cached: boolean;
  /**
   * `true` = ο πάροχος ΔΕΝ απάντησε (δίκτυο / προθεσμία / 429 / 5xx). Τίποτα δεν
   * γράφτηκε στη μνήμη· η επόμενη κλήση για την ίδια διεύθυνση ξαναρωτά. Το UI
   * οφείλει να το πει αλλιώς από ένα ειλικρινές «δεν βρέθηκε».
   */
  unavailable?: boolean;
}

const MISS: AddressParts | null = null;

/**
 * Παράθυρο επανελέγχου για τις ΑΣΤΟΧΙΕΣ (`found: false`).
 *
 * Μια καταγεγραμμένη αστοχία είναι έγκυρη απάντηση, αλλά όχι αιώνια αλήθεια: τα
 * δεδομένα του παρόχου βελτιώνονται (ένας καινούργιος δρόμος μπαίνει στο OSM),
 * και — πιο πρακτικά — εγγραφές που γράφτηκαν πριν από αυτή τη διόρθωση μπορεί να
 * είναι δηλητηριασμένες από παροδική βλάβη. Μετά από τόσες μέρες η διεύθυνση
 * ξαναρωτιέται ΜΙΑ φορά. Οι επιτυχίες δεν λήγουν ποτέ.
 */
export const MISS_RETRY_DAYS = 7;
const MISS_RETRY_MS = MISS_RETRY_DAYS * 24 * 60 * 60 * 1000;

/** Έληξε το παράθυρο επανελέγχου αυτής της αστοχίας; */
function missExpired(checkedAt: Date | null | undefined, now = Date.now()): boolean {
  const t = checkedAt ? new Date(checkedAt).getTime() : NaN;
  if (!Number.isFinite(t)) return true;
  return now - t >= MISS_RETRY_MS;
}

/** Η γραμμή της βάσης σε {@link AddressParts}. */
function rowToParts(r: {
  countryCode: string | null; country: string | null; city: string | null;
  zip: string | null; formatted: string | null; lat: number | null; lng: number | null;
}): AddressParts {
  return {
    countryCode: r.countryCode,
    country: r.country ?? r.countryCode ?? '',
    city: r.city,
    zip: r.zip,
    formatted: r.formatted ?? '',
    lat: r.lat,
    lng: r.lng,
  };
}

/**
 * Κλήσεις που «τρέχουν τώρα», ανά κλειδί — μέσα σε ΑΥΤΗ τη διεργασία.
 *
 * Δύο panels που ανοίγουν ταυτόχρονα την ίδια διεύθυνση έβρισκαν και τα δύο άδεια
 * μνήμη και ρωτούσαν και τα δύο τον πάροχο (διπλή χρέωση). Εδώ ο δεύτερος
 * περιμένει τον πρώτο. Δεν είναι κλείδωμα σε επίπεδο cluster: με πολλές instances
 * το χειρότερο σενάριο παραμένει μία κλήση ανά instance, και το `upsert` κρατά τη
 * βάση συνεπή.
 */
const inFlight = new Map<string, Promise<CachedGeocode>>();

/**
 * Ανάλυση διεύθυνσης ΜΕ μνήμη. Η σειρά είναι: βάση → (μόνο αν λείπει) πάροχος → βάση.
 *
 * Καμία αποτυχία δεν φτάνει στον καλούντα: πρόβλημα με τη βάση σημαίνει απλώς ότι
 * χάνουμε τη μνήμη, όχι τη λειτουργία.
 */
export async function cachedGeocodeAddressParts(
  address: string,
  opts: { countryHint?: string | null } = {},
): Promise<CachedGeocode> {
  const raw = String(address ?? '').trim();
  const hint = opts.countryHint ? String(opts.countryHint).trim().toUpperCase() : null;
  const key = geocodeCacheKey(raw, hint);
  if (!key) return { found: false, parts: MISS, cached: false };

  // 1. Μνήμη. Η αστοχία είναι εξίσου έγκυρη απάντηση — δεν ξαναρωτάμε γι' αυτήν,
  //    εκτός αν πέρασε το παράθυρο επανελέγχου (δες {@link MISS_RETRY_DAYS}).
  const hit = await prisma.geocodeCache.findUnique({ where: { key } }).catch(() => null);
  if (hit && (hit.found || !missExpired(hit.checkedAt))) {
    // Best-effort τηλεμετρία: πόσες κλήσεις γλίτωσε η μνήμη.
    await prisma.geocodeCache
      .update({ where: { key }, data: { hits: { increment: 1 }, usedAt: new Date() } })
      .catch(() => null);
    return { found: hit.found, parts: hit.found ? rowToParts(hit) : MISS, cached: true };
  }

  // 2. Ο πάροχος — η ΜΟΝΗ χρεώσιμη διαδρομή. Μία κλήση ανά κλειδί τη φορά.
  const pending = inFlight.get(key);
  if (pending) return pending;
  const run = askProvider(key, raw, hint);
  inFlight.set(key, run);
  try {
    return await run;
  } finally {
    inFlight.delete(key);
  }
}

/**
 * Ρωτά τον πάροχο και γράφει ΜΟΝΟ ό,τι είναι απάντηση.
 *
 * Βλάβη (`unavailable`) ⇒ **καμία εγγραφή**: ο καλών παίρνει «δεν βρέθηκε» για τώρα,
 * αλλά η επόμενη κλήση για την ίδια διεύθυνση θα ξαναρωτήσει κανονικά.
 */
async function askProvider(
  key: string,
  raw: string,
  hint: string | null,
): Promise<CachedGeocode> {
  const outcome = await geocodeAddressParts(raw, { countryHint: hint ?? undefined });
  if (outcome.status === 'unavailable') {
    return { found: false, parts: MISS, cached: false, unavailable: true };
  }

  const parts = outcome.parts;
  // 3. Γράψιμο. `upsert` γιατί δύο ταυτόχρονες διεργασίες μπορεί να ρωτήσουν το ίδιο.
  const data = {
    address: raw,
    countryHint: hint,
    found: !!parts,
    countryCode: parts?.countryCode ?? null,
    country: parts?.country ?? null,
    city: parts?.city ?? null,
    zip: parts?.zip ?? null,
    formatted: parts?.formatted ?? null,
    lat: parts?.lat ?? null,
    lng: parts?.lng ?? null,
    // Πότε ρωτήθηκε ΤΕΛΕΥΤΑΙΑ ο πάροχος — από αυτό μετριέται το παράθυρο
    // επανελέγχου των αστοχιών. Το `usedAt` δεν κάνει: χτυπιέται σε κάθε ανάγνωση.
    checkedAt: new Date(),
  };
  await prisma.geocodeCache
    .upsert({ where: { key }, create: { key, ...data }, update: data })
    .catch(() => null);

  return { found: !!parts, parts: parts ?? MISS, cached: false };
}
