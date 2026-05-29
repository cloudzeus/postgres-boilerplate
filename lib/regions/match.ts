import type { RegionBreadcrumb } from '@/lib/regions/tree';

const MIN_QUERY_LEN = 4;   // avoid false positives on tiny strings
const STEM_LEN = 5;        // shared-prefix length for genitive/nominative matching
const GEO_CAP_KM = 50;     // reject geo matches farther than this from any Δήμος centroid

// Administrative prefixes stripped from both Καλλικράτης names and ΓΕΜΗ official names
const ADMIN_PREFIX = /^\s*(ΔΗΜΟΣ|Δ\.|ΠΕΡΙΦΕΡΕΙΑΚΗ ΕΝΟΤΗΤΑ|ΠΕΡΙΦΕΡΕΙΑ|ΝΟΜΟΣ|Π\.Ε\.)\s+/;

export type RegionMatch = {
  regionCode: string;
  breadcrumb: RegionBreadcrumb;
  confidence: 'gemi' | 'name' | 'geo';
};

type MatchInput = {
  address?: string | null;
  city?: string | null;
  district?: string | null;
  zip?: string | null;
  country?: string | null;
  municipalityId?: string | null;   // ΓΕΜΗ Municipality.id
  prefectureId?: string | null;     // ΓΕΜΗ Prefecture.id
  latitude?: number | null;
  longitude?: number | null;
};

type Level5Node = { code: string; nameEL: string; latitude: number | null; longitude: number | null };

/** Uppercase, strip diacritics, normalize final sigma, collapse whitespace. */
export function normalizeGreek(s: string): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // combining accents
    .replace(/ς/g, 'σ')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip admin prefixes (ΔΗΜΟΣ/ΝΟΜΟΣ/ΠΕΡΙΦΕΡΕΙΑΚΗ ΕΝΟΤΗΤΑ/…) + parentheticals, then normalize. */
export function coreName(nameEL: string): string {
  const noParen = nameEL.replace(/\(.*?\)/g, '').trim();
  const norm = normalizeGreek(noParen);
  return norm.replace(ADMIN_PREFIX, '').trim();
}

/** Best level-4/5 code for a free-text place name, or null. */
export function nameMatchCandidate(
  query: string,
  nodes: { code: string; nameEL: string }[],
): string | null {
  const q = normalizeGreek(query);
  if (q.length < MIN_QUERY_LEN) return null;

  // 1) exact normalized core match
  for (const n of nodes) if (coreName(n.nameEL) === q) return n.code;
  // 2) containment either direction (handles "ΑΘΗΝΑ" ⊂ "ΑΘΗΝΑΙΩΝ", "ΔΟΞΑΤΟ" ⊂ "ΔΟΞΑΤΟΥ")
  for (const n of nodes) {
    const core = coreName(n.nameEL);
    if (core.includes(q) || q.includes(core)) return n.code;
  }
  // 3) shared stem (first STEM_LEN chars)
  if (q.length >= STEM_LEN) {
    const stem = q.slice(0, STEM_LEN);
    for (const n of nodes) if (coreName(n.nameEL).startsWith(stem)) return n.code;
  }
  return null;
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function nearestNode(
  point: { lat: number; lng: number },
  nodes: { code: string; latitude: number | null; longitude: number | null }[],
  capKm = GEO_CAP_KM,
): string | null {
  let best: string | null = null;
  let bestKm = Infinity;
  for (const n of nodes) {
    if (n.latitude == null || n.longitude == null) continue;
    const km = haversineKm(point, { lat: n.latitude, lng: n.longitude });
    if (km < bestKm) { bestKm = km; best = n.code; }
  }
  return bestKm <= capKm ? best : null;
}

/** Hybrid: ΓΕΜΗ official names → free-text name match → geocode-nearest fallback. */
export async function matchRegion(input: MatchInput): Promise<RegionMatch | null> {
  const { prisma } = await import('@/lib/db');
  const { deriveHierarchy } = await import('@/lib/regions/tree');

  const nodes: Level5Node[] = await prisma.region.findMany({
    where: { level: 5 },
    select: { code: true, nameEL: true, latitude: true, longitude: true },
  });

  // 0) ΓΕΜΗ Δήμος (highest signal) — official Municipality.descr → level-5
  if (input.municipalityId) {
    const muni = await prisma.municipality.findUnique({
      where: { id: input.municipalityId }, select: { descr: true },
    });
    if (muni?.descr) {
      const code = nameMatchCandidate(muni.descr, nodes);
      if (code) return { regionCode: code, breadcrumb: await deriveHierarchy(code), confidence: 'gemi' };
    }
  }

  // 0b) ΓΕΜΗ Νομός/Π.Ε. — official Prefecture.descr → level-4 (Δήμος stays "—")
  if (input.prefectureId) {
    const pref = await prisma.prefecture.findUnique({
      where: { id: input.prefectureId }, select: { descr: true },
    });
    if (pref?.descr) {
      const units = await prisma.region.findMany({
        where: { level: 4 }, select: { code: true, nameEL: true },
      });
      const code = nameMatchCandidate(pref.descr, units);
      if (code) return { regionCode: code, breadcrumb: await deriveHierarchy(code), confidence: 'gemi' };
    }
  }

  // 1) free-text name match — district first (more specific), then city
  for (const q of [input.district, input.city]) {
    if (!q) continue;
    const code = nameMatchCandidate(q, nodes);
    if (code) return { regionCode: code, breadcrumb: await deriveHierarchy(code), confidence: 'name' };
  }

  // 2) geo fallback — use given coords, else geocode the address
  let point: { lat: number; lng: number } | null =
    input.latitude != null && input.longitude != null
      ? { lat: input.latitude, lng: input.longitude }
      : null;
  if (!point) {
    const { geocodeAddress } = await import('@/lib/geocode');
    const geo = await geocodeAddress({
      address: input.address ?? null, city: input.city ?? null,
      zip: input.zip ?? null, country: input.country ?? 'GR',
    });
    if (geo) point = { lat: geo.lat, lng: geo.lng };
  }
  if (point) {
    const code = nearestNode(point, nodes);
    if (code) return { regionCode: code, breadcrumb: await deriveHierarchy(code), confidence: 'geo' };
  }
  return null;
}
