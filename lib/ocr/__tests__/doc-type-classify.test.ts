import { describe, it, expect } from 'vitest';
import { normalizeGreek, familyOf, classifySeries, type SeriesCandidate } from '../doc-type-classify';
const C = (code: string, abbrev: string, name: string, kind: 'purchase' | 'creditor', sosource = kind === 'purchase' ? 1251 : 1653): SeriesCandidate => ({ code, abbrev, name, kind, sosource });
const purchases = [C('2061', 'ΤΙΜΑ', 'Τιμολόγιο Αγοράς', 'purchase'), C('2062', 'ΤΔΑΠ', 'Τιμολόγιο Αγοράς-Δελτίο Αποστολής', 'purchase'), C('2081', 'ΠΤΑ', 'Πιστωτικό Τιμολόγιο Αγοράς', 'purchase'), C('2041', 'ΔΕΑΠ', 'Δελτίο Αποστολής Προμηθευτή', 'purchase')];
const creditors = [C('1001', 'ΤΠΥ', 'Τιμολόγιο Παροχής Υπηρεσιών', 'creditor'), C('1002', 'ΑΠΥ', 'Απόδειξη Παροχής Υπηρεσιών', 'creditor'), C('1003', 'ΠΤΠΥ', 'Πιστωτικό Παροχής Υπηρεσιών', 'creditor')];
const all = [...purchases, ...creditors];

describe('normalizeGreek', () => {
  it('uppercases, strips accents and punctuation', () => { expect(normalizeGreek('Τιμολόγιο – Δελτίο Αποστολής')).toBe('ΤΙΜΟΛΟΓΙΟ ΔΕΛΤΙΟ ΑΠΟΣΤΟΛΗΣ'); });
});
describe('familyOf', () => {
  it.each([
    ['ΤΙΜΟΛΟΓΙΟ ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙΩΝ', 'TPY'], ['ΤΠΥ', 'TPY'], ['Τιμολόγιο – Δελτίο Αποστολής', 'TDA'], ['ΔΕΛΤΙΟ ΑΠΟΣΤΟΛΗΣ ΤΙΜΟΛΟΓΙΟ', 'TDA'],
    ['ΤΙΜΟΛΟΓΙΟ', 'TIM'], ['ΤΙΜΟΛΟΓΙΟ ΠΩΛΗΣΗΣ', 'TIM'], ['ΔΕΛΤΙΟ ΑΠΟΣΤΟΛΗΣ', 'DA'], ['ΠΙΣΤΩΤΙΚΟ ΤΙΜΟΛΟΓΙΟ', 'PT'], ['ΠΙΣΤΩΤΙΚΟ ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙΩΝ', 'PT'],
    ['ΑΠΟΔΕΙΞΗ ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙΩΝ', 'APY'], ['ΑΠΟΔΕΙΞΗ ΛΙΑΝΙΚΗΣ ΠΩΛΗΣΗΣ', 'ALP'], ['ΛΟΓΑΡΙΑΣΜΟΣ ΡΕΥΜΑΤΟΣ', 'LOG'], ['ΕΚΚΑΘΑΡΙΣΤΙΚΟΣ', 'LOG'], ['INVOICE', 'TIM'], ['CREDIT NOTE', 'PT'], ['DEBIT NOTE', 'TIM'], ['', null],
  ])('%s → %s', (label, fam) => { expect(familyOf(label)).toBe(fam); });
});
describe('classifySeries', () => {
  it('picks the creditor ΤΠΥ for a service invoice from a creditor', () => {
    const r = classifySeries({ documentTypeLabel: 'ΤΙΜΟΛΟΓΙΟ ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙΩΝ', issuerKind: 'creditor', totalAmount: 229.4, invoiceKind: 'service' }, all);
    expect(r?.code).toBe('1001'); expect(r!.confidence).toBeGreaterThan(0.8); expect(r!.tie).toBe(false);
  });
  it('restricts to purchase series for a supplier and prefers ΤΔΑΠ for a combined label', () => {
    const r = classifySeries({ documentTypeLabel: 'ΤΙΜΟΛΟΓΙΟ – ΔΕΛΤΙΟ ΑΠΟΣΤΟΛΗΣ', issuerKind: 'supplier', totalAmount: 100, invoiceKind: 'product' }, all);
    expect(r?.code).toBe('2062');
  });
  it('a negative total or a credit label goes to the credit series of the right side', () => {
    expect(classifySeries({ documentTypeLabel: 'ΤΙΜΟΛΟΓΙΟ', issuerKind: 'supplier', totalAmount: -50, invoiceKind: 'product' }, all)?.code).toBe('2081');
    expect(classifySeries({ documentTypeLabel: 'ΠΙΣΤΩΤΙΚΟ', issuerKind: 'creditor', totalAmount: 10, invoiceKind: 'service' }, all)?.code).toBe('1003');
  });
  it('unknown issuer: considers both sides, uses invoiceKind to break the tie, and flags near-ties', () => {
    const r = classifySeries({ documentTypeLabel: 'ΤΙΜΟΛΟΓΙΟ', issuerKind: null, totalAmount: 10, invoiceKind: null }, all);
    expect(['2061', '1001']).toContain(r?.code); expect(r!.tie).toBe(true);
    expect(classifySeries({ documentTypeLabel: 'ΤΙΜΟΛΟΓΙΟ', issuerKind: null, totalAmount: 10, invoiceKind: 'service' }, all)?.code).toBe('1001');
  });
  it('returns null with no candidates and a low-confidence fallback for an unknown label', () => {
    expect(classifySeries({ documentTypeLabel: 'ΤΙΜΟΛΟΓΙΟ', issuerKind: null, totalAmount: 1, invoiceKind: null }, [])).toBeNull();
    const r = classifySeries({ documentTypeLabel: 'ΚΑΤΙ ΠΕΡΙΕΡΓΟ', issuerKind: 'supplier', totalAmount: 1, invoiceKind: 'product' }, all);
    expect(r?.confidence ?? 0).toBeLessThan(0.5);
  });
  it('utility bills map to ΤΠΥ of a creditor', () => {
    expect(classifySeries({ documentTypeLabel: 'ΕΚΚΑΘΑΡΙΣΤΙΚΟΣ ΛΟΓΑΡΙΑΣΜΟΣ', issuerKind: null, totalAmount: 78298.47, invoiceKind: 'service' }, all)?.code).toBe('1001');
  });
});
