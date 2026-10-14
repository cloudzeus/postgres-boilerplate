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
  /** Επιβαρύνσεις (μεταφορικά, ασφάλιστρα, τέλη) — μέρος του Γενικού Συνόλου, όχι των γραμμών. */
  feesField: number | null;
  totalOk: boolean | null;
  hasMultipleRates: boolean;
}

export function reconcileInvoice(data: {
  items?: RawLine[]; subtotal?: unknown; vatAmount?: unknown; totalAmount?: unknown; otherCharges?: unknown;
}): Reconciliation {
  const items = Array.isArray(data.items) ? data.items : [];
  const sumNet = round2(items.reduce((s, l) => s + lineNet(l), 0));
  const subtotal = n(data.subtotal);
  const vatField = n(data.vatAmount);
  const totalField = n(data.totalAmount);
  const feesField = n(data.otherCharges);

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
  // ΜΕ ΤΙΣ ΕΠΙΒΑΡΥΝΣΕΙΣ: ένα τιμολόγιο CIF (167.000 € γραμμές + 6.500 € μεταφορικά = 173.500 €)
  // έβγαινε «δεν κλείνει», ενώ ήταν σωστά διαβασμένο. Οι επιβαρύνσεις μπορεί να είναι και ΕΞΩ από το
  // Γενικό Σύνολο (τέλη στο Πληρωτέο): δεκτό ό,τι από τα δύο κλείνει.
  const withoutFees = round2(baseNet + baseVat);
  const withFees = round2(withoutFees + (feesField ?? 0));
  const totalComputed = feesField && totalField != null && Math.abs(withFees - totalField) <= tol(totalField, extra) ? withFees : withoutFees;
  const totalOk = totalField != null ? Math.abs(totalComputed - totalField) <= tol(totalField, extra) : null;

  return {
    sumNet, subtotal, linesVsSubtotal,
    vatGroups, vatComputed, vatField, vatOk,
    totalComputed, totalField, totalOk, hasMultipleRates, feesField,
  };
}

const STANDARD_VAT = [24, 13, 6, 17, 9, 4];

export type TotalsFix =
  /** Οι επιβαρύνσεις δεν είναι γραμμή ⇒ δεν καταχωρούνται: μετάφερέ τες σε γραμμή. */
  | { kind: 'fees_to_line'; amount: number }
  /** Η διαφορά είναι μεταφορικά/τέλη: γράψε τη στις επιβαρύνσεις. */
  | { kind: 'set_fees'; amount: number; diff: number }
  /** Οι γραμμές δεν έχουν ΦΠΑ και η διαφορά ταιριάζει με συντελεστή: βάλε τον. */
  | { kind: 'set_vat'; rate: number; vat: number }
  /** Το Γενικό Σύνολο διαβάστηκε λάθος: βάλε το υπολογισμένο. */
  | { kind: 'set_total'; total: number }
  /** Η καθαρή αξία διαβάστηκε λάθος: βάλε το άθροισμα των γραμμών. */
  | { kind: 'set_net'; net: number };

/**
 * «ΤΙ ΝΑ ΚΑΝΩ;» — συγκεκριμένες διορθώσεις για ένα παραστατικό που δεν κλείνει, με τη σειρά που
 * είναι πιθανότερες. Ένας έλεγχος που λέει μόνο «≠» αφήνει τον χρήστη χωρίς επιλογή.
 */
export function totalsFixes(rec: Reconciliation, items: RawLine[]): TotalsFix[] {
  const out: TotalsFix[] = [];
  const fees = rec.feesField ?? 0;
  // Επιβαρύνσεις χωρίς γραμμή: η καταχώριση στο SoftOne στέλνει ΓΡΑΜΜΕΣ — θα χάνονταν.
  if (fees > 0.005) out.push({ kind: 'fees_to_line', amount: round2(fees) });
  if (rec.linesVsSubtotal && !rec.linesVsSubtotal.ok) out.push({ kind: 'set_net', net: rec.sumNet });
  if (rec.totalOk === false && rec.totalField != null && rec.totalComputed != null) {
    const diff = round2(rec.totalField - rec.totalComputed);
    const base = rec.subtotal ?? rec.sumNet;
    const noVat = items.length > 0 && items.every((l) => { const r = n(l.vatRate); return r == null || r === 0; });
    const rate = noVat && base > 0 && (rec.vatField ?? 0) === 0
      ? STANDARD_VAT.find((r) => Math.abs(base * r / 100 - diff) <= Math.max(0.05, diff * 0.002))
      : undefined;
    if (rate != null) out.push({ kind: 'set_vat', rate, vat: diff });
    if (diff > 0) out.push({ kind: 'set_fees', amount: round2(fees + diff), diff });
    out.push({ kind: 'set_total', total: rec.totalComputed });
  }
  return out;
}
