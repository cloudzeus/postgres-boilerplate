// lib/ocr/memory-scope.ts — ΚΑΘΑΡΟ. Ο «κόσμος» μιας σταθερής μνήμης (είδος χρέωσης / οικογένεια δαπάνης).
//
// ΤΟ ΠΡΟΒΛΗΜΑ. Η ίδια οικογένεια δαπάνης εμφανίζεται σε ΔΥΟ κόσμους με διαφορετικά μητρώα: σε σειρά
// αγορών (PURDOC) η γραμμή δέχεται είδος/υπηρεσία/ΕΞΟΔΟ, σε ειδικές συναλλαγές (LINLINES) μόνο
// ΧΡΕΟΠΙΣΤΩΣΗ. Ένας κοινός κανόνας «λογισμικό → έξοδο Χ» θα έστελνε τις γραμμές λογισμικού ενός
// παραστατικού πιστωτών σε στόχο που δεν χωράει — και η καταχώριση θα μπλόκαρε (`lines_misfit`).
//
// Η ΛΥΣΗ. (α) Το κλειδί κουβαλά τον κόσμο (`@family:software@24#pur` / `…#lin`), ώστε οι δύο
// αποφάσεις να συνυπάρχουν. (β) Κατά την ανάγνωση, κανόνας με στόχο που δεν χωράει στον κόσμο του
// παραστατικού ΑΓΝΟΕΙΤΑΙ — προστατεύει και από παλιούς κανόνες χωρίς κόσμο.

export type MemoryWorld = 'lin' | 'pur';

/** Ο κόσμος από τον πίνακα γραμμών της σειράς· άγνωστη σειρά ⇒ `null`. */
export function worldOfLines(lines: string | null | undefined): MemoryWorld | null {
  if (lines === 'LINLINES') return 'lin';
  if (lines === 'AUTO' || lines === 'ITELINES' || lines === 'SRVLINES' || lines === 'EXPANAL') return 'pur';
  return null;
}

/** Τα κλειδιά με τον κόσμο πρώτα (πιο ειδικά), μετά χωρίς — για ανάγνωση. */
export function scopeKeys(keys: readonly string[], world: MemoryWorld | null): string[] {
  return world ? [...keys.map((k) => `${k}#${world}`), ...keys] : [...keys];
}

/** Ένα κλειδί για ΕΓΓΡΑΦΗ: με κόσμο όταν τον ξέρουμε. */
export function scopeKey(key: string, world: MemoryWorld | null): string {
  return world ? `${key}#${world}` : key;
}

/** Χωράει ο στόχος του κανόνα στον κόσμο του παραστατικού; Άγνωστος κόσμος ⇒ ναι. */
export function ruleFitsWorld(r: { mtrl: number | null; expn: number | null; lin: number | null }, world: MemoryWorld | null): boolean {
  if (world === 'lin') return r.lin != null;
  if (world === 'pur') return r.mtrl != null || r.expn != null;
  return true;
}
