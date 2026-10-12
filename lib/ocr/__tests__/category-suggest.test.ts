import { describe, it, expect } from 'vitest';
import { suggestCategory, type CategoryInput } from '../category-suggest';

const base: CategoryInput = {
  kind: 'invoice', typeLabel: 'ΤΙΜΟΛΟΓΙΟ', myDataType: null, seriesSource: 1251,
  lines: { goods: 0, expenses: 0 }, issuerHistory: {}, seriesHistory: {},
};

describe('suggestCategory', () => {
  it('απόδειξη και πιστωτικό από το ίδιο το έγγραφο', () => {
    expect(suggestCategory({ ...base, kind: 'receipt' })).toMatchObject({ category: 'RECEIPT', confidence: 'high' });
    expect(suggestCategory({ ...base, typeLabel: 'ΠΙΣΤΩΤΙΚΟ ΤΙΜΟΛΟΓΙΟ' })).toMatchObject({ category: 'CREDIT_NOTE' });
    expect(suggestCategory({ ...base, myDataType: '5.1' })).toMatchObject({ category: 'CREDIT_NOTE' });
  });

  it('ο εκδότης υπερισχύει γραμμών και σειράς', () => {
    const s = suggestCategory({ ...base, issuerHistory: { EXPENSE: 3, INVOICE_IN: 1 }, lines: { goods: 5, expenses: 0 }, seriesHistory: { INVOICE_IN: 20 } });
    expect(s).toMatchObject({ category: 'EXPENSE', confidence: 'high' });
    expect(s?.reason).toMatch(/3 από 4/);
  });

  it('οι γραμμές: είδη ⇒ τιμολόγιο αγοράς, έξοδα ⇒ έξοδο', () => {
    expect(suggestCategory({ ...base, lines: { goods: 3, expenses: 1 } })).toMatchObject({ category: 'INVOICE_IN', confidence: 'mid' });
    expect(suggestCategory({ ...base, lines: { goods: 0, expenses: 2 } })).toMatchObject({ category: 'EXPENSE', confidence: 'mid' });
  });

  it('η σειρά μόνο με καθαρή πλειονότητα (≥70%, τουλάχιστον 2)', () => {
    expect(suggestCategory({ ...base, seriesSource: 1653, seriesHistory: { EXPENSE: 5, INVOICE_IN: 1 } })).toMatchObject({ category: 'EXPENSE', confidence: 'mid' });
    // 1 από 1 δεν αρκεί → κανόνας ενότητας
    expect(suggestCategory({ ...base, seriesHistory: { EXPENSE: 1 } })).toMatchObject({ category: 'INVOICE_IN', confidence: 'low' });
  });

  it('κανόνας ενότητας και γενικό έγγραφο', () => {
    expect(suggestCategory({ ...base, seriesSource: 1653 })).toMatchObject({ category: 'EXPENSE', confidence: 'low' });
    expect(suggestCategory({ ...base, kind: 'general', typeLabel: null })).toMatchObject({ category: 'EXPENSE', confidence: 'low' });
    expect(suggestCategory({ ...base, seriesSource: null })).toMatchObject({ category: 'INVOICE_IN', confidence: 'low' });
    expect(suggestCategory({ ...base, kind: 'general', seriesSource: null })).toMatchObject({ category: 'EXPENSE' });
    expect(suggestCategory({ ...base, kind: null, typeLabel: null, seriesSource: null })).toBeNull();
    // Φόρμα εξόδων σε σειρά τιμολογίων αγοράς: η πλειονότητα της σειράς δεν μετράει.
    expect(suggestCategory({ ...base, kind: 'general', typeLabel: null, seriesHistory: { INVOICE_IN: 21, RECEIPT: 1 } })).toMatchObject({ category: 'EXPENSE' });
  });
});
