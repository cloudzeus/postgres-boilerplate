import type { MatchKind } from '@/lib/ocr/line-match';

/**
 * Κοινά για τη στήλη «SoftOne» του πίνακα γραμμών. ΧΩΡΙΣ `'use client'` επίτηδες: ο
 * πίνακας είναι server component και χρειάζεται το `matchKindOf` για να βρει την
 * προεπιλεγμένη κατηγορία του παραστατικού — μια συνάρτηση από `'use client'` αρχείο
 * δεν καλείται από τον server, μόνο αποδίδεται ως component.
 */

/** Η αντιστοίχιση μιας γραμμής όπως τη γράφει η βάση (`OcrInvoiceItem`). */
export interface LineMatch {
  mtrl: number | null;
  expn: number | null;
  lin: number | null;
  code: string | null;
  name: string | null;
  isService: boolean | null;
  matchedBy: string | null;
}

/** Μία κατηγορία δαπάνης (LINCATEGORY) — στενεύει τη λίστα χρεοπιστώσεων. */
export interface LineCategoryOption { id: number; label: string }

/** Σε ποια κατηγορία ανήκει μια ήδη γραμμένη αντιστοίχιση. `null` = καμία. */
export function matchKindOf(m: LineMatch | null | undefined): MatchKind | null {
  if (!m) return null;
  if (m.lin != null) return 'lineitem';
  if (m.expn != null) return 'expense';
  if (m.mtrl != null) return m.isService ? 'service' : 'product';
  return null;
}
