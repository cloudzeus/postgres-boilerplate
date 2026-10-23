// Αυτόματες διορθώσεις ανάγνωσης γραμμών — καθαρό module (χωρίς I/O), ντετερμινιστικό.
//
// ΓΙΑΤΙ. Το μοντέλο διαβάζει σωστά τους ΑΡΙΘΜΟΥΣ αλλά τους βάζει σε λάθος ρόλο σε λίγα, γνωστά μοτίβα.
// Όλα μετρήθηκαν σε πραγματικά παραστατικά (22–23/10/2026) και όλα κόλλαγαν την καταχώριση:
//   • ΑΠΟΔΕΙΞΗ ΚΑΥΣΙΜΩΝ: η αντλία τυπώνει τιμή ΜΕ ΦΠΑ (21,87 lt × 1,829 = 40,00 € = ΣΥΝΟΛΟ), ενώ η
//     καθαρή αξία της γραμμής είναι 32,26 — ΜΥΡΤΕΑ, ΜΑΚΡΑΙΩΝ, ΚΑΛΥΨΩ.
//   • ΧΙΛΙΑΔΕΣ ΜΕ ΤΕΛΕΙΑ: «11.373 kg» διαβάστηκε 11,373 (11,373 × 0,57626 ≠ 6.553,80) — ΡΕΒΟΙΛ.
//   • ΕΚΠΤΩΣΗ ΠΟΥ ΔΕΝ ΓΡΑΦΤΗΚΕ: 5 × 450 = 2.250 αλλά αξία 1.316,25 (έκπτωση 41,5%) — Entersoftone.
//   • ΓΡΑΜΜΗ ΧΩΡΙΣ ΦΠΑ: τέλος ΕΤΕ 75,52 με κενή στήλη ΦΠΑ, διαβάστηκε 6% — Coral Gas.
// Κάθε κανόνας εφαρμόζεται ΜΟΝΟ όταν η γραμμή ΔΕΝ βγαίνει αριθμητικά και η διόρθωση την κάνει να
// βγαίνει ΑΚΡΙΒΩΣ — δεν μαντεύουμε. Η αξία (`net`) της γραμμής δεν αλλάζει ποτέ: είναι το τυπωμένο
// ποσό που αθροίζει στο σύνολο. Κάθε διόρθωση καταγράφεται και φαίνεται στον χρήστη.

import type { DocumentJson } from './canonical';
import { analyzeLine } from './invoice-math';

export type AutoRepairKind = 'gross_unit_price' | 'thousands_quantity' | 'line_discount' | 'zero_vat_line' | 'vat_from_header';

export interface AutoRepair {
  kind: AutoRepairKind;
  /** Γραμμή (0-based). */
  row: number;
  /** Ανθρώπινη περιγραφή («1,829 → 1,47508 (τιμή αντλίας με ΦΠΑ)»). */
  text: string;
}

const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const close = (a: number, b: number, rel = 0.002) => Math.abs(a - b) <= Math.max(0.02, Math.abs(b) * rel);
const el = (v: number, d = 2) => v.toLocaleString('el-GR', { minimumFractionDigits: 0, maximumFractionDigits: d });

type Line = DocumentJson['lines'][number];

const consistent = (l: Pick<Line, 'quantity' | 'unitPrice' | 'discount' | 'net'>) =>
  analyzeLine({ quantity: l.quantity, price: l.unitPrice, discount: l.discount, total: l.net }).consistent;

/** Η διόρθωση μίας γραμμής, ή `null`. Η σειρά των κανόνων = από τον πιο συχνό στον πιο σπάνιο. */
function repairLine(l: Line): { line: Line; kind: AutoRepairKind; text: string } | null {
  const q = num(l.quantity), p = num(l.unitPrice), net = num(l.net), rate = num(l.vatRate);
  if (q == null || p == null || net == null || q === 0 || net === 0) return null;
  if (consistent(l)) return null;
  const gross = q * p;
  const disc = num(l.discount) ?? 0;

  // 1. Τιμή μονάδας ΜΕ ΦΠΑ (αντλία καυσίμων, λιανική): ποσότητα × τιμή = καθαρή × (1 + ΦΠΑ).
  if (disc === 0 && rate != null && rate > 0 && close(gross, net * (1 + rate / 100))) {
    const np = r6(net / q);
    return { line: { ...l, unitPrice: np }, kind: 'gross_unit_price', text: `τιμή μονάδας ${el(p, 4)} → ${el(np, 6)} (η τυπωμένη τιμή περιείχε ΦΠΑ ${el(rate)}%)` };
  }
  // 2. Ποσότητα με τελεία χιλιάδων («11.373» = έντεκα χιλιάδες): × 1.000 βγάζει ακριβώς την αξία.
  if (disc === 0 && q < 1000 && !Number.isInteger(q) && close(q * 1000 * p, net)) {
    const nq = Math.round(q * 1000 * 1000) / 1000;
    return { line: { ...l, quantity: nq }, kind: 'thousands_quantity', text: `ποσότητα ${el(q, 3)} → ${el(nq, 3)} (η τελεία ήταν διαχωριστικό χιλιάδων)` };
  }
  // 3. Έκπτωση που δεν διαβάστηκε: αξία < ποσότητα × τιμή, και καθαρό ποσοστό (βήμα 0,5%) την εξηγεί.
  if (disc === 0 && gross > net) {
    const pct = Math.round((1 - net / gross) * 200) / 2;
    if (pct >= 0.5 && pct <= 90 && close(gross * (1 - pct / 100), net, 0.001)) {
      return { line: { ...l, discount: pct }, kind: 'line_discount', text: `έκπτωση ${el(pct, 1)}% (${el(gross)} → ${el(net)})` };
    }
  }
  return null;
}

