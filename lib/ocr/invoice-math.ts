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
  // Ο ΦΠΑ μπορεί να υπολογίζεται και ΠΑΝΩ στις επιβαρύνσεις (τέλος ανακύκλωσης, μεταφορικά): ΜΙΛΑΝΟΣ
  // 289,20 + 4,60 τέλος → ΦΠΑ 24% = 70,51. Δεκτό κι αυτό, με τον κύριο συντελεστή των γραμμών.
  const mainRate = vatGroups.length ? [...vatGroups].sort((a, b) => b.net - a.net)[0].rate : null;
  const vatWithFees = feesField && mainRate != null ? round2(vatComputed + feesField * mainRate / 100) : null;
  const vatOk = vatField != null && byRate.size > 0
    ? Math.abs(vatComputed - vatField) <= tol(vatField, extra)
      || (vatWithFees != null && Math.abs(vatWithFees - vatField) <= tol(vatField, extra))
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

/** Τα ποσά ενός παραστατικού όπως τα κρατά η φόρμα (αριθμοί ή κείμενο). */
export interface TotalsInput {
  items: RawLine[];
  subtotal: unknown;
  vatAmount: unknown;
  otherCharges: unknown;
  totalAmount: unknown;
}

/** Κλείνουν ΟΛΟΙ οι έλεγχοι που μπορούν να γίνουν; (Χωρίς κανέναν έλεγχο ⇒ όχι.) */
export function totalsClose(input: TotalsInput): boolean {
  const r = reconcileInvoice(input);
  const checks = [r.linesVsSubtotal?.ok ?? null, r.vatOk, r.totalOk];
  const linesOk = input.items.every((l) => analyzeLine(l).consistent);
  return linesOk && checks.some((c) => c != null) && checks.every((c) => c == null || c === true);
}

/** Ένα βήμα διόρθωσης. Οι τιμές υπολογίζονται τη στιγμή της εφαρμογής, πάνω στα ήδη διορθωμένα ποσά. */
export type FixStep =
  /** Έκπτωση % σε ΟΛΕΣ τις γραμμές: σύνολο γραμμής = ποσότητα × τιμή × (1 − %). */
  | { kind: 'line_discount'; pct: number }
  /** Γραμμές με σύνολο < ποσότητα × τιμή χωρίς έκπτωση: η έκπτωση % βγαίνει από το ίδιο το σύνολο (482 → 289,20 = 40%). */
  | { kind: 'line_discount_from_total' }
  /** Καθαρή αξία = άθροισμα γραμμών. */
  | { kind: 'net_from_lines' }
  /** ΦΠΑ = ΦΠΑ γραμμών (`lines`) ή ΦΠΑ γραμμών + ΦΠΑ επιβαρύνσεων (`lines_fees`). */
  | { kind: 'vat'; mode: 'lines' | 'lines_fees' }
  /** Συντελεστής ΦΠΑ σε όλες τις γραμμές (όταν δεν έχουν κανέναν) + ΦΠΑ = καθαρή × %. */
  | { kind: 'vat_rate'; rate: number }
  /** Γενικό Σύνολο = καθαρή + ΦΠΑ (`net_vat`) ή + επιβαρύνσεις (`net_vat_fees`). */
  | { kind: 'total'; mode: 'net_vat' | 'net_vat_fees' }
  /** Επιβαρύνσεις = Γενικό Σύνολο − καθαρή − ΦΠΑ. */
  | { kind: 'fees_from_diff' };

const num0 = (v: unknown) => n(v) ?? 0;

/** Η έκπτωση % που εξηγεί ΑΚΡΙΒΩΣ το σύνολο μιας ασυνεπούς γραμμής (σε βήματα 0,5%), ή `null`. */
function impliedDiscount(l: RawLine): number | null {
  const a = analyzeLine(l);
  const t = n(l.total);
  if (a.consistent || t == null || a.gross <= 0 || t >= a.gross) return null;
  const pct = Math.round((1 - t / a.gross) * 200) / 2;
  return pct >= 0.5 && pct <= 90 && Math.abs(a.gross * (1 - pct / 100) - t) <= Math.max(0.02, t * 0.001) ? pct : null;
}

/** Εφαρμόζει βήματα με τη σειρά τους· ΚΑΘΑΡΟ — επιστρέφει νέα ποσά. */
export function applySteps(input: TotalsInput, steps: FixStep[]): TotalsInput {
  let cur: TotalsInput = { ...input, items: input.items.map((l) => ({ ...l })) };
  for (const st of steps) {
    const rec = reconcileInvoice(cur);
    if (st.kind === 'line_discount') {
      cur.items = cur.items.map((l) => {
        const gross = lineGross(l);
        return gross > 0 ? { ...l, discount: st.pct, total: round2(gross * (1 - st.pct / 100)) } : l;
      });
    } else if (st.kind === 'line_discount_from_total') {
      cur.items = cur.items.map((l) => {
        const pct = impliedDiscount(l);
        return pct != null ? { ...l, discount: pct } : l;
      });
    } else if (st.kind === 'net_from_lines') {
      cur.subtotal = rec.sumNet;
    } else if (st.kind === 'vat') {
      const fees = num0(cur.otherCharges);
      const main = rec.vatGroups.length ? [...rec.vatGroups].sort((a, b) => b.net - a.net)[0].rate : 0;
      cur.vatAmount = st.mode === 'lines' ? rec.vatComputed : round2(rec.vatComputed + fees * main / 100);
    } else if (st.kind === 'vat_rate') {
      cur.items = cur.items.map((l) => ({ ...l, vatRate: st.rate }));
      cur.vatAmount = round2(num0(cur.subtotal ?? rec.sumNet) * st.rate / 100);
    } else if (st.kind === 'total') {
      const base = num0(cur.subtotal) + num0(cur.vatAmount);
      cur.totalAmount = round2(st.mode === 'net_vat' ? base : base + num0(cur.otherCharges));
    } else if (st.kind === 'fees_from_diff') {
      const d = round2(num0(cur.totalAmount) - num0(cur.subtotal) - num0(cur.vatAmount));
      cur.otherCharges = d > 0 ? d : cur.otherCharges;
    }
  }
  return cur;
}

