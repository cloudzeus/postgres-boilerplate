// lib/ocr/blocker-actions.ts — ΚΑΘΑΡΟ (χωρίς prisma / δίκτυο / server-only).
//
// Κάθε εμπόδιο καταχώρισης → **τι το λύνει και πού**.
//
// Η σελίδα εκκρεμοτήτων μέχρι τώρα απαριθμούσε παραστατικά κατά κατάσταση και το μόνο που
// πρόσφερε ήταν ένας σύνδεσμος «Λίστα OCR». Ο χρήστης έβλεπε ΟΤΙ κάτι εκκρεμεί, ποτέ ΤΙ — και
// η διαδρομή μέχρι τη διόρθωση ήταν δική του δουλειά. Εδώ ζει η αντιστοίχιση εμποδίου → ενέργεια,
// ΜΙΑ φορά, ώστε να τη μοιράζονται η σελίδα εκκρεμοτήτων και η σελίδα του παραστατικού.

import type { BlockerCode } from './purdoc-payload';

export interface BlockerAction {
  /** Σύντομη ετικέτα για chip — ΟΧΙ ολόκληρη πρόταση. */
  short: string;
  /** Τι πρέπει να κάνει ο άνθρωπος, σε μία φράση προστακτικής. */
  fix: string;
  /** Το σημείο της εφαρμογής που το λύνει. `#` = μέσα στη σελίδα του παραστατικού. */
  anchor: string;
  /** Λύνεται μαζικά, χωρίς κρίση ανά παραστατικό; */
  bulk?: boolean;
}

/**
 * Η ΣΕΙΡΑ μετράει: τα εμπόδια εμφανίζονται με αυτήν, από «λείπει η ταυτότητα του παραστατικού»
 * προς «λείπει λεπτομέρεια γραμμής». Ένα παραστατικό χωρίς εκδότη δεν ωφελεί να δείχνει πρώτα
 * ότι του λείπει συντελεστής ΦΠΑ.
 */
export const BLOCKER_ORDER: BlockerCode[] = [
  'not_completed', 'no_number', 'no_date', 'no_lines', 'totals_mismatch',
  'no_trader', 'trader_kind_mismatch', 'no_series', 'series_unknown', 'series_module_unsupported',
  'no_category', 'unmatched_lines', 'lines_need_lineitem', 'lines_no_mtrtype',
  'line_discount_ambiguous', 'no_vat_category',
  'lines_need_mtrl', 'lines_need_expn', 'lines_lineitem_unsupported',
  'account_missing', 'account_not_in_chart', 'account_not_postable', 'account_is_mask',
];

