/**
 * Ελληνικά ονόματα χωρών για τα προθέματα VAT που αναγνωρίζουμε
 * (`VAT_COUNTRY_CODES` στο `lib/ocr/validate.ts`) — client-safe, χωρίς εξαρτήσεις.
 */
export const COUNTRY_NAMES_EL: Record<string, string> = {
  GR: 'Ελλάδα',
  AT: 'Αυστρία', BE: 'Βέλγιο', BG: 'Βουλγαρία', CY: 'Κύπρος', CZ: 'Τσεχία',
  DE: 'Γερμανία', DK: 'Δανία', EE: 'Εσθονία', ES: 'Ισπανία', FI: 'Φινλανδία',
  FR: 'Γαλλία', HR: 'Κροατία', HU: 'Ουγγαρία', IE: 'Ιρλανδία', IT: 'Ιταλία',
  LT: 'Λιθουανία', LU: 'Λουξεμβούργο', LV: 'Λετονία', MT: 'Μάλτα',
  NL: 'Ολλανδία', PL: 'Πολωνία', PT: 'Πορτογαλία', RO: 'Ρουμανία',
  SE: 'Σουηδία', SI: 'Σλοβενία', SK: 'Σλοβακία',
  GB: 'Ηνωμένο Βασίλειο', XI: 'Β. Ιρλανδία', CH: 'Ελβετία', NO: 'Νορβηγία',
  IS: 'Ισλανδία', LI: 'Λιχτενστάιν', SM: 'Άγιος Μαρίνος', MC: 'Μονακό',
};

/** «CY» → «Κύπρος (CY)». Άγνωστος κωδικός επιστρέφεται ως έχει. */
export function countryLabel(code: string | null | undefined): string {
  const c = String(code ?? '').trim().toUpperCase();
  if (!c) return '—';
  const name = COUNTRY_NAMES_EL[c];
  return name ? `${name} (${c})` : c;
}
