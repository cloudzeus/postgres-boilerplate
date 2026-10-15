import { describe, it, expect } from 'vitest';
import { planConversion, parseConversionMap, noteScore, docNumberDigits, type NoteLine, type InvoiceLine } from '../delivery-note-match';

const note = (o: Partial<NoteLine>): NoteLine => ({ findoc: 100, mtrlines: 1, mtrl: 1, qty1: 10, covered1: 0, noteDate: '2026-10-01', noteCode: 'ΔΑ-1', ...o });
const inv = (o: Partial<InvoiceLine>): InvoiceLine => ({ rowIndex: 0, mtrl: 1, isService: false, qty1: 10, name: 'x', ...o });

describe('planConversion', () => {
  it('ίδια είδη, ίδιες ποσότητες ⇒ πλήρης συμφωνία, το δελτίο κλείνει', () => {
    const p = planConversion([inv({ rowIndex: 0, mtrl: 1, qty1: 6 }), inv({ rowIndex: 1, mtrl: 2, qty1: 3 })],
      [note({ mtrlines: 1, mtrl: 1, qty1: 6 }), note({ mtrlines: 2, mtrl: 2, qty1: 3 })]);
    expect(p.status).toBe('match');
    expect(p.links.get(0)).toEqual([{ findoc: 100, mtrlines: 1, qty1: 6 }]);
    expect(p.links.get(1)).toEqual([{ findoc: 100, mtrlines: 2, qty1: 3 }]);
  });
  it('μικρότερη ποσότητα στο τιμολόγιο ⇒ μερικός (το υπόλοιπο μένει ανοιχτό)', () => {
    const p = planConversion([inv({ qty1: 4 })], [note({ qty1: 10 })]);
    expect(p.status).toBe('partial');
    expect(p.rest[0]).toMatchObject({ open1: 10, left1: 6 });
  });
  it('μεγαλύτερη ποσότητα ή είδος εκτός δελτίου ⇒ μπλοκ', () => {
    expect(planConversion([inv({ qty1: 12 })], [note({ qty1: 10 })]).status).toBe('blocked');
    expect(planConversion([inv({ mtrl: 9 })], [note({})]).lines[0].status).toBe('not_in_note');
  });
  it('ήδη μερικώς τιμολογημένη γραμμή: μετρά μόνο ό,τι μένει', () => {
    const p = planConversion([inv({ qty1: 5 })], [note({ qty1: 10, covered1: 6 })]);
    expect(p.lines[0]).toMatchObject({ status: 'excess', missing1: 1 });
  });
  it('μία γραμμή από δύο δελτία, FIFO (παλαιότερο πρώτο)', () => {
    const p = planConversion([inv({ qty1: 10 })], [
      note({ findoc: 2, mtrlines: 1, qty1: 6, noteDate: '2026-10-05' }),
      note({ findoc: 1, mtrlines: 3, qty1: 4, noteDate: '2026-10-01' }),
    ]);
    expect(p.status).toBe('match');
    expect(p.links.get(0)).toEqual([{ findoc: 1, mtrlines: 3, qty1: 4 }, { findoc: 2, mtrlines: 1, qty1: 6 }]);
  });
  it('έκπτωση σε ποσό σε γραμμή που μοιράζεται ⇒ μπλοκ (θα άλλαζε η αξία)', () => {
    const p = planConversion([inv({ qty1: 10, hasDiscountAmount: true })], [note({ findoc: 1, qty1: 4 }), note({ findoc: 2, qty1: 6 })]);
    expect(p.lines[0].status).toBe('split_discount');
    expect(p.status).toBe('blocked');
  });
  it('υπηρεσίες περνούν χωρίς δελτίο· αταίριαστη γραμμή μπλοκάρει', () => {
    expect(planConversion([inv({}), inv({ rowIndex: 1, mtrl: null, isService: true })], [note({})]).status).toBe('match');
    expect(planConversion([inv({}), inv({ rowIndex: 1, mtrl: null, isService: false })], [note({})]).status).toBe('blocked');
  });
  it('επιλεγμένο δελτίο που δεν χρησιμοποιήθηκε ⇒ μπλοκ (λάθος επιλογή)', () => {
    expect(planConversion([inv({})], [note({ findoc: 1 }), note({ findoc: 2, mtrl: 7 })]).status).toBe('blocked');
  });
  it('τιμολόγιο μόνο με υπηρεσίες ⇒ μπλοκ (τίποτα να μετασχηματιστεί)', () => {
    expect(planConversion([inv({ mtrl: null, isService: true })], [note({})]).status).toBe('blocked');
  });
});

describe('βοηθητικά', () => {
  it('χάρτης σειρών', () => {
    expect([...parseConversionMap('2041=2061, 2043 → 3261; x=1, 99')]).toEqual([[2041, 2061], [2043, 3261]]);
  });
  it('ο αριθμός του δελτίου που τυπώνει το τιμολόγιο', () => {
    expect(docNumberDigits('ΔΑ-000123')).toBe('123');
    expect(noteScore({ fincode: 'ΔΑ00000123', mtrls: [] }, ['123'], [])).toBe(2);
    expect(noteScore({ fincode: 'ΔΑ00000124', mtrls: [5] }, ['123'], [5])).toBe(1);
    expect(noteScore({ fincode: 'ΔΑ00000124', mtrls: [5] }, [], [6])).toBe(0);
  });
});