export const BLOCKER_ACTIONS: Partial<Record<BlockerCode, BlockerAction>> = {
  no_trader:      { short: 'Συναλλασσόμενος', fix: 'Σύνδεσε ή δημιούργησε την καρτέλα του εκδότη', anchor: '#trader' },
  trader_kind_mismatch: { short: 'Λάθος τύπος καρτέλας', fix: 'Η σειρά θέλει άλλον τύπο — διόρθωσε τη σύνδεση', anchor: '#trader' },
  no_series:      { short: 'Σειρά', fix: 'Διάλεξε σειρά παραστατικού', anchor: '#series' },
  series_unknown: { short: 'Άγνωστη σειρά', fix: 'Η σειρά δεν αναγνωρίστηκε — όρισέ την', anchor: '#series' },
  series_module_unsupported: { short: 'Μη υποστηριζόμενη ενότητα', fix: 'Η ενότητα της σειράς δεν καταχωρείται ακόμη — άλλαξε σειρά', anchor: '#series' },
  no_category:    { short: 'Κατηγορία', fix: 'Όρισε κατηγορία εγγράφου', anchor: '#category', bulk: true },
  unmatched_lines:{ short: 'Γραμμές', fix: 'Αντιστοίχισε τις γραμμές σε είδος, υπηρεσία, έξοδο ή χρεοπίστωση', anchor: '#lines' },
  lines_need_lineitem: { short: 'Γραμμές → χρεοπίστωση', fix: 'Η σειρά δέχεται μόνο χρεοπιστώσεις — αντιστοίχισε ξανά', anchor: '#lines' },
  lines_no_mtrtype: { short: 'Τύπος χρεοπίστωσης', fix: 'Λείπει ο τύπος — συγχρόνισε το μητρώο χρεοπιστώσεων', anchor: '#lines' },
  line_discount_ambiguous: { short: 'Η γραμμή δεν βγαίνει', fix: 'Ποσότητα × τιμή δεν δίνει το σύνολο — διόρθωσε τιμή ή έκπτωση', anchor: '#lines' },
  no_vat_category:{ short: 'Συντελεστής ΦΠΑ', fix: 'Αντιστοίχισε τον συντελεστή με κατηγορία ΦΠΑ', anchor: '#vat', bulk: true },
  no_number:      { short: 'Αριθμός', fix: 'Συμπλήρωσε τον αριθμό του παραστατικού', anchor: '#fields' },
  no_date:        { short: 'Ημερομηνία', fix: 'Συμπλήρωσε την ημερομηνία', anchor: '#fields' },
  no_lines:       { short: 'Χωρίς γραμμές', fix: 'Το παραστατικό δεν έχει γραμμές — ξανατρέξε την ανάγνωση', anchor: '#lines' },
  totals_mismatch:{ short: 'Σύνολα', fix: 'Τα σύνολα δεν συμφωνούν με τις γραμμές — έλεγξέ τα', anchor: '#fields' },
  not_completed:  { short: 'Δεν ολοκληρώθηκε', fix: 'Η ανάγνωση δεν τελείωσε — ξανατρέξε την', anchor: '#fields' },
  account_missing:{ short: 'Λογαριασμός', fix: 'Η χρεοπίστωση δεν έχει λογαριασμό γενικής — όρισέ τον στο SoftOne', anchor: '#lines' },
  account_not_in_chart: { short: 'Λογαριασμός εκτός σχεδίου', fix: 'Ο λογαριασμός δεν υπάρχει — συγχρόνισε ή διόρθωσε', anchor: '#lines' },
  account_not_postable: { short: 'Λογαριασμός που δεν κινείται', fix: 'Συγκεντρωτικός λογαριασμός — διάλεξε αναλυτικό', anchor: '#lines' },
  account_is_mask: { short: 'Μάσκα λογαριασμού', fix: 'Ο λογαριασμός είναι μάσκα — όρισε πραγματικό', anchor: '#lines' },
  lines_need_mtrl: { short: 'Γραμμές → είδος', fix: 'Η σειρά δέχεται μόνο είδη — αντιστοίχισε ξανά', anchor: '#lines' },
  lines_need_expn: { short: 'Γραμμές → έξοδο', fix: 'Η σειρά δέχεται μόνο έξοδα — αντιστοίχισε ξανά', anchor: '#lines' },
  lines_lineitem_unsupported: { short: 'Χρεοπίστωση εκτός σειράς', fix: 'Η σειρά δεν δέχεται χρεοπιστώσεις — αντιστοίχισε αλλιώς', anchor: '#lines' },
};

/** Η ενέργεια ενός εμποδίου, με ασφαλές fallback για κωδικό που δεν έχει καταχωρηθεί εδώ. */
export function blockerAction(code: BlockerCode): BlockerAction {
  return BLOCKER_ACTIONS[code] ?? { short: code, fix: 'Άνοιξε το παραστατικό για λεπτομέρειες', anchor: '#' };
}

/** Τα εμπόδια ενός παραστατικού, ταξινομημένα κατά {@link BLOCKER_ORDER}. */
export function sortBlockers(codes: readonly BlockerCode[]): BlockerCode[] {
  const rank = (c: BlockerCode) => {
    const i = BLOCKER_ORDER.indexOf(c);
    return i === -1 ? BLOCKER_ORDER.length : i;
  };
  return [...codes].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** Πόσα παραστατικά εμποδίζει ο καθένας — για τη σύνοψη «τι φταίει». */
export function tallyBlockers(perDoc: readonly (readonly BlockerCode[])[]): { code: BlockerCode; docs: number }[] {
  const n = new Map<BlockerCode, number>();
  for (const codes of perDoc) for (const c of new Set(codes)) n.set(c, (n.get(c) ?? 0) + 1);
  return [...n.entries()]
    .map(([code, docs]) => ({ code, docs }))
    .sort((a, b) => b.docs - a.docs || BLOCKER_ORDER.indexOf(a.code) - BLOCKER_ORDER.indexOf(b.code));
}
