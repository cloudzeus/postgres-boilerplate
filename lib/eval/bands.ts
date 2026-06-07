/** A scoring band: value in [min,max] → score. null min = -∞, null max = +∞ (both inclusive). */
export type Band = { min: number | null; max: number | null; score: number };

/** Returns the score of the first band whose range contains `value`, or null if none match. */
export function lookupBand(bands: Band[], value: number): number | null {
  for (const b of bands) {
    const okMin = b.min == null || value >= b.min;
    const okMax = b.max == null || value <= b.max;
    if (okMin && okMax) return b.score;
  }
  return null;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
