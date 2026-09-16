// Μνήμη geocoding: μια διεύθυνση κοστίζει ΜΙΑ κλήση στον πάροχο, για πάντα.
//
// Το MapTiler είναι ΜΕΤΡΗΜΕΝΟ (quota ανά κλήση). Η ουρά «Νέοι συναλλασσόμενοι»
// πλέον ρωτά τον geocoder ΑΥΤΟΜΑΤΑ όταν ανοίγει ένας εκδότης — χωρίς μνήμη αυτό θα
// σήμαινε μια κλήση σε κάθε άνοιγμα, σε κάθε refresh της λίστας, σε κάθε re-render.
// Εδώ η απάντηση (ΚΑΙ η αστοχία) γράφεται μια φορά και ξαναδιαβάζεται από τη βάση.
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
}

const MISS: AddressParts | null = null;

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

  // 1. Μνήμη. Η αστοχία είναι εξίσου έγκυρη απάντηση — δεν ξαναρωτάμε γι' αυτήν.
  const hit = await prisma.geocodeCache.findUnique({ where: { key } }).catch(() => null);
  if (hit) {
    // Best-effort τηλεμετρία: πόσες κλήσεις γλίτωσε η μνήμη.
    await prisma.geocodeCache
      .update({ where: { key }, data: { hits: { increment: 1 }, usedAt: new Date() } })
      .catch(() => null);
    return { found: hit.found, parts: hit.found ? rowToParts(hit) : MISS, cached: true };
  }

  // 2. Ο πάροχος — η ΜΟΝΗ χρεώσιμη διαδρομή αυτής της συνάρτησης.
  const parts = await geocodeAddressParts(raw, { countryHint: hint ?? undefined });

  // 3. Γράψιμο. `upsert` γιατί δύο ταυτόχρονα panels μπορεί να ρωτήσουν το ίδιο.
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
  };
  await prisma.geocodeCache
    .upsert({ where: { key }, create: { key, ...data }, update: data })
    .catch(() => null);

  return { found: !!parts, parts: parts ?? MISS, cached: false };
}
