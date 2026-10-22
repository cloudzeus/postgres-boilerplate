import { describe, it, expect } from 'vitest';
import { isCreditNote, sameDocNumber, suggestOriginal, type CreditCandidate } from '../credit-link';
import { buildPurdocPayload, type PurdocContext } from '../purdoc-payload';
import { normalizeDocument } from '../canonical';

const C = (findoc: number, number: string | null, source: 'app' | 'softone' = 'softone'): CreditCandidate => ({ findoc, number, date: '2026-06-22', total: 100, source, label: String(number) });

describe('isCreditNote', () => {
  it('από τη σειρά, την κατηγορία, τον τύπο myDATA ή τον τίτλο', () => {
    expect(isCreditNote({ seriesName: 'Πιστωτικό τιμολογίου παροχής υπηρεσιών' })).toBe(true);
    expect(isCreditNote({ category: 'CREDIT_NOTE' })).toBe(true);
    expect(isCreditNote({ myDataType: '5.1' })).toBe(true);
    expect(isCreditNote({ typeLabel: 'ΠΙΣΤΩΤΙΚΟ ΤΙΜΟΛΟΓΙΟ' })).toBe(true);
    expect(isCreditNote({ seriesName: 'Τιμολόγιο Δαπανών', typeLabel: 'ΤΙΜΟΛΟΓΙΟ' })).toBe(false);
  });
});

describe('πρόταση αρχικού', () => {
  it('«ΤΠΥ 0000017» ≈ «17»', () => {
    expect(sameDocNumber('ΤΠΥ 0000017', '17')).toBe(true);
    expect(sameDocNumber('17', '170')).toBe(false);
  });
  it('μοναδικό ταίριασμα ⇒ πρόταση· κανένα ή δύο διαφορετικά ⇒ καμία (δεν μαντεύουμε)', () => {
    expect(suggestOriginal('ΤΠΥ 17', [C(1, '0000017'), C(2, '18')])?.findoc).toBe(1);
    expect(suggestOriginal('ΤΠΥ 17', [C(1, '17'), C(2, '17')])).toBeNull();
    expect(suggestOriginal('17', [C(1, '17', 'app'), C(1, '17', 'softone')])?.findoc).toBe(1);
    expect(suggestOriginal(null, [C(1, '17')])).toBeNull();
  });
});

describe('payload πιστωτικού', () => {
  it('FINDOCS = το αρχικό στην κεφαλίδα', () => {
    const ctx = { target: { object: 'LINCREDOC', lines: 'LINLINES', source: 'default', supported: true, reason: '' }, series: 1102, trdr: 2781, lines: [], vatIdByRate: {}, relatedFindoc: 115571 } as unknown as PurdocContext;
    const p = buildPurdocPayload(normalizeDocument({ kind: 'invoice', date: '2026-10-20', lines: [] }), ctx);
    expect((p.DATA as any).LINCREDOC[0].FINDOCS).toBe(115571);
  });
});
