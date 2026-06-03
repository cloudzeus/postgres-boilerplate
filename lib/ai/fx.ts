// USD→EUR FX rates from Frankfurter (https://frankfurter.dev, ECB data).
// AI costs are stored in USD (lib/ai/pricing.ts); we convert to EUR for display.
// The v2 endpoint returns one row per calendar day (weekends forward-filled by
// the API), so no gap-filling is needed on our side.
//
// `latest` is cached per calendar day; series responses are cached per range/day.
// On any network/parse failure we fall back to the caller-supplied rate (the
// `ai.usdToEur` setting), so the dashboard never breaks if Frankfurter is down.

const BASE = 'https://api.frankfurter.dev/v2/rates';

type FxRow = { date: string; base: string; quote: string; rate: number };

const todayKey = () => new Date().toISOString().slice(0, 10);

let latestCache: { value: number; day: string } | null = null;
const seriesCache = new Map<string, Record<string, number>>();

async function fetchRows(url: string): Promise<FxRow[] | null> {
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? (data as FxRow[]) : null;
  } catch {
    return null; // network/timeout/parse → caller falls back to the configured rate
  }
}

/** Latest USD→EUR rate (cached for the calendar day). Falls back on error. */
export async function getUsdToEurLatest(fallback: number): Promise<number> {
  if (latestCache && latestCache.day === todayKey()) return latestCache.value;
  const rows = await fetchRows(`${BASE}?base=USD&quotes=EUR`);
  const rate = rows?.[0]?.rate;
  if (typeof rate === 'number' && rate > 0) {
    latestCache = { value: rate, day: todayKey() };
    return rate;
  }
  return fallback;
}

/** Per-day USD→EUR rates for [fromISO, toISO] as { 'YYYY-MM-DD': rate }. */
export async function getUsdToEurSeries(fromISO: string, toISO: string): Promise<Record<string, number>> {
  const key = `${fromISO}|${toISO}|${todayKey()}`;
  const cached = seriesCache.get(key);
  if (cached) return cached;
  const rows = await fetchRows(`${BASE}?base=USD&quotes=EUR&from=${fromISO}&to=${toISO}`);
  const map: Record<string, number> = {};
  if (rows) for (const r of rows) if (typeof r.rate === 'number' && r.rate > 0) map[r.date] = r.rate;
  if (Object.keys(map).length > 0) seriesCache.set(key, map);
  return map;
}

/** ISO day key (YYYY-MM-DD) for a Date or date-ish value. */
export function dayKey(d: Date | string | number): string {
  return new Date(d).toISOString().slice(0, 10);
}

/** Convert a USD amount to EUR using that day's rate, falling back to `latest`. */
export function usdToEurOnDay(
  usd: number, day: Date | string | number, series: Record<string, number>, latest: number,
): number {
  const rate = series[dayKey(day)] ?? latest;
  return usd * rate;
}
