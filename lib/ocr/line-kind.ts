// lib/ocr/line-kind.ts — ΚΑΘΑΡΟ (χωρίς prisma / δίκτυο).
//
// «Τι ΕΙΔΟΥΣ εγγραφή μητρώου χρειάζεται αυτή η γραμμή;» — είδος, υπηρεσία, έξοδο ή χρεοπίστωση.
//
// Η προηγούμενη απάντηση ήταν σταθερά **`'product'`** όταν δεν υπήρχε τίποτα άλλο. Αυτό δεν ήταν
// προεπιλογή, ήταν **ισχυρισμός**: μια χρέωση cloud της Google και ένα ΨΩΜΙ από ταβέρνα έπαιρναν
// και τα δύο chip «Προϊόν», και ο χρήστης δεν είχε κανέναν τρόπο να ξεχωρίσει «το ξέρω» από «δεν
// ξέρω». Για μια επιχείρηση που σαρώνει ΕΙΣΕΡΧΟΜΕΝΑ τιμολόγια και δεν μεταπωλεί, το `'product'`
// είναι επιπλέον και η χειρότερη δυνατή εικασία: σχεδόν όλα είναι έξοδα ή υπηρεσίες.
//
// Ο κανόνας εδώ είναι ο ίδιος με όλη την εφαρμογή: **χωρίς απόδειξη, καμία δήλωση** — `null`
// («χωρίς κατηγορία»), και ο χρήστης ή το μοντέλο αποφασίζει.

import type { MatchKind } from '@/lib/ocr/line-match';
import type { PostLineTable } from '@/lib/ocr/posting-target';

/**
 * Ο πίνακας γραμμών του προορισμού ΟΡΙΖΕΙ το μητρώο: μια γραμμή που θα καταχωρηθεί σε
 * `LINLINES` **πρέπει** να δείχνει σε χρεοπίστωση (`MTRL` 53) — δεν είναι εικασία, είναι η δομή
 * του ERP. Το `AUTO` (PURDOC «ανά γραμμή») δεν λέει τίποτα: εκεί χωράνε και τα τρία.
 */
export const KIND_FOR_LINE_TABLE: Record<PostLineTable, MatchKind | null> = {
  AUTO: null,
  ITELINES: 'product',
  SRVLINES: 'service',
  EXPANAL: 'expense',
  LINLINES: 'lineitem',
};

/**
 * Λέξεις που δηλώνουν **αναμφισβήτητα** υπηρεσία μέσα στην ίδια την περιγραφή της γραμμής.
 *
 * Σκόπιμα ΜΙΚΡΗ λίστα. Δελεαστικές αλλά διφορούμενες λέξεις («ρεύμα», «ενοίκιο», «συνδρομή»,
 * «μεταφορικά») έμειναν ΕΞΩ: στο SoftOne μπορεί κάλλιστα να είναι **έξοδο** (`EXPN`) ή
 * **χρεοπίστωση** αντί για υπηρεσία (`MTRL` 52), και ένα λάθος chip με σιγουριά είναι χειρότερο
 * από ένα κενό. Ό,τι δεν πιάνεται εδώ πάει στο μοντέλο ή στον χρήστη.
 */
const SERVICE_WORDS = [
  'υπηρεσι', 'υπηρεσία', 'παροχη υπηρεσιων', 'service', 'services',
];

/** Κανονικοποίηση για τη σύγκριση λέξεων: πεζά, χωρίς τόνους. */
const fold = (s: string): string =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** `true` όταν η περιγραφή περιέχει αναμφισβήτητη ένδειξη υπηρεσίας. */
export function looksLikeService(text: string): boolean {
  const t = fold(text);
  return SERVICE_WORDS.some((w) => t.includes(fold(w)));
}

export interface KindEvidence {
  /** Ο τύπος που θυμάται ο κανόνας (`LineMatchRule`) — η ΙΣΧΥΡΟΤΕΡΗ απόδειξη. */
  memoryKind?: MatchKind | null;
  /** `true` όταν κάποια γραμμή της ομάδας έχει ήδη ταιριάξει σε υπηρεσία του SoftOne. */
  matchedService?: boolean;
  /**
   * Οι πίνακες γραμμών των παραστατικών της ομάδας (από τη σειρά του καθενός). Μετρά ΜΟΝΟ όταν
   * συμφωνούν όλοι: μια ομάδα που εμφανίζεται και σε αγορά και σε ειδική συναλλαγή δεν έχει
   * έναν προορισμό, άρα δεν έχει και έναν τύπο.
   */
  lineTables?: (PostLineTable | null)[];
  /** Η περιγραφή-δείγμα της ομάδας, για τον τελευταίο, συντηρητικό έλεγχο λέξεων. */
  sample?: string | null;
}

/**
 * Ο τύπος της ομάδας από ΝΤΕΤΕΡΜΙΝΙΣΤΙΚΕΣ ενδείξεις, με φθίνουσα ισχύ:
 *
 *  1. **Μνήμη** (`LineMatchRule`) — ο χρήστης το έχει ήδη αποφασίσει μία φορά.
 *  2. **Ήδη ταιριασμένη υπηρεσία** σε κάποια γραμμή της ομάδας.
 *  3. **Ο προορισμός της σειράς** (`LINLINES` → χρεοπίστωση, `EXPANAL` → έξοδο, `ITELINES` →
 *     είδος, `SRVLINES` → υπηρεσία) — δομή του ERP, όχι εικασία. Μόνο όταν ΟΛΑ τα παραστατικά
 *     της ομάδας συμφωνούν.
 *  4. **Αναμφισβήτητη λέξη υπηρεσίας** στην περιγραφή.
 *
 * Οτιδήποτε άλλο: `null` — «χωρίς κατηγορία».
 */
export function inferLineKind(ev: KindEvidence): MatchKind | null {
  if (ev.memoryKind) return ev.memoryKind;
  if (ev.matchedService) return 'service';

  const tables = (ev.lineTables ?? []).filter((t): t is PostLineTable => t != null);
  if (tables.length > 0) {
    const kinds = new Set(tables.map((t) => KIND_FOR_LINE_TABLE[t]));
    if (kinds.size === 1) {
      const only = [...kinds][0];
      if (only) return only;
    }
  }

  if (ev.sample && looksLikeService(ev.sample)) return 'service';
  return null;
}
