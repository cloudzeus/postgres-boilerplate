// lib/item-units.ts — ΚΑΘΑΡΟ. Μονάδες μέτρησης είδους: βασική, αγορών, πώλησης.
//
// Στη SoftOne (object ITEM → MTRL):
//   MTRUNIT1 «Μ.Μ»          βασική μονάδα (σε αυτήν μετράει η αποθήκη) — π.χ. Τεμάχια
//   MTRUNIT3 «Μ.Μ.Αγορών»   + MU31 «Σχέση με κύρια» = πόσες ΒΑΣΙΚΕΣ σε 1 μονάδα αγοράς (κιβώτιο = 100)
//   MTRUNIT4 «Μ.Μ.Πώλησης»  + MU41
//   MU13MODE / MU14MODE «Αυστ.σχέση» = η σχέση είναι σταθερή (1)
//
// Στο παραστατικό αγοράς (PURDOC → ITELINES) η μονάδα κίνησης είναι η ΜΟΝΑΔΑ ΑΓΟΡΩΝ:
//   `QTY` «Ποσ.(Τ)» = ποσότητα στη μονάδα αγορών, `PRICE` = τιμή ΑΝΑ μονάδα αγορών,
//   και η SoftOne γράφει μόνη της `QTY1` «Ποσ.1» = QTY × MU31 στη βασική.
// Επιβεβαιωμένο με `calculate` (15/10/2026, είδος με MU31 = 2): QTY 2 → QTY1 4, αξία 2 × τιμή.

export interface ItemUnits {
  /** MTRUNIT1 — βασική. */
  base: string;
  /** MTRUNIT3 — μονάδα αγορών (κενό = ίδια με τη βασική). */
  buy?: string | null;
  /** MU31 — βασικές ανά 1 μονάδα αγορών. */
  buyRatio?: number | null;
  /** MTRUNIT4 — μονάδα πώλησης (κενό = ίδια με τη βασική). */
  sell?: string | null;
  sellRatio?: number | null;
}

const MAX_RATIO = 1_000_000;

/** Το ζεύγος (μονάδα, σχέση) όπως θα γραφτεί: ίδια με τη βασική ⇒ σχέση 1. */
export function normalizeUnitPair(base: string, unit: string | null | undefined, ratio: number | null | undefined): { unit: string; ratio: number } {
  const u = String(unit ?? '').trim() || base;
  if (u === base) return { unit: base, ratio: 1 };
  const r = Number(ratio);
  return { unit: u, ratio: Number.isFinite(r) && r > 0 ? r : 1 };
}

/** Ελληνικό μήνυμα για λάθος σχέση, ή `null`. */
export function unitsError(u: ItemUnits): string | null {
  if (!String(u.base ?? '').trim()) return 'Η βασική μονάδα μέτρησης είναι υποχρεωτική.';
  for (const [unit, ratio, label] of [[u.buy, u.buyRatio, 'αγορών'], [u.sell, u.sellRatio, 'πώλησης']] as const) {
    const un = String(unit ?? '').trim();
    if (!un || un === u.base) continue;
    const r = Number(ratio);
    if (!Number.isFinite(r) || r <= 0) return `Γράψε πόσες βασικές μονάδες έχει 1 μονάδα ${label} (θετικός αριθμός).`;
    if (r > MAX_RATIO) return `Η σχέση της μονάδας ${label} είναι υπερβολικά μεγάλη.`;
  }
  return null;
}

/** Τα πεδία του ITEM για τις μονάδες (ΟΧΙ για υπηρεσία: ο πίνακας SERVICE έχει μόνο MTRUNIT1). */
export function itemUnitFields(u: ItemUnits): Record<string, unknown> {
  const buy = normalizeUnitPair(u.base, u.buy, u.buyRatio);
  const sell = normalizeUnitPair(u.base, u.sell, u.sellRatio);
  return {
    MTRUNIT1: u.base,
    MTRUNIT3: buy.unit, MU31: buy.ratio,
    MTRUNIT4: sell.unit, MU41: sell.ratio,
    // Σταθερή σχέση: ένα κιβώτιο ΕΧΕΙ 100 τεμάχια — όχι «περίπου, όπως πει ο χρήστης στην κίνηση».
    ...(buy.unit !== u.base ? { MU13MODE: 1 } : {}),
    ...(sell.unit !== u.base ? { MU14MODE: 1 } : {}),
  };
}

/** Ποσότητα στη βασική μονάδα για ποσότητα στη μονάδα αγορών (στρογγυλή σε 4 δεκαδικά). */
export function toBaseQty(qty: number, ratio: number | null | undefined): number {
  const r = Number(ratio) > 0 ? Number(ratio) : 1;
  return Math.round(qty * r * 10_000) / 10_000;
}

/**
 * Πρόταση σχέσης από την ΠΕΡΙΓΡΑΦΗ της γραμμής: «ΚΟΥΤΙ 100 ΤΕΜ», «x100», «100 τμχ», «12pcs»,
 * «Box of 50», «συσκ. 6». `null` όταν δεν φαίνεται κάτι αξιόπιστο. Η πρόταση ΔΕΝ εφαρμόζεται
 * μόνη της — ο χρήστης τη βλέπει και την πατά.
 */
export function ratioFromText(text: string | null | undefined): number | null {
  const t = String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const patterns: RegExp[] = [
    /(?:^|[^A-ZΑ-Ω0-9])(?:X|×)\s?(\d{1,5})(?![\d.,])/,                                           // x100
    /(\d{1,5})\s?(?:ΤΕΜ|ΤΜΧ|ΤΕΜΑΧΙΑ|PCS|PC|PZ|PEZZI|STK|STUCK|UNITS|ΤΜ)(?![A-ZΑ-Ω])/,              // 100 ΤΕΜ
    /(?:BOX|PACK|ΚΙΒ(?:ΩΤΙΟ)?|ΚΟΥΤΙ|ΣΥΣΚ(?:ΕΥΑΣΙΑ)?|ΠΑΚ(?:ΕΤΟ)?|CONF)\.?\s?(?:OF\s)?(\d{1,5})(?![\d.,])/, // BOX 50
  ];
  for (const re of patterns) {
    const m = re.exec(t);
    const n = m ? Number(m[1]) : NaN;
    if (Number.isFinite(n) && n >= 2 && n <= 10_000) return n;
  }
  return null;
}
