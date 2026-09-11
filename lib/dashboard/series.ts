/**
 * Καθαροί βοηθοί του dashboard (`/admin`): παράθυρα περιόδου, ημερήσιο bucketing,
 * μεταβολές έναντι προηγούμενης περιόδου και γεωμετρία των γραφικών.
 *
 * Τίποτα εδώ δεν αγγίζει βάση, δίκτυο ή React — ό,τι μπαίνει εδώ είναι δοκιμάσιμο
 * (`lib/dashboard/__tests__/series.test.ts`). Το `stats.ts` κρατά τα queries.
 */

export const RANGES = [7, 30, 90] as const;
export type Range = (typeof RANGES)[number];
export const DEFAULT_RANGE: Range = 30;

const DAY_MS = 86_400_000;

/** `?range=` → έγκυρη περίοδος. Ό,τι δεν αναγνωρίζεται πέφτει στις 30 ημέρες. */
export function parseRange(value: string | string[] | undefined): Range {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number(raw);
  return (RANGES as readonly number[]).includes(n) ? (n as Range) : DEFAULT_RANGE;
}

export interface Window {
  /** Αρχή τρέχουσας περιόδου (00:00 UTC, πριν `days - 1` ημέρες). */
  start: Date;
  /** Τέλος τρέχουσας περιόδου — αποκλειστικό όριο (00:00 UTC της αύριον). */
  end: Date;
  /** Αρχή προηγούμενης περιόδου ίσου μήκους. */
  prevStart: Date;
  /** Τέλος προηγούμενης περιόδου — ίσο με `start`. */
  prevEnd: Date;
  /** Κλειδιά ISO ημερών (YYYY-MM-DD) της τρέχουσας περιόδου, σε αύξουσα σειρά. */
  days: string[];
}

/** Αρχή της ημέρας (UTC) για μια στιγμή. */
export function startOfDayUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** ISO κλειδί ημέρας (YYYY-MM-DD) — ίδια σύμβαση με το `lib/ai/fx.ts`. */
export function isoDay(d: Date | string | number): string {
  return new Date(d).toISOString().slice(0, 10);
}

/**
 * Τρέχον παράθυρο `days` ημερών που τελειώνει σήμερα (η σημερινή μέρα μετράει
 * ολόκληρη) και το αμέσως προηγούμενο ίσου μήκους, για τις μεταβολές.
 */
export function windowFor(now: Date, days: number): Window {
  const today = startOfDayUtc(now);
  const start = new Date(today.getTime() - (days - 1) * DAY_MS);
  const end = new Date(today.getTime() + DAY_MS);
  const prevStart = new Date(start.getTime() - days * DAY_MS);
  return {
    start,
    end,
    prevStart,
    prevEnd: start,
    days: Array.from({ length: days }, (_, i) => isoDay(new Date(start.getTime() + i * DAY_MS))),
  };
}

export type DeltaDir = 'up' | 'down' | 'flat';
export interface Delta {
  dir: DeltaDir;
  /** Ποσοστιαία μεταβολή (0–…) ή `null` όταν η προηγούμενη περίοδος ήταν μηδενική. */
  pct: number | null;
  diff: number;
}

/** Μεταβολή τρέχουσας vs προηγούμενης περιόδου. */
export function delta(current: number, previous: number): Delta {
  const diff = current - previous;
  if (previous === 0) return { dir: diff > 0 ? 'up' : 'flat', pct: null, diff };
  if (diff === 0) return { dir: 'flat', pct: 0, diff };
  return { dir: diff > 0 ? 'up' : 'down', pct: Math.abs(diff / previous) * 100, diff };
}

/**
 * Στοιχίζει μετρήσεις ανά ημέρα πάνω στα κλειδιά του παραθύρου, γεμίζοντας τα κενά
 * με μηδενικά — ώστε το γράφημα να έχει πάντα μία στήλη ανά ημέρα.
 */
export function bucketByDay(
  rows: Array<{ day: Date | string; value: number }>,
  days: string[],
): number[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const key = isoDay(r.day);
    map.set(key, (map.get(key) ?? 0) + r.value);
  }
  return days.map((d) => map.get(d) ?? 0);
}

