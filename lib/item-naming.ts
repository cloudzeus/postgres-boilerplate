// Ονόματα νέων ειδών/υπηρεσιών: πεζά/κεφαλαία και αρχική (ξένη) περιγραφή στο NAME1.
//
// Ρυθμίσεις → «Αρχικοποίηση εφαρμογής»:
//   `setup.itemNameCase`      'asis' | 'upper' | 'lower' — πώς γράφεται το NAME στη SoftOne.
//   `setup.itemAutoTranslate` ξένη περιγραφή → ελληνικά στο NAME, η αρχική στο NAME1 («Περιγραφή 2»).
//
// ΚΑΘΑΡΟ module (χωρίς server deps): το χρησιμοποιεί και ο server (πριν το setData) και το UI
// (προεπισκόπηση «Θα καταχωρηθεί ως …»), ώστε ό,τι βλέπει ο χρήστης να είναι ό,τι γράφεται.

export type NameCase = 'asis' | 'upper' | 'lower';

export const NAME_CASE_OPTIONS: { value: NameCase; label: string }[] = [
  { value: 'asis', label: 'Όπως γράφονται' },
  { value: 'upper', label: 'ΚΕΦΑΛΑΙΑ (χωρίς τόνους)' },
  { value: 'lower', label: 'πεζά (με τόνους)' },
];

/** Όριο του `NAME` / `NAME1` στο `MTRL` (schema: size 128). */
export const ITEM_NAME_MAX = 128;

export function parseNameCase(v: unknown): NameCase {
  return v === 'upper' || v === 'lower' ? v : 'asis';
}

// Ό,τι αφήνει τυχόν το toLocaleUpperCase (π.χ. runtime χωρίς ICU): τονισμένα κεφαλαία → άτονα,
// διαλυτικά με τόνο → μόνο διαλυτικά (ΐ → Ϊ, ΰ → Ϋ). Τα διαλυτικά ΜΕΝΟΥΝ: αλλάζουν την προφορά.
const GREEK_TONOS: Record<string, string> = {
  'Ά': 'Α', 'Έ': 'Ε', 'Ή': 'Η', 'Ί': 'Ι', 'Ό': 'Ο', 'Ύ': 'Υ', 'Ώ': 'Ω', 'ΐ': 'Ϊ', 'ΰ': 'Ϋ',
};

/** Αφαιρεί τους ελληνικούς τόνους από κεφαλαία· τα λατινικά διακριτικά (È, Ü) μένουν. */
export function stripGreekTonos(s: string): string {
  return s.replace(/[ΆΈΉΊΌΎΏΐΰ]/g, (c) => GREEK_TONOS[c] ?? c);
}

/**
 * Το όνομα όπως θα γραφτεί. Κεφαλαία: ελληνική ορθογραφία κεφαλαίων — χωρίς τόνους, με διαλυτικά
 * όπου χρειάζονται («άι» → «ΑΪ»). Πεζά: με τελικό «ς» και όσους τόνους υπάρχουν ήδη — όσους λείπουν
 * (κείμενο από ΚΕΦΑΛΑΙΑ) τους βάζει ο server (`resolveItemNames`). Κενά συμπτύσσονται, όριο 128.
 */
export function applyNameCase(name: string, mode: NameCase): string {
  const clean = String(name ?? '').replace(/\s+/g, ' ').trim();
  const out = mode === 'upper' ? stripGreekTonos(clean.toLocaleUpperCase('el-GR'))
    : mode === 'lower' ? clean.toLocaleLowerCase('el-GR')
      : clean;
  return out.slice(0, ITEM_NAME_MAX);
}

/**
 * Μορφή σύγκρισης: χωρίς διακριτικά, πεζά, «ς» → «σ», ένα κενό. Δύο κείμενα με την ίδια μορφή
 * διαφέρουν ΜΟΝΟ σε τόνους/διαλυτικά/πεζά-κεφαλαία.
 */
export function foldForCompare(s: string): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('el-GR').replace(/ς/g, 'σ').replace(/\s+/g, ' ').trim();
}

/** Πεζό ελληνικό κείμενο χωρίς ούτε έναν τόνο (π.χ. από ΚΕΦΑΛΑΙΑ τιμολογίου) — θέλει τονισμό. */
export function needsAccenting(lower: string): boolean {
  const greekWords = lower.match(/[α-ωϊϋς]{2,}/g) ?? [];
  return greekWords.length > 0 && !/[άέήίόύώΐΰ]/.test(lower);
}

/**
 * Ο τονισμός (από AI) γίνεται δεκτός ΜΟΝΟ αν άλλαξαν αποκλειστικά τόνοι/διαλυτικά: ίδια γράμματα,
 * ίδιοι αριθμοί και κωδικοί, ίδια σειρά. Αλλιώς κρατάμε τα άτονα πεζά — ποτέ «διορθωμένη» λέξη.
 */
export function acceptAccented(source: string, candidate: string | null | undefined): string | null {
  const c = String(candidate ?? '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('el-GR');
  if (!c || foldForCompare(c) !== foldForCompare(source)) return null;
  return c.slice(0, ITEM_NAME_MAX);
}

/** Έχει το κείμενο περισσότερα λατινικά από ελληνικά γράμματα; (τότε αξίζει μετάφραση) */
export function looksForeign(text: string): boolean {
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  const greek = (text.match(/[Α-Ωα-ωάέήίόύώΆΈΉΊΌΎΏϊϋΐΰ]/g) ?? []).length;
  return latin >= 4 && latin > greek;
}

/**
 * Τα δύο ονόματα που στέλνονται: `name` (ελληνικό, με την επιλογή πεζών/κεφαλαίων) και `name1`
 * (η αρχική ξένη περιγραφή, ίδια μορφοποίηση) — ή `null` όταν δεν έγινε μετάφραση ή συμπίπτουν.
 */
export function finalItemNames(name: string, original: string | null | undefined, mode: NameCase): { name: string; name1: string | null } {
  const n = applyNameCase(name, mode);
  const o = original ? applyNameCase(original, mode) : '';
  return { name: n, name1: o && o !== n ? o : null };
}
