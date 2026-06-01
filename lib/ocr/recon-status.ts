/**
 * Reconciliation status (η «εκκρεμότητα» κάθε παραστατικού).
 *
 * The status is **derived** from the document's existing fields — there is no stored
 * status column. The only persisted piece is the hybrid manual lock `reconOverride`
 * (null = auto, RESOLVED = ολοκληρώθηκε, IGNORED = αγνοήθηκε), which short-circuits
 * the derivation so a human can take a document out of the εκκρεμότητες list.
 *
 * Shared by the OCR table badge, the per-day "Προβλήματα & λύσεις" modal, and the
 * /admin/ocr/pending overview, so the rules live in exactly one place.
 */

export type ReconStatus =
  | 'PROCESSING'       // OCR ακόμη τρέχει — δεν είναι εκκρεμότητα χρήστη
  | 'ERROR'            // OCR απέτυχε
  | 'NEEDS_REVIEW'     // ολοκληρώθηκε αλλά χωρίς κατηγορία
  | 'NO_SUPPLIER'      // δεν βρέθηκε προμηθευτής (ΑΦΜ) στο SoftOne
  | 'UNMATCHED_LINES'  // γραμμές χωρίς αντιστοίχιση σε MTRL
  | 'DUPLICATE'        // πιθανό διπλό στο SoftOne (PURDOC)
  | 'READY'            // έτοιμο προς ανάρτηση
  | 'POSTED'           // αναρτήθηκε — ολοκληρωμένο
  | 'RESOLVED'         // χειροκίνητα «ολοκληρώθηκε»
  | 'IGNORED';         // χειροκίνητα «αγνοήθηκε»

/** The minimal document shape the derivation needs. */
export interface ReconInput {
  status: string;                 // OcrStatus
  category: string | null;        // OcrCategory
  postStatus: string;             // OcrPostStatus
  softoneTrdr: number | null;
  softoneDocExists: boolean | null;
  itemsTotal: number | null;
  itemsMatched: number | null;
  reconOverride: string | null;   // null | RESOLVED | IGNORED
}

export interface ReconMeta {
  status: ReconStatus;
  /** Greek label for the badge. */
  label: string;
  /** Inline hex tokens (badge bg / fg / border) — DG warm palette, theme-safe. */
  tone: { bg: string; fg: string; bd: string };
  /** Whether this counts as an outstanding item (εκκρεμότητα) needing user action. */
  pending: boolean;
  /** Short problem statement (only meaningful when pending). */
  problem: string | null;
  /** Suggested fix shown in the "Προβλήματα & λύσεις" modal. */
  solution: string | null;
}

const TONE = {
  slate:   { bg: '#F1F5F9', fg: '#334155', bd: '#E2E8F0' },
  red:     { bg: '#FEF2F2', fg: '#B91C1C', bd: '#FECACA' },
  amber:   { bg: '#FFF8EE', fg: '#92400E', bd: '#FCD9A8' },
  orange:  { bg: '#FFF1E6', fg: '#C2410C', bd: '#FFD8B5' },
  blue:    { bg: '#EAF2FF', fg: '#1D4ED8', bd: '#BFD7FF' },
  emerald: { bg: '#ECFDF5', fg: '#047857', bd: '#A7F3D0' },
} as const;

const META: Record<ReconStatus, Omit<ReconMeta, 'status'>> = {
  PROCESSING:      { label: 'Σε επεξεργασία',     tone: TONE.slate,   pending: false, problem: null, solution: null },
  ERROR:           { label: 'Σφάλμα OCR',         tone: TONE.red,     pending: true,  problem: 'Η αναγνώριση απέτυχε.', solution: 'Κάνε «Επανασκανάρισμα (HQ)» από το μενού ενεργειών της γραμμής.' },
  NEEDS_REVIEW:    { label: 'Προς έλεγχο',        tone: TONE.amber,   pending: true,  problem: 'Δεν έχει οριστεί κατηγορία.', solution: 'Άνοιξε τη γραμμή και όρισε κατηγορία (Έξοδο, Τιμολόγιο αγοράς, κ.λπ.).' },
  NO_SUPPLIER:     { label: 'Χωρίς προμηθευτή',   tone: TONE.orange,  pending: true,  problem: 'Το ΑΦΜ εκδότη δεν αντιστοιχίστηκε σε προμηθευτή SoftOne.', solution: 'Έλεγξε ΑΦΜ στο SoftOne ή δημιούργησε προμηθευτή (ΑΑΔΕ) από το μενού ενεργειών.' },
  UNMATCHED_LINES: { label: 'Ασυσχέτιστες γραμμές', tone: TONE.orange, pending: true, problem: 'Υπάρχουν γραμμές χωρίς αντιστοίχιση σε είδος/υπηρεσία SoftOne.', solution: 'Άνοιξε τη γραμμή → «Συσχέτιση με SoftOne» και αντιστοίχισε ή δημιούργησε τα είδη που λείπουν.' },
  DUPLICATE:       { label: 'Πιθανό διπλό',       tone: TONE.amber,   pending: true,  problem: 'Βρέθηκε πιθανό υπάρχον παραστατικό στο SoftOne (PURDOC).', solution: 'Επιβεβαίωσε ότι δεν είναι ήδη καταχωρημένο. Αν είναι σωστό διπλό, σήμανε «Αγνόηση».' },
  READY:           { label: 'Έτοιμο προς ανάρτηση', tone: TONE.blue,  pending: true,  problem: 'Είναι έτοιμο αλλά δεν έχει αναρτηθεί στο SoftOne.', solution: 'Κάνε «Ανάρτηση στο SoftOne» (ανά γραμμή ή μαζικά από την κεφαλίδα ημέρας).' },
  POSTED:          { label: 'Αναρτήθηκε',         tone: TONE.emerald, pending: false, problem: null, solution: null },
  RESOLVED:        { label: 'Ολοκληρώθηκε',       tone: TONE.emerald, pending: false, problem: null, solution: null },
  IGNORED:         { label: 'Αγνοήθηκε',          tone: TONE.slate,   pending: false, problem: null, solution: null },
};

/** Pure derivation of the document's reconciliation status. */
export function deriveReconStatus(d: ReconInput): ReconStatus {
  // Manual hybrid lock wins (except we never hide a still-processing/errored doc behind it).
  if (d.reconOverride === 'IGNORED') return 'IGNORED';
  if (d.reconOverride === 'RESOLVED') return 'RESOLVED';

  if (d.status === 'FAILED') return 'ERROR';
  if (d.status !== 'COMPLETED') return 'PROCESSING';

  if (d.postStatus === 'POSTED') return 'POSTED';
  if (d.softoneDocExists === true) return 'DUPLICATE';
  if (!d.category) return 'NEEDS_REVIEW';
  if (!d.softoneTrdr) return 'NO_SUPPLIER';
  if (d.itemsTotal != null && d.itemsTotal > 0 && (d.itemsMatched ?? 0) < d.itemsTotal) return 'UNMATCHED_LINES';
  return 'READY';
}

export function reconMeta(d: ReconInput): ReconMeta {
  const status = deriveReconStatus(d);
  return { status, ...META[status] };
}

export function reconMetaFor(status: ReconStatus): ReconMeta {
  return { status, ...META[status] };
}

/** Stable ordering for grouping the pending overview (most urgent first). */
export const RECON_PENDING_ORDER: ReconStatus[] = [
  'ERROR', 'DUPLICATE', 'NEEDS_REVIEW', 'NO_SUPPLIER', 'UNMATCHED_LINES', 'READY',
];