export interface FixPlan { steps: FixStep[]; result: TotalsInput }

/**
 * «ΤΙ ΝΑ ΚΑΝΩ;» — ΜΟΝΟ λύσεις που ΚΛΕΙΝΟΥΝ το παραστατικό. Κάθε υποψήφιος συνδυασμός βημάτων
 * εφαρμόζεται πρώτα σε αντίγραφο και ξαναπερνά τους ίδιους ελέγχους· ό,τι δεν κλείνει δεν φαίνεται.
 * (Η προηγούμενη έκδοση πρότεινε «γράψε τη διαφορά στις επιβαρύνσεις» χωρίς να ελέγχει ότι κλείνει —
 * στο ΜΙΛΑΝΟΣ η πραγματική αιτία ήταν έκπτωση 40% στη γραμμή και ΦΠΑ πάνω στο τέλος ανακύκλωσης.)
 * Ταξινόμηση: λιγότερα βήματα πρώτα, και όσα αφήνουν το Γενικό Σύνολο όπως τυπώθηκε.
 */
export function totalsPlans(input: TotalsInput, max = 3): FixPlan[] {
  if (totalsClose(input)) return [];
  const rec = reconcileInvoice(input);
  const sumGross = round2(input.items.reduce((t, l) => t + lineGross(l), 0));
  // Κάθε επιλογή γραμμών είναι ΑΚΟΛΟΥΘΙΑ βημάτων (π.χ. «έκπτωση από το σύνολο» + «καθαρή = γραμμές»).
  const lineSteps: FixStep[][] = [[]];
  const subtotal = n(input.subtotal);
  if (subtotal != null && sumGross > 0 && Math.abs(sumGross - subtotal) > 0.02) {
    const pct = Math.round((1 - subtotal / sumGross) * 200) / 2; // σε βήματα 0,5%
    if (pct >= 0.5 && pct <= 90 && Math.abs(sumGross * (1 - pct / 100) - subtotal) <= Math.max(0.02, subtotal * 0.001)) {
      lineSteps.push([{ kind: 'line_discount', pct }]);
    }
  }
  if (rec.linesVsSubtotal && !rec.linesVsSubtotal.ok) lineSteps.push([{ kind: 'net_from_lines' }]);
  // Ασυνεπής γραμμή που εξηγείται από έκπτωση: μόνη της, ή μαζί με «καθαρή = γραμμές».
  if (input.items.some((l) => impliedDiscount(l) != null)) {
    lineSteps.push([{ kind: 'line_discount_from_total' }]);
    lineSteps.push([{ kind: 'line_discount_from_total' }, { kind: 'net_from_lines' }]);
  }
  const noVatOnLines = input.items.length > 0 && input.items.every((l) => { const r = n(l.vatRate); return r == null || r === 0; });
  const vatSteps: (FixStep | null)[] = [null, { kind: 'vat', mode: 'lines' }];
  if (num0(input.otherCharges) > 0) vatSteps.push({ kind: 'vat', mode: 'lines_fees' });
  if (noVatOnLines) for (const r of STANDARD_VAT) vatSteps.push({ kind: 'vat_rate', rate: r });
  // Επιβαρύνσεις από τη διαφορά ΜΟΝΟ όταν δεν διαβάστηκαν καθόλου — ποτέ πάνω σε τυπωμένη τιμή.
  const totalSteps: (FixStep | null)[] = [null, { kind: 'total', mode: 'net_vat' }];
  if (!num0(input.otherCharges)) totalSteps.push({ kind: 'fees_from_diff' });
  if (num0(input.otherCharges) > 0) totalSteps.push({ kind: 'total', mode: 'net_vat_fees' });

  const out: (FixPlan & { score: number })[] = [];
  const seen = new Set<string>();
  for (const a of lineSteps) for (const b of vatSteps) for (const c of totalSteps) {
    const steps = [...a, b, c].filter((x): x is FixStep => x != null);
    if (!steps.length) continue;
    const result = applySteps(input, steps);
    if (!totalsClose(result)) continue;
    const key = JSON.stringify([result.subtotal, result.vatAmount, result.otherCharges, result.totalAmount, result.items.map((l) => [l.total, l.vatRate])]);
    if (seen.has(key)) continue;
    seen.add(key);
    // Αλλαγή του ΤΥΠΩΜΕΝΟΥ Γενικού Συνόλου είναι η λιγότερο πιθανή εξήγηση· επινοημένες επιβαρύνσεις επίσης.
    const touchesTotal = c?.kind === 'total' ? 2 : c?.kind === 'fees_from_diff' ? 1.5 : 0;
    out.push({ steps, result, score: steps.length + touchesTotal });
  }
  return out.sort((x, y) => x.score - y.score).slice(0, max).map(({ steps, result }) => ({ steps, result }));
}

/** Επιβαρύνσεις που δεν είναι γραμμή: στο SoftOne στέλνονται μόνο γραμμές, οπότε θα χάνονταν. */
export function feesNotInLines(input: TotalsInput): number | null {
  const f = n(input.otherCharges);
  return f != null && f > 0.005 ? round2(f) : null;
}
