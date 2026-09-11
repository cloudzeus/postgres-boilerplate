/** Μορφοποίηση αριθμών του dashboard — πάντα el-GR, σε server και client. */

export function fmtInt(n: number): string {
  return new Intl.NumberFormat('el-GR', { maximumFractionDigits: 0 }).format(n);
}

export function fmtEur(n: number): string {
  return new Intl.NumberFormat('el-GR', {
    style: 'currency',
    currency: 'EUR',
    // Πολύ μικρά ποσά AI (< 1 €) χάνονται στα 2 δεκαδικά — εκεί δείχνουμε 4.
    maximumFractionDigits: n !== 0 && Math.abs(n) < 1 ? 4 : 2,
  }).format(n);
}

export function fmtPct(n: number, digits = 0): string {
  return `${new Intl.NumberFormat('el-GR', {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).format(n)} %`;
}

/** Διάρκεια σε ανθρώπινη μορφή: «820 ms» / «4,2 δευτ.» */
export function fmtDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${fmtInt(ms)} ms`;
  return `${new Intl.NumberFormat('el-GR', { maximumFractionDigits: 1 }).format(ms / 1000)} δευτ.`;
}

export const RANGE_LABEL: Record<number, string> = { 7: '7 ημ.', 30: '30 ημ.', 90: '90 ημ.' };

/** «τις τελευταίες 30 ημέρες» — για περιγραφές και aria-labels. */
export function rangePhrase(range: number): string {
  return `τις τελευταίες ${fmtInt(range)} ημέρες`;
}
