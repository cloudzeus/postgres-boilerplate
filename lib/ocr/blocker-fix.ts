// «Λύσε»: για κάθε εμπόδιο καταχώρισης, ΠΟΥ στη σελίδα διορθώνεται — καθαρό module.
//
// Πριν, η λίστα εμποδίων ήταν σκέτο κείμενο: ο χρήστης διάβαζε «Υπάρχουν γραμμές χωρίς αντιστοίχιση»
// και έψαχνε μόνος του πού γίνεται αυτό. Τώρα κάθε εμπόδιο έχει κουμπί που πηγαίνει ΑΚΡΙΒΩΣ εκεί
// (ή ανοίγει το σωστό εργαλείο). Εμπόδιο χωρίς δρόμο μέσα στη σελίδα λέει ποιος το λύνει.

export type FixTarget =
  | { kind: 'section'; section: 'fields' | 'lines' | 'amounts' | 'checks' | 'series' | 'category' | 'template' }
  | { kind: 'tool'; tool: 'lines' | 'rescan' }
  | { kind: 'admin' };

export interface BlockerFix { label: string; target: FixTarget }

const go = (section: Extract<FixTarget, { kind: 'section' }>['section'], label: string): BlockerFix => ({ label, target: { kind: 'section', section } });
const tool = (t: 'lines' | 'rescan', label: string): BlockerFix => ({ label, target: { kind: 'tool', tool: t } });
const admin: BlockerFix = { label: 'Χρειάζεται διαχειριστή', target: { kind: 'admin' } };

const FIX: Record<string, BlockerFix> = {
  not_completed: tool('rescan', 'Επανασάρωση'),
  no_category: go('category', 'Διάλεξε κατηγορία'),
  line_discount_ambiguous: tool('lines', 'Διόρθωσε τη γραμμή'),
  no_trader: go('checks', 'Δημιούργησε εκδότη'),
  no_trader_afm_missing: go('fields', 'Συμπλήρωσε ΑΦΜ'),
  no_trader_afm_invalid: go('fields', 'Διόρθωσε ΑΦΜ'),
  trader_kind_mismatch: go('checks', 'Διόρθωσε τον εκδότη'),
  no_series: go('series', 'Διάλεξε είδος παραστατικού'),
  series_unknown: go('series', 'Διάλεξε άλλο'),
  series_module_unsupported: go('series', 'Διάλεξε άλλο'),
  no_date: go('fields', 'Συμπλήρωσε ημερομηνία'),
  no_number: go('fields', 'Συμπλήρωσε αριθμό'),
  no_lines: tool('lines', 'Πρόσθεσε γραμμές'),
  unmatched_lines: go('lines', 'Πήγαινε στις γραμμές'),
  no_vat_category: go('checks', 'Όρισε κωδικό ΦΠΑ'),
  totals_mismatch: go('amounts', 'Δες τα ποσά'),
  lines_need_mtrl: go('lines', 'Πήγαινε στις γραμμές'),
  lines_need_expn: go('lines', 'Πήγαινε στις γραμμές'),
  lines_need_lineitem: go('lines', 'Πήγαινε στις γραμμές'),
  lines_lineitem_unsupported: go('series', 'Άλλαξε είδος παραστατικού'),
  lines_sxdoc_unsupported: go('series', 'Άλλαξε είδος παραστατικού'),
  lines_asset_unsupported: go('series', 'Άλλαξε είδος παραστατικού'),
  registry_not_in_installation: go('lines', 'Πήγαινε στις γραμμές'),
  account_missing: go('lines', 'Πήγαινε στις γραμμές'),
  account_not_in_chart: go('lines', 'Πήγαινε στις γραμμές'),
  account_not_postable: go('lines', 'Πήγαινε στις γραμμές'),
  account_is_mask: admin,
  asset_no_whouse: admin,
  lines_no_mtrtype: admin,
  rule_blocked: go('template', 'Δες τον κανόνα'),
};

export function blockerFix(code: string): BlockerFix | null {
  return FIX[code] ?? null;
}
