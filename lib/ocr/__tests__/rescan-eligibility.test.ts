import { describe, it, expect } from 'vitest';
import { acceptReading, carryDecisions, rescanSkipReason } from '../rescan-eligibility';
import { normalizeDocument } from '../canonical';

const F = { status: 'COMPLETED', postStatus: 'NONE', verified: false, handEdited: false, allocations: 0 };

describe('μαζική επανασάρωση: ποια παραλείπονται', () => {
  it('καθαρό παραστατικό ⇒ ξαναδιαβάζεται', () => expect(rescanSkipReason(F)).toBeNull());
  it('καταχωρισμένο, σε εξέλιξη, διορθωμένο, μοιρασμένο ή επιβεβαιωμένο ⇒ παράλειψη με λόγο', () => {
    expect(rescanSkipReason({ ...F, postStatus: 'POSTED' })).toMatch(/καταχωριστεί/);
    expect(rescanSkipReason({ ...F, status: 'PROCESSING' })).toMatch(/επεξεργάζεται/);
    expect(rescanSkipReason({ ...F, handEdited: true })).toMatch(/χειροκίνητες/);
    expect(rescanSkipReason({ ...F, allocations: 2 })).toMatch(/μοίρασμα/);
    expect(rescanSkipReason({ ...F, verified: true })).toMatch(/επιβεβαιωθεί/);
  });
});

describe('οι αποφάσεις του χρήστη επιβιώνουν της νέας ανάγνωσης', () => {
  it('σύνδεση πιστωτικού και απόφαση παρακράτησης περνούν στη νέα ανάγνωση', () => {
    const before = normalizeDocument({ kind: 'credit_note', references: { related: 'ΤΠΥ 17', linkedFindoc: 115571, linkedLabel: 'ΤΠΥ 17' }, custom: { withholdingAck: true } });
    const next = normalizeDocument({ kind: 'credit_note', references: { related: 'ΤΠΥ 17' } });
    const out = carryDecisions(before, next);
    expect(out.references.linkedFindoc).toBe(115571);
    expect((out.custom as Record<string, unknown>).withholdingAck).toBe(true);
  });
  it('χωρίς αποφάσεις ⇒ η νέα ανάγνωση ως έχει', () => {
    const next = normalizeDocument({ kind: 'invoice' });
    expect(carryDecisions(normalizeDocument({ kind: 'invoice' }), next)).toBe(next);
  });
});

describe('ποτέ υποβάθμιση μοντέλου', () => {
  it('pro > flash > flash-lite, με ή χωρίς πρόθεμα παρόχου', () => {
    expect(acceptReading('gemini-2.5-flash', 'gemini-2.5-flash-lite')).toBe(false);
    expect(acceptReading('gemini-2.5-flash', 'google/gemini-2.5-pro')).toBe(true);
    expect(acceptReading('gemini-2.5-flash', 'gemini-2.5-flash')).toBe(true);
    expect(acceptReading(null, 'gemini-2.5-flash-lite')).toBe(true);
  });
});
