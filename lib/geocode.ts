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
