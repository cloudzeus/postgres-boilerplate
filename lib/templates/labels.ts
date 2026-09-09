// lib/templates/labels.ts — ISOMORPHIC Greek labels for template enums (designer + run views).
import { INVOICE_SCHEMA, type ActionType, type ClauseOp, type TemplateFieldKind, type TemplateMode, type TemplateValueType } from './schema';

export const MODE_LABEL: Record<TemplateMode, string> = { AUTO: 'Αυτόματο', SEMI_AUTO: 'Ημιαυτόματο', MANUAL: 'Χειροκίνητο' };
export const MODE_HELP: Record<TemplateMode, string> = {
  AUTO: 'Εξαγωγή → mapping → conditions → ανάρτηση στο SoftOne χωρίς έλεγχο (εκτός αν κανόνας μπλοκάρει).',
  SEMI_AUTO: 'Εξαγωγή → mapping → conditions → «Προς έλεγχο». Η ανάρτηση γίνεται από χρήστη.',
  MANUAL: 'Μόνο εξαγωγή πεδίων. Τα υπόλοιπα γίνονται χειροκίνητα.',
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
/** Invoice keys grouped for the mapping select. */
export const INVOICE_KEY_GROUPS = [
  { label: 'Κεφαλίδα', keys: INVOICE_SCHEMA.filter((k) => !k.isLine) },
  { label: 'Γραμμές', keys: INVOICE_SCHEMA.filter((k) => k.isLine) },
];
