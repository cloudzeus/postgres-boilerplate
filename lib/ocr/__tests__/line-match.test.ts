import { describe, it, expect } from 'vitest';
import { normalizeLineText, dice, scoreCandidates, groupLines, suggestTraderKind } from '../line-match';
describe('normalizeLineText', () => {
  it('lowercases, strips accents/punctuation/amounts and collapses spaces', () => {
    expect(normalizeLineText('ΥΓΡΟ ΑΖΩΤΟ  9.560 KG – 0,29200 €')).toBe('υγρο αζωτο kg');
    expect(normalizeLineText('Μεταφορές CONEX (7)')).toBe('μεταφορες conex');
  });
});
describe('dice', () => {
  it('is 1 for identical, 0 for disjoint, symmetric', () => { expect(dice('αζωτο υγρο', 'υγρο αζωτο')).toBeGreaterThan(0.7); expect(dice('abc', 'xyz')).toBe(0); expect(dice('a b', 'a b')).toBe(1); });
});
describe('scoreCandidates', () => {
  const cands = [{ id: 'm1', kind: 'product' as const, code: '00022', name: 'ΥΓΡΟ ΑΖΩΤΟ', code1: null, code2: null }, { id: 'm2', kind: 'product' as const, code: '76-71106', name: 'Ξηρός πάγος τροφίμων 16mm', code1: '4003773035114', code2: null }, { id: 'e1', kind: 'expense' as const, code: '6231', name: 'Λήψη υπηρεσιών', code1: null, code2: null }];
  it('exact code/barcode wins with 1.0, then name similarity', () => {
    const r = scoreCandidates({ code: '4003773035114', name: 'ΜΥΤΟΤΣΙΜΠΙΔΟ' }, cands);
    expect(r[0]).toMatchObject({ id: 'm2', score: 1, by: 'code1' });
    const s = scoreCandidates({ code: null, name: 'υγρο αζωτο 12.080 kg' }, cands);
    expect(s[0].id).toBe('m1'); expect(s[0].by).toBe('name'); expect(s[0].score).toBeGreaterThan(0.6);
  });
  it('drops candidates below 0.3 and caps at 5', () => { expect(scoreCandidates({ code: null, name: 'zzz' }, cands)).toEqual([]); });
});
describe('groupLines', () => {
  it('groups by issuer ΑΦΜ + normalized text, counting lines and documents', () => {
    const g = groupLines([{ id: '1', afm: '094073495', docId: 'a', name: 'ΥΓΡΟ ΑΖΩΤΟ 9.560 KG', code: '00022' }, { id: '2', afm: '094073495', docId: 'b', name: 'Υγρό Άζωτο 12.080 kg', code: '00022' }, { id: '3', afm: '1', docId: 'a', name: 'ΥΓΡΟ ΑΖΩΤΟ', code: null }]);
    expect(g).toHaveLength(2); expect(g[0]).toMatchObject({ afm: '094073495', pattern: 'υγρο αζωτο kg', lineIds: ['1', '2'], docCount: 2, code: '00022' });
  });
});
describe('suggestTraderKind', () => {
  it('creditor for service documents / creditor series, supplier otherwise', () => {
    expect(suggestTraderKind({ seriesKinds: ['creditor'], invoiceKinds: ['service'] })).toBe('creditor');
    expect(suggestTraderKind({ seriesKinds: [], invoiceKinds: ['product', 'mixed'] })).toBe('supplier');
    expect(suggestTraderKind({ seriesKinds: [], invoiceKinds: ['service', 'service', 'product'] })).toBe('creditor');
  });

  it('σειρά χρεωστών → πρόταση «χρεώστης», και προηγείται κάθε άλλης ένδειξης', () => {
    expect(suggestTraderKind({ seriesKinds: ['debtor'], invoiceKinds: [] })).toBe('debtor');
    // Η σειρά είναι ρητή ταξινόμηση· το «υπηρεσία» είναι απλή εικασία περιεχομένου.
    expect(suggestTraderKind({ seriesKinds: ['debtor'], invoiceKinds: ['service', 'service'] })).toBe('debtor');
    expect(suggestTraderKind({ seriesKinds: ['debtor', 'creditor'], invoiceKinds: [] })).toBe('debtor');
    // Χωρίς σειρά χρεωστών τίποτα δεν αλλάζει από πριν.
    expect(suggestTraderKind({ seriesKinds: ['purchase'], invoiceKinds: ['service'] })).toBe('creditor');
  });
});
