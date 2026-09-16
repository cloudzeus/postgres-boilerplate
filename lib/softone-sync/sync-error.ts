// lib/softone-sync/sync-error.ts — ΚΟΙΝΟ σε server και client (καμία εισαγωγή `server-only` εδώ).
//
// Η ΜΙΑ μετάφραση «σώμα σφάλματος συγχρονισμού → ελληνικό μήνυμα για τον χρήστη». Τα κουμπιά
// ανανέωσης των μητρώων έδειχναν το `message` ΜΟΝΟ για `softone_error`: έτσι το «τρέχει ήδη
// συγχρονισμός» έχανε το ποιος και πότε, το `database_error` την εξήγησή του, και το
// «λείπουν ρυθμίσεις» κατέληγε σκέτο «Αποτυχία συγχρονισμού» — χειρότερο από πριν.

/** Οι κωδικοί που επιστρέφουν τα `sync-*-softone` και το «Συγχρονισμός όλων». */
export type SyncErrorCode =
  | 'softone_error'
  | 'database_error'
  | 'softone_not_configured'
  | 'sync_running';

export type SyncErrorBody = { error?: string; message?: string } | null | undefined;

/**
 * Το μήνυμα που θα δει ο διαχειριστής. Το `message` του server ΝΙΚΑΕΙ πάντα, όταν υπάρχει:
 * είναι το μόνο που ξέρει ποιος ERP, ποιο πεδίο λείπει ή ποιος κρατάει τη σειρά.
 *
 * @param fallback τι να πει όταν ο server δεν έδωσε τίποτα αξιοποιήσιμο (π.χ. HTML από proxy).
 */
export function syncErrorMessage(body: SyncErrorBody, fallback = 'Αποτυχία συγχρονισμού'): string {
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  switch (body?.error as SyncErrorCode | undefined) {
    case 'softone_error':
      return message ? `Σφάλμα SoftOne: ${message}` : 'Σφάλμα SoftOne';
    case 'database_error':
      return message || 'Αποτυχία στην τοπική βάση δεδομένων';
    case 'softone_not_configured':
      return message || 'Λείπουν ρυθμίσεις SoftOne';
    case 'sync_running':
      return message || 'Τρέχει ήδη συγχρονισμός βοηθητικών πινάκων';
    default:
      return message || fallback;
  }
}
