// Οι περιπτώσεις είναι ΠΡΑΓΜΑΤΙΚΕΣ ομάδες της ουράς «Είδη & έξοδα» (2026-10-11).
import { describe, it, expect } from 'vitest';
import { planItemRow, withKind, withTarget, creatableKind, type ItemPlanInput } from '../bulk-item-plan';

const g = (sample: string, category: ItemPlanInput['category'], suggestion: ItemPlanInput['suggestion'] = null): ItemPlanInput =>
  ({ key: sample, afm: '999863881', pattern: sample.toLowerCase(), sample, supplier: 'X', code: null, category, lineCount: 1, docCount: 1, price: 10, suggestion });

describe('planItemRow', () => {
  it('τεκμηριωμένη υπηρεσία ⇒ δημιουργία, προεπιλεγμένη', () => {
    expect(planItemRow(g('Soft1 OpEn myDATA Live [Εκδόσεις-eServices]', 'service')))
      .toMatchObject({ action: 'create', status: 'ready', selected: true, kind: 'service' });
  });

  it('χρεοπίστωση (ZIM «Ναύλος») ⇒ ΜΟΝΟ αντιστοίχιση, δεν προεπιλέγεται', () => {
    expect(planItemRow(g('Ναύλος (Freight)', 'lineitem')))
      .toMatchObject({ action: 'match', status: 'needs_target', selected: false, target: null });
  });

  it('χωρίς κατηγορία (BESSEY) ⇒ θέλει μητρώο, δεν προεπιλέγεται', () => {
    expect(planItemRow(g('Malleable cast iron screw clamp TGRC', null)))
      .toMatchObject({ action: 'none', status: 'needs_kind', selected: false });
  });

  it('ακόμη και ισχυρή πρόταση ΔΕΝ εφαρμόζεται μόνη της', () => {
    const s = { kind: 'product' as const, id: 50132, code: '50132', name: 'Soft1 ERP Business Units', score: 0.81 };
    const r = planItemRow(g('Soft1 OpEn Business Units', null, s));
    expect(r.target).toBeNull();
    expect(r.suggestion).toEqual(s);
    expect(r.selected).toBe(false);
  });
});

describe('μαζικές επιλογές', () => {
  const r = planItemRow(g('Clippix XC 50/50', null));
  it('ορισμός «Είδος» σε ομάδα χωρίς κατηγορία ⇒ γίνεται δημιουργία', () => {
    expect(withKind(r, 'product')).toMatchObject({ kind: 'product', action: 'create', status: 'ready', selected: true });
  });
  it('ορισμός «Χρεοπίστωση» ⇒ θέλει στόχο, όχι δημιουργία', () => {
    expect(withKind(r, 'lineitem')).toMatchObject({ action: 'match', status: 'needs_target', selected: false });
  });
  it('αντιστοίχιση σε υπάρχον ⇒ έτοιμη, με το μητρώο του στόχου', () => {
    expect(withTarget(r, { kind: 'lineitem', id: 3374, code: '64.00.03', name: 'Ναύλοι' }))
      .toMatchObject({ kind: 'lineitem', action: 'match', status: 'ready', selected: true });
  });
  it('οι χρεοπιστώσεις δεν είναι δημιουργήσιμες μαζικά', () => {
    expect(creatableKind('lineitem')).toBe(false);
    expect(['product', 'service', 'expense'].every((k) => creatableKind(k as never))).toBe(true);
  });
});

describe('sharedSupplierCodes', () => {
  it('η δασμολογική κλάση της BESSEY (82057000 σε πολλά εργαλεία) ΔΕΝ είναι κωδικός είδους', async () => {
    const { sharedSupplierCodes } = await import('../bulk-item-plan');
    const s = sharedSupplierCodes([
      { afm: 'DE144960040', code: '82057000' }, { afm: 'DE144960040', code: '82057000' },
      { afm: 'DE144960040', code: '82130000' },
      { afm: '999863881', code: '600-747-211' },
      { afm: 'ΑΛΛΟΣ', code: '82057000' },
    ]);
    expect(s.has('DE144960040|82057000')).toBe(true);
    // Ο ΙΔΙΟΣ εκδότης επαναλαμβάνει κωδικούς ⇒ τυπώνει ταξινόμηση: ούτε ο μοναδικός του μετράει.
    expect(s.has('DE144960040|82130000')).toBe(true);
    expect(s.has('999863881|600-747-211')).toBe(false);
    expect(s.has('ΑΛΛΟΣ|82057000')).toBe(false);         // άλλος εκδότης, μία φορά
  });
});