/**
 * Γραμμή με κενή στήλη ΦΠΑ που διαβάστηκε με τον συντελεστή των άλλων: ο ΦΠΑ της κεφαλίδας βγαίνει
 * ΑΚΡΙΒΩΣ μόνο αν ΜΙΑ συγκεκριμένη γραμμή είναι 0%. Αν το εξηγούν δύο γραμμές, δεν διαλέγουμε.
 */
function zeroVatLine(doc: DocumentJson): number | null {
  const vat = num(doc.totals?.vatAmount);
  if (vat == null || doc.lines.length < 2) return null;
  const lineVat = (l: Line) => (num(l.net) ?? 0) * (num(l.vatRate) ?? 0) / 100;
  const sum = doc.lines.reduce((t, l) => t + lineVat(l), 0);
  if (close(r2(sum), vat, 0.0005)) return null;
  const fits = doc.lines
    .map((l, i) => ({ i, rest: sum - lineVat(l), rate: num(l.vatRate) ?? 0 }))
    .filter((x) => x.rate > 0 && Math.abs(r2(x.rest) - vat) <= 0.02);
  return fits.length === 1 ? fits[0].i : null;
}

const STANDARD_RATES = [24, 17, 13, 9, 6, 4, 0];

/**
 * ΚΑΜΙΑ γραμμή δεν έχει συντελεστή ΦΠΑ, αλλά η κεφαλίδα τον λέει μονοσήμαντα (ΦΠΑ ÷ καθαρή = γνωστός
 * συντελεστής — π.χ. 0 σε ενδοκοινοτικό/τρίτη χώρα, 24 σε απλό τιμολόγιο). Χωρίς συντελεστή η γραμμή δεν
 * βρίσκει κωδικό ΦΠΑ στη SoftOne και η καταχώριση σταματούσε (Chemical Partners, BESSEY).
 */
function headerRate(doc: DocumentJson): number | null {
  if (!doc.lines.length || doc.lines.some((l) => num(l.vatRate) != null)) return null;
  const net = num(doc.totals?.net), vat = num(doc.totals?.vatAmount);
  if (net == null || net <= 0 || vat == null) return null;
  const r = (vat / net) * 100;
  return STANDARD_RATES.find((x) => Math.abs(x - r) <= 0.05) ?? null;
}

/** Εφαρμόζει τις αυτόματες διορθώσεις και επιστρέφει το νέο έγγραφο + τι έγινε (κενό = τίποτα). */
export function autoRepairLines(doc: DocumentJson): { document: DocumentJson; repairs: AutoRepair[] } {
  const repairs: AutoRepair[] = [];
  let lines = doc.lines.map((l, i) => {
    const r = repairLine(l);
    if (!r) return l;
    repairs.push({ kind: r.kind, row: i, text: r.text });
    return r.line;
  });
  const hr = headerRate({ ...doc, lines });
  if (hr != null) {
    repairs.push({ kind: 'vat_from_header', row: 0, text: `ΦΠΑ ${el(hr)}% σε όλες τις γραμμές (από τα σύνολα του παραστατικού — οι γραμμές δεν είχαν συντελεστή)` });
    lines = lines.map((x) => ({ ...x, vatRate: hr }));
  }
  const z = zeroVatLine({ ...doc, lines });
  if (z != null) {
    const l = lines[z];
    repairs.push({ kind: 'zero_vat_line', row: z, text: `ΦΠΑ ${el(num(l.vatRate) ?? 0)}% → 0% (μόνο έτσι βγαίνει ο ΦΠΑ της κεφαλίδας)` });
    lines = lines.map((x, i) => (i === z ? { ...x, vatRate: 0, vatAmount: 0 } : x));
  }
  if (!repairs.length) return { document: doc, repairs };
  const custom = { ...(doc.custom ?? {}) } as Record<string, unknown>;
  const prev = Array.isArray(custom.autoRepairs) ? (custom.autoRepairs as AutoRepair[]) : [];
  custom.autoRepairs = [...prev, ...repairs];
  return { document: { ...doc, lines, custom }, repairs };
}

/** Οι διορθώσεις που έχουν καταγραφεί στο έγγραφο (για την παρατήρηση της καταχώρισης). */
export function recordedRepairs(doc: DocumentJson | null | undefined): AutoRepair[] {
  const v = (doc?.custom as Record<string, unknown> | undefined)?.autoRepairs;
  return Array.isArray(v) ? (v as AutoRepair[]) : [];
}

/**
 * Λείπουν σελίδες; Η κεφαλίδα κλείνει μόνη της αλλά οι γραμμές καλύπτουν κάτω από το μισό της καθαρής
 * αξίας (Azelis: 772,40 από 30.245,28 — το αρχείο είχε μόνο τη σελίδα με το σύνολο).
 */
export function likelyMissingPages(doc: DocumentJson): boolean {
  const net = num(doc.totals?.net);
  if (net == null || net <= 0 || !doc.lines.length) return false;
  const sum = doc.lines.reduce((t, l) => t + (num(l.net) ?? 0), 0);
  const total = num(doc.totals?.total), vat = num(doc.totals?.vatAmount) ?? 0, fees = num(doc.totals?.fees) ?? 0;
  const headerOk = total == null || close(net + vat + fees, total);
  return headerOk && sum > 0 && sum < net * 0.5;
}
