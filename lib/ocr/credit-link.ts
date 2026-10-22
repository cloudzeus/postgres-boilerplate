// Σύνδεση ΠΙΣΤΩΤΙΚΟΥ με το αρχικό παραστατικό — καθαρό module (χωρίς I/O).
//
// Ένα πιστωτικό ακυρώνει (ολικά ή μερικά) ένα τιμολόγιο. Στη SoftOne η σύνδεση είναι το πεδίο
// «Παραστατικό προέλευσης» (`FINDOCS`) της κεφαλίδας — μετρημένο στη Demo (22/10/2026, `calculate`):
// πιστωτικό σειράς 1102 με FINDOCS 115571 γυρίζει με FINDOCS 115571 και τύπο «102 · Πιστωτικό».
// Χωρίς σύνδεση, ο λογιστής δεν ξέρει τι πιστώνεται και το υπόλοιπο του αρχικού δεν κλείνει.

export interface CreditSignals {
  /** Όνομα της σειράς της SoftOne (π.χ. «Πιστωτικό τιμολογίου παροχής υπηρεσιών»). */
  seriesName?: string | null;
  /** Κατηγορία της εφαρμογής (`CREDIT_NOTE`). */
  category?: string | null;
  /** Τύπος myDATA (5.1 / 5.2 = πιστωτικό). */
  myDataType?: string | null;
  /** Ο τίτλος όπως τυπώθηκε. */
  typeLabel?: string | null;
}

const fold = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Είναι πιστωτικό; Από τη σειρά πρώτα (αυτή αποφασίζει πού καταχωρείται), μετά από τα στοιχεία του χαρτιού. */
export function isCreditNote(s: CreditSignals): boolean {
  if (/πιστωτικ|credit/.test(fold(s.seriesName))) return true;
  if (s.category === 'CREDIT_NOTE') return true;
  if (/^5\.(1|2)$/.test(String(s.myDataType ?? '').trim())) return true;
  return /πιστωτικ|credit note/.test(fold(s.typeLabel));
}

export interface CreditCandidate {
  findoc: number;
  number: string | null;
  date: string | null;
  total: number | null;
  /** Από πού το ξέρουμε: καταχωρίστηκε από την εφαρμογή ή βρέθηκε στη SoftOne. */
  source: 'app' | 'softone';
  label: string;
}

/** Μόνο ψηφία/γράμματα, χωρίς μηδενικά μπροστά — «ΤΠΥ 0000017» ≈ «17». */
const key = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^0-9A-ZΑ-Ω]/g, '').replace(/^[A-ZΑ-Ω]+/, '').replace(/^0+/, '');

/** Ταιριάζει ο αριθμός που τυπώθηκε στο πιστωτικό («Αφορά το τιμολόγιο 17») με τον αριθμό του υποψήφιου; */
export function sameDocNumber(printed: string | null | undefined, candidate: string | null | undefined): boolean {
  const a = key(printed), b = key(candidate);
  return a.length > 0 && a === b;
}

/** Η πρόταση: ο υποψήφιος με τον αριθμό που τυπώθηκε· αλλιώς κανείς (δεν μαντεύουμε). */
export function suggestOriginal(printed: string | null | undefined, candidates: readonly CreditCandidate[]): CreditCandidate | null {
  if (!printed) return null;
  const hits = candidates.filter((c) => sameDocNumber(printed, c.number));
  // Ίδιο FINDOC από δύο πηγές = ένας υποψήφιος.
  const unique = [...new Map(hits.map((h) => [h.findoc, h])).values()];
  return unique.length === 1 ? unique[0] : null;
}
