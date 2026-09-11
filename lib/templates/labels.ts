// lib/templates/labels.ts — ISOMORPHIC Greek labels for template enums (designer + run views).
import { DOCUMENT_SCHEMA, type DocumentKeyInfo, type ActionType, type ClauseOp, type FieldValue, type RunStatus, type RunTrigger, type TemplateFieldKind, type TemplateMode, type TemplateValueType } from './schema';

export const MODE_LABEL: Record<TemplateMode, string> = { AUTO: 'Αυτόματο', SEMI_AUTO: 'Ημιαυτόματο', MANUAL: 'Χειροκίνητο' };
export const MODE_HELP: Record<TemplateMode, string> = {
  AUTO: 'Εξαγωγή → mapping → conditions → ανάρτηση στο SoftOne χωρίς έλεγχο (εκτός αν κανόνας μπλοκάρει).',
  SEMI_AUTO: 'Εξαγωγή → mapping → conditions → «Προς έλεγχο». Η ανάρτηση γίνεται από χρήστη.',
  MANUAL: 'Μόνο εξαγωγή πεδίων σε JSON. Χωρίς mapping/ανάρτηση — τα υπόλοιπα γίνονται χειροκίνητα.',
};
export const STATUS_LABEL = { DRAFT: 'Πρόχειρο', ACTIVE: 'Ενεργό' } as const;
export const KIND_LABEL: Record<TemplateFieldKind, string> = { SINGLE: 'Απλή τιμή', TABLE: 'Πίνακας' };
export const VALUE_TYPE_LABEL: Record<TemplateValueType, string> = { TEXT: 'Κείμενο', NUMBER: 'Αριθμός', CURRENCY: 'Ποσό', DATE: 'Ημερομηνία', LIST: 'Λίστα' };
export const OP_LABEL: Record<ClauseOp, string> = {
  eq: 'ίσο με', neq: 'διάφορο από', gt: 'μεγαλύτερο από', gte: '≥', lt: 'μικρότερο από', lte: '≤',
  contains: 'περιέχει', notContains: 'δεν περιέχει', empty: 'είναι κενό', notEmpty: 'δεν είναι κενό', regex: 'ταιριάζει regex', in: 'είναι ένα από',
};
export const OPS_WITHOUT_VALUE: ClauseOp[] = ['empty', 'notEmpty'];
export const ACTION_LABEL: Record<ActionType, string> = {
  SET_FIELD: 'Όρισε τιμή', FLAG_REVIEW: 'Σήμανε για έλεγχο', BLOCK_POSTING: 'Μπλόκαρε ανάρτηση', SWITCH_MAPPING: 'Άλλαξε mapping', NOTIFY: 'Ειδοποίηση email',
};
export const EXTRA_VARS = [
  { key: '$total', label: 'Σύνολο τιμολογίου (OCR)' },
  { key: '$itemsCount', label: 'Πλήθος γραμμών (OCR)' },
  { key: '$pageCount', label: 'Πλήθος σελίδων' },
];
/**
 * Οι διαδρομές του κανονικού εγγράφου ομαδοποιημένες για το select του mapping. Ένα `<optgroup>` ανά
 * ομάδα: 60+ διαδρομές σε μια ενιαία λίστα είναι αδύνατο να διαβαστούν.
 * Η σειρά των προθεμάτων ΕΙΝΑΙ η σειρά των ομάδων· ό,τι δεν ταιριάζει πουθενά πάει στα «Λοιπά».
 */
const KEY_GROUP_PREFIXES: { label: string; prefixes: string[] }[] = [
  { label: 'Τύπος & ημερομηνία', prefixes: ['type.', 'date', 'dueDate', 'currency'] },
  { label: 'Εκδότης', prefixes: ['issuer.'] },
  { label: 'Παραλήπτης', prefixes: ['recipient.'] },
  { label: 'Σύνολα', prefixes: ['totals.'] },
  { label: 'Γραμμές', prefixes: ['lines.'] },
  { label: 'Ψηφιακή σήμανση', prefixes: ['digital.'] },
  { label: 'Πληρωμή', prefixes: ['payment.'] },
  { label: 'Αναφορές', prefixes: ['references.'] },
  { label: 'Χειρόγραφα & σημειώσεις', prefixes: ['handwritten.', 'notes'] },
];

export type DocumentKeyGroup = { label: string; keys: DocumentKeyInfo[] };

export const DOCUMENT_KEY_GROUPS: DocumentKeyGroup[] = (() => {
  const groups: DocumentKeyGroup[] = KEY_GROUP_PREFIXES.map((g) => ({ label: g.label, keys: [] }));
  const rest: DocumentKeyInfo[] = [];
  for (const k of DOCUMENT_SCHEMA) {
    const i = KEY_GROUP_PREFIXES.findIndex((g) => g.prefixes.some((p) => (p.endsWith('.') ? k.key.startsWith(p) : k.key === p)));
    if (i >= 0) groups[i].keys.push(k);
    else rest.push(k);
  }
  if (rest.length) groups.push({ label: 'Λοιπά', keys: rest });
  return groups.filter((g) => g.keys.length > 0);
})();

/** @deprecated Χρησιμοποίησε `DOCUMENT_KEY_GROUPS`. */
export const INVOICE_KEY_GROUPS = DOCUMENT_KEY_GROUPS;
export const RUN_STATUS_LABEL: Record<RunStatus, string> = { EXTRACTED: 'Εξήχθη', REVIEW: 'Προς έλεγχο', BLOCKED: 'Μπλοκαρισμένο', POSTED: 'Αναρτήθηκε', FAILED: 'Απέτυχε' };
export const TRIGGER_LABEL: Record<RunTrigger, string> = { upload: 'στο upload', manual: 'χειροκίνητα', reextract: 'στην επανεξαγωγή' };
/** How a stored value was produced (TemplateRun.values[key].source). */
export const SOURCE_LABEL: Record<FieldValue['source'], string> = { text: 'κείμενο', vision: 'μοντέλο', manual: 'χειροκίνητο', rule: 'κανόνας', none: '—' };

/** Εργασίες μαζικής σάρωσης (spec §12) — η κατάσταση, όπως τη διαβάζει ο χρήστης. */
export const JOB_STATUS_LABEL = {
  QUEUED: 'Σε αναμονή', RUNNING: 'Τρέχει', DONE: 'Ολοκληρώθηκε', FAILED: 'Απέτυχε', CANCELLED: 'Ακυρώθηκε',
} as const;
export const JOB_ITEM_STATUS_LABEL = {
  QUEUED: 'Σε αναμονή', RUNNING: 'Διαβάζεται', DONE: 'Διαβάστηκε', FAILED: 'Απέτυχε',
} as const;
/** Inline hex (παλέτα DG) — ο JIT του Tailwind καθαρίζει ό,τι χτίζεται δυναμικά. */
export const JOB_STATUS_STYLE: Record<keyof typeof JOB_STATUS_LABEL, { bg: string; fg: string }> = {
  QUEUED: { bg: '#F3F2F1', fg: '#5C5C5C' },
  RUNNING: { bg: '#EAF4FC', fg: '#0078D4' },
  DONE: { bg: '#E8F7F0', fg: '#047857' },
  FAILED: { bg: '#FDECEA', fg: '#B91C1C' },
  CANCELLED: { bg: '#FDF3E3', fg: '#B45309' },
};