/** Σαββατοκύριακο (ISO ημέρα, UTC) — τα labels τους μπαίνουν πιο αχνά. */
export function isWeekend(isoDate: string): boolean {
  const dow = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

/** Σύντομη ετικέτα άξονα (ηη/μμ) στα ελληνικά. */
export function dayLabel(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('el-GR', {
    day: '2-digit', month: '2-digit', timeZone: 'UTC',
  });
}

/**
 * «Στρογγυλό» πάνω όριο άξονα y ώστε οι γραμμές πλέγματος να πέφτουν σε ωραίους
 * αριθμούς (1/2/5 × 10^n). Πάντα ≥ 1, ώστε ο άξονας να μην καταρρέει σε 0.
 */
export function niceMax(max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 1;
  const exp = Math.floor(Math.log10(max));
  const pow = 10 ** exp;
  const frac = max / pow;
  const step = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return step * pow;
}

/** Ισαπέχουσες τιμές πλέγματος από 0 έως `max` (χωρίς το 0). */
export function gridTicks(max: number, count = 4): number[] {
  const top = niceMax(max);
  return Array.from({ length: count }, (_, i) => (top * (i + 1)) / count);
}

/**
 * Πλέγμα για μετρήσιμα μεγέθη (πλήθη εγγράφων): μόνο ακέραιες τιμές, ώστε ένας
 * άξονας με κορυφή 1 να μη δείχνει «1 1 1 0» από στρογγυλοποίηση δεκαδικών.
 * Διαλέγει το πυκνότερο πλήθος βημάτων (≤ `maxCount`) που διαιρεί ακριβώς την κορυφή.
 */
export function integerTicks(max: number, maxCount = 5): number[] {
  const top = Math.round(niceMax(max));
  for (let count = maxCount; count >= 1; count--) {
    if (top % count === 0) {
      const step = top / count;
      return Array.from({ length: count }, (_, i) => step * (i + 1));
    }
  }
  return [top];
}

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  color: string;
  /** Ποσοστό επί του συνόλου (0–100). */
  pct: number;
  /** `stroke-dasharray` για κύκλο περιμέτρου `circumference`. */
  dash: string;
  /** `stroke-dashoffset` ώστε το τόξο να ξεκινά εκεί που τελείωσε το προηγούμενο. */
  offset: number;
}

/**
 * Μετατρέπει τιμές σε τόξα donut (stroke-dasharray/offset πάνω σε έναν κύκλο).
 * Τα μηδενικά μένουν στη λίστα — το υπόμνημα τα δείχνει με 0, δεν τα κρύβει.
 */
export function donutSlices(
  items: Array<{ key: string; label: string; value: number; color: string }>,
  circumference: number,
): { slices: DonutSlice[]; total: number } {
  const total = items.reduce((s, i) => s + i.value, 0);
  let acc = 0;
  const slices = items.map((i) => {
    const frac = total > 0 ? i.value / total : 0;
    const len = frac * circumference;
    const offset = acc === 0 ? 0 : -acc; // `-0` θα τύπωνε "-0" στο SVG attribute
    acc += len;
    return {
      ...i,
      pct: total > 0 ? frac * 100 : 0,
      dash: `${len.toFixed(2)} ${(circumference - len).toFixed(2)}`,
      offset,
    };
  });
  return { slices, total };
}

/** Ποσοστό ως ακέραιο, ανθεκτικό σε μηδενικό παρονομαστή. */
export function share(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0;
}

/**
 * Ποσοστό επιτυχίας εκτελέσεων προτύπων: (EXTRACTED + POSTED) / όσες δεν απέτυχαν.
 * Χωρίς εκτελέσεις επιστρέφει `null` (δεν είναι «0 %», είναι «δεν ξέρουμε»).
 */
export function successRate(counts: Record<string, number>): number | null {
  const total = Object.entries(counts)
    .filter(([k]) => k !== 'FAILED')
    .reduce((s, [, v]) => s + v, 0);
  if (total === 0) return null;
  return share((counts.EXTRACTED ?? 0) + (counts.POSTED ?? 0), total);
}

/** Κρατά τα `n` μεγαλύτερα, φθίνουσα — σταθερή σειρά για ίσες τιμές (αλφαβητικά). */
export function topN<T extends { label: string; value: number }>(rows: T[], n: number): T[] {
  return [...rows]
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'el'))
    .slice(0, n);
}
