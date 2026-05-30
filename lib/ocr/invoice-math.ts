// Invoice arithmetic reconciliation. Validates that an invoice's line items add
// up to the stated net (Καθαρή αξία), that VAT is consistent PER RATE (an invoice
// may mix VAT coefficients), and that the grand total = net + VAT. Also classifies
// each line's discount as a percentage or an amount, so percent discounts
// (έκπτωση επί τοις %) don't get falsely flagged.

export interface RawLine { quantity?: unknown; price?: unknown; discount?: unknown; vatRate?: unknown; total?: unknown }

export function n(v: unknown): number | null {
  const s = String(v ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!s) return null;
  const num = Number(s);
  return Number.isFinite(num) ? num : null;
}

const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
/** Tolerance scales a little with magnitude to absorb per-line rounding. */
const tol = (ref: number, extra = 0) => Math.max(0.02 + extra, Math.abs(ref) * 0.001);

/** quantity × price (0 when either is missing). */
export function lineGross(l: RawLine): number {
  const q = n(l.quantity), p = n(l.price);
  return q == null || p == null ? 0 : q * p;
}

/** The line's net (after discount, before VAT). Trusts an explicit `total`; else
 * falls back to gross − discount (amount interpretation). */
export function lineNet(l: RawLine): number {
  const t = n(l.total);
  if (t != null) return t;
  return lineGross(l) - (n(l.discount) ?? 0);
}

export interface LineAnalysis {
  gross: number;
  net: number;
  discount: number | null;
  discountKind: 'none' | 'percent' | 'amount' | 'unknown';
  consistent: boolean;
}

/** Classify a line's discount and check the `total` is arithmetically consistent
 * under EITHER a percentage or an amount interpretation. */
export function analyzeLine(l: RawLine): LineAnalysis {
  const gross = lineGross(l);
  const discount = n(l.discount);
  const t = n(l.total);
  const net = t != null ? t : gross - (discount ?? 0);

  let discountKind: LineAnalysis['discountKind'] = 'none';
  let consistent = true;

  if (t != null && gross > 0) {
    if (discount != null && discount !== 0) {
      const amountNet = gross - discount;
      const percentNet = gross * (1 - discount / 100);
      const amountOk = Math.abs(amountNet - t) <= tol(gross);
      const percentOk = Math.abs(percentNet - t) <= tol(gross);
      consistent = amountOk || percentOk;
      discountKind = percentOk && !amountOk ? 'percent'
        : amountOk && !percentOk ? 'amount'
        : consistent ? 'percent' /* both fit → prefer % */
        : 'unknown';
    } else {
      consistent = Math.abs(gross - t) <= tol(gross);
    }
  }
  return { gross, net: round2(net), discount, discountKind, consistent };
}

export interface VatGroup { rate: number; net: number; vat: number }

export interface Reconciliation {
  sumNet: number;
  subtotal: number | null;
  /** Σ(line nets) vs the stated Καθαρή αξία. */
  linesVsSubtotal: { ok: boolean; diff: number } | null;
  /** Net + computed VAT, grouped by rate (sorted ascending). */
  vatGroups: VatGroup[];
  vatComputed: number;
  vatField: number | null;
  vatOk: boolean | null;
  totalComputed: number | null;
  totalField: number | null;
  totalOk: boolean | null;
  hasMultipleRates: boolean;
}

export function reconcileInvoice(data: {
  items?: RawLine[]; subtotal?: unknown; vatAmount?: unknown; totalAmount?: unknown;
}): Reconciliation {
  const items = Array.isArray(data.items) ? data.items : [];
  const sumNet = round2(items.reduce((s, l) => s + lineNet(l), 0));
  const subtotal = n(data.subtotal);
  const vatField = n(data.vatAmount);
  const totalField = n(data.totalAmount);

  // Group line nets by VAT rate, compute VAT per group (multi-VAT aware).
  const byRate = new Map<number, number>();
  for (const l of items) {
    const r = n(l.vatRate);
    if (r == null) continue;
    byRate.set(r, (byRate.get(r) ?? 0) + lineNet(l));
  }
  const vatGroups: VatGroup[] = [...byRate.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rate, net]) => ({ rate, net: round2(net), vat: round2(net * rate / 100) }));
  const vatComputed = round2(vatGroups.reduce((s, g) => s + g.vat, 0));
  const hasMultipleRates = byRate.size > 1;
  const extra = hasMultipleRates ? 0.03 : 0; // a little slack across rounded rate groups

  const linesVsSubtotal = subtotal != null
    ? { ok: Math.abs(sumNet - subtotal) <= tol(subtotal, extra), diff: round2(sumNet - subtotal) }
    : null;
  const vatOk = vatField != null && byRate.size > 0
    ? Math.abs(vatComputed - vatField) <= tol(vatField, extra)
    : null;

  const baseNet = subtotal ?? sumNet;
  const baseVat = vatField ?? vatComputed;
  const totalComputed = round2(baseNet + baseVat);
  const totalOk = totalField != null ? Math.abs(totalComputed - totalField) <= tol(totalField, extra) : null;

  return {
    sumNet, subtotal, linesVsSubtotal,
    vatGroups, vatComputed, vatField, vatOk,
    totalComputed, totalField, totalOk, hasMultipleRates,
  };
}
