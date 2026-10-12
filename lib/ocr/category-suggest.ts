// lib/ocr/category-suggest.ts — ΚΑΘΑΡΟ. Πρόταση ΚΑΤΗΓΟΡΙΑΣ για παραστατικό χωρίς κατηγορία.
//
// Η κατηγορία (Έξοδο / Τιμολόγιο αγοράς / Απόδειξη / Πιστωτικό …) είναι εμπόδιο καταχώρισης
// (`no_category`), αλλά σχεδόν πάντα προκύπτει από ό,τι ήδη ξέρουμε. Σειρά ισχύος, από το πιο ειδικό:
//  1. το ίδιο το έγγραφο: απόδειξη ⇒ Απόδειξη, πιστωτικό ⇒ Πιστωτικό (υψηλή βεβαιότητα)·
//  2. ο ΕΚΔΟΤΗΣ: η κατηγορία που πήραν τα προηγούμενα παραστατικά του (υψηλή)·
//  3. οι ΓΡΑΜΜΕΣ: σε τι αντιστοιχίστηκαν — είδη/πάγια ⇒ Τιμολόγιο αγοράς, έξοδα/χρεοπιστώσεις ⇒ Έξοδο (μέτρια)·
//  4. η ΣΕΙΡΑ: η κατηγορία της πλειονότητας των παραστατικών της ίδιας σειράς (μέτρια)·
//  5. η ΕΝΟΤΗΤΑ της σειράς: ειδικές συναλλαγές ⇒ Έξοδο, αγορές ⇒ Τιμολόγιο αγοράς (χαμηλή).
// Κάθε πρόταση λέει ΓΙΑΤΙ, ώστε ο χρήστης να εγκρίνει μαζικά με γνώση.

export type OcrCategoryValue = 'EXPENSE' | 'INVOICE_IN' | 'INVOICE_OUT' | 'RECEIPT' | 'CREDIT_NOTE' | 'PAYROLL' | 'TAX' | 'OTHER';
export type Confidence = 'high' | 'mid' | 'low';

export const CATEGORY_LABEL: Record<OcrCategoryValue, string> = {
  EXPENSE: 'Έξοδο',
  INVOICE_IN: 'Τιμολόγιο αγοράς',
  INVOICE_OUT: 'Τιμολόγιο πώλησης',
  RECEIPT: 'Απόδειξη',
  CREDIT_NOTE: 'Πιστωτικό',
  PAYROLL: 'Μισθοδοσία',
  TAX: 'Φόρος',
  OTHER: 'Άλλο',
};

export interface CategoryInput {
  /** `document.kind`: invoice | receipt | general … */
  kind: string | null;
  /** `document.type.label` — τίτλος όπως τυπώθηκε. */
  typeLabel: string | null;
  /** `document.type.myDataType` (π.χ. 5.1 = πιστωτικό). */
  myDataType: string | null;
  seriesSource: number | null;
  /** Πόσες γραμμές ταίριαξαν σε είδος/πάγιο και πόσες σε έξοδο/χρεοπίστωση. */
  lines: { goods: number; expenses: number };
  /** Κατηγορίες των άλλων παραστατικών του ίδιου εκδότη. */
  issuerHistory: Partial<Record<OcrCategoryValue, number>>;
  /** Κατηγορίες των άλλων παραστατικών της ίδιας σειράς. */
  seriesHistory: Partial<Record<OcrCategoryValue, number>>;
}

export interface CategorySuggestion {
  category: OcrCategoryValue;
  label: string;
  reason: string;
  confidence: Confidence;
}

const fold = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

function majority(h: Partial<Record<OcrCategoryValue, number>>): { category: OcrCategoryValue; n: number; total: number } | null {
  const rows = Object.entries(h).filter(([, n]) => (n ?? 0) > 0) as [OcrCategoryValue, number][];
  if (!rows.length) return null;
  rows.sort((a, b) => b[1] - a[1]);
  return { category: rows[0][0], n: rows[0][1], total: rows.reduce((a, [, n]) => a + n, 0) };
}

const make = (category: OcrCategoryValue, reason: string, confidence: Confidence): CategorySuggestion =>
  ({ category, label: CATEGORY_LABEL[category], reason, confidence });

/** Η προτεινόμενη κατηγορία. `null` μόνο όταν δεν υπάρχει ΚΑΝΕΝΑ στοιχείο (ούτε σειρά). */
export function suggestCategory(i: CategoryInput): CategorySuggestion | null {
  const label = fold(i.typeLabel);
  if (i.kind === 'receipt' || /ΑΠΟΔΕΙΞΗ|RECEIPT/.test(label)) return make('RECEIPT', 'Το έγγραφο είναι απόδειξη.', 'high');
  if (/^5(\.|$)/.test(i.myDataType ?? '') || /ΠΙΣΤΩΤΙΚ|CREDIT NOTE/.test(label)) return make('CREDIT_NOTE', 'Το έγγραφο είναι πιστωτικό.', 'high');

  const issuer = majority(i.issuerHistory);
  if (issuer) return make(issuer.category, `Ο ίδιος εκδότης: ${issuer.n} από ${issuer.total} παραστατικά του είναι «${CATEGORY_LABEL[issuer.category]}».`, 'high');

  const { goods, expenses } = i.lines;
  if (goods + expenses > 0 && goods !== expenses) {
    return goods > expenses
      ? make('INVOICE_IN', `Οι γραμμές αντιστοιχίστηκαν σε είδη/πάγια (${goods} από ${goods + expenses}).`, 'mid')
      : make('EXPENSE', `Οι γραμμές αντιστοιχίστηκαν σε έξοδα/χρεοπιστώσεις (${expenses} από ${goods + expenses}).`, 'mid');
  }

  // Έντυπο χωρίς μορφή τιμολογίου (π.χ. «φόρμα εκκαθάρισης εξόδων»): η πλειονότητα της σειράς δεν λέει
  // τίποτα γι' αυτό — τα τιμολόγια της ίδιας σειράς είναι άλλου είδους έγγραφα.
  if (i.kind === 'general') return make('EXPENSE', 'Έγγραφο χωρίς μορφή τιμολογίου — προτείνεται «Έξοδο», έλεγξέ το.', 'low');

  const series = majority(i.seriesHistory);
  if (series && series.total >= 2 && series.n / series.total >= 0.7) {
    return make(series.category, `Η ίδια σειρά: ${series.n} από ${series.total} παραστατικά είναι «${CATEGORY_LABEL[series.category]}».`, 'mid');
  }

  if (i.seriesSource === 1253 || i.seriesSource === 1653 || i.seriesSource === 1553) {
    return make('EXPENSE', 'Η σειρά είναι ειδικών συναλλαγών — συνήθως έξοδο.', 'low');
  }
  if (i.seriesSource === 1251) return make('INVOICE_IN', 'Η σειρά είναι παραστατικών αγορών.', 'low');
  if (i.kind === 'invoice') return make('INVOICE_IN', 'Τιμολόγιο χωρίς σειρά — προτείνεται «Τιμολόγιο αγοράς», έλεγξέ το.', 'low');
  return null;
}
