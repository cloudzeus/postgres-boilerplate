import { describe, it, expect } from 'vitest';
import { analyzeWithholding, isServiceInvoice, withholdingNote } from '../withholding';
import { normalizeDocument } from '../canonical';

const doc = (totals: Record<string, unknown>, type: Record<string, unknown> = {}) => normalizeDocument({ kind: 'invoice', totals, type, lines: [] });

describe('analyzeWithholding', () => {
  it('ΤΠΥ μηχανολόγου: 3% γνωστό ποσοστό, πληρωτέο συμφωνεί', () => {
    const a = analyzeWithholding(doc({ net: 3530, vatAmount: 847.2, total: 4377.2, payable: 4271.3, withholding: 105.9 }));
    expect(a).toMatchObject({ amount: 105.9, rate: 3, knownRate: 3, issues: [] });
    expect(withholdingNote(a)).toBe('Παρακράτηση φόρου 105,90 € (3%) — να καταχωριστεί στη SoftOne');
  });
  it('άγνωστο ποσοστό και πληρωτέο που δεν βγαίνει ⇒ παρατηρήσεις', () => {
    const a = analyzeWithholding(doc({ net: 1000, total: 1240, payable: 1100, withholding: 123 }));
    expect(a.knownRate).toBeNull();
    expect(a.issues).toHaveLength(2);
  });
  it('χωρίς ποσό, αλλά πληρωτέο < σύνολο ⇒ συνάγεται', () => {
    expect(analyzeWithholding(doc({ net: 1000, total: 1240, payable: 1040 })).amount).toBe(200);
  });
  it('παροχή υπηρεσιών > 300 € χωρίς παρακράτηση ⇒ πιθανή έλλειψη', () => {
    expect(analyzeWithholding(doc({ net: 500, total: 620 }), { isServiceInvoice: true }).maybeMissing).toBe(true);
    expect(analyzeWithholding(doc({ net: 200, total: 248 }), { isServiceInvoice: true }).maybeMissing).toBe(false);
  });
  it('isServiceInvoice: «Τιμολόγιο Παροχής Υπηρεσιών» / ΤΠΥ', () => {
    expect(isServiceInvoice(doc({}, { label: 'Τιμολόγιο Παροχής Υπηρεσιών' }))).toBe(true);
    expect(isServiceInvoice(doc({}, { label: 'Τιμολόγιο Πώλησης' }))).toBe(false);
  });
});
