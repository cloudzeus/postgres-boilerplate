// lib/ocr/__tests__/line-items.test.ts
// Η ΜΙΑ απαράβατη προδιαγραφή: κάθε πεδίο κάθε γραμμής είναι ΠΑΝΤΑ string, ό,τι κι αν έγραψε η
// εξαγωγή. Ένα `undefined` εδώ γυρίζει το αντίστοιχο controlled `<input>` του επεξεργαστή σε
// uncontrolled — «A component is changing a controlled input to be uncontrolled».
import { describe, it, expect } from 'vitest';
import { toLineItems, EMPTY_LINE, type LineItem } from '../line-items';

/** Τα πεδία που δένονται σε input· κανένα δεν επιτρέπεται να λείπει. */
const TEXT_FIELDS: (keyof LineItem)[] = [
  'code', 'name', 'unit', 'quantity', 'price', 'discount', 'vatRate', 'total',
];

function expectAllText(lines: LineItem[]) {
  for (const line of lines) {
    for (const f of TEXT_FIELDS) {
      expect(typeof line[f], `το πεδίο «${f}» δεν είναι string: ${String(line[f])}`).toBe('string');
    }
  }
}

describe('toLineItems', () => {
  it('πλήρης γραμμή: κρατά τις τιμές ως κείμενο', () => {
    expect(toLineItems([{
      code: 'A1', name: 'Είδος', unit: 'ΤΕΜ', quantity: 2, price: 10.5,
      discount: 0, vatRate: 24, total: 21,
    }])).toEqual([{
      code: 'A1', name: 'Είδος', unit: 'ΤΕΜ', quantity: '2', price: '10.5',
      discount: '0', vatRate: '24', total: '21',
    }]);
  });

  it('παλιά εξαγωγή με πεδία που ΛΕΙΠΟΥΝ: όλα γίνονται κενό κείμενο', () => {
    const lines = toLineItems([{ name: 'Μόνο περιγραφή' }]);
    expectAllText(lines);
    expect(lines[0]).toEqual({ ...EMPTY_LINE, name: 'Μόνο περιγραφή' });
  });

  it('`null` / `undefined` τιμές: κενό κείμενο, όχι undefined', () => {
    const lines = toLineItems([
      { code: null, name: null, unit: null, quantity: null, price: null, discount: null, vatRate: null, total: null },
      { code: undefined, name: undefined, unit: undefined, quantity: undefined, price: undefined, discount: undefined, vatRate: undefined, total: undefined },
    ]);
    expectAllText(lines);
    expect(lines).toEqual([EMPTY_LINE, EMPTY_LINE]);
  });

  it('το μηδέν ΔΕΝ χάνεται (0 είναι τιμή, όχι κενό)', () => {
    const [line] = toLineItems([{ quantity: 0, price: 0, discount: 0, vatRate: 0, total: 0 }]);
    expect(line).toMatchObject({ quantity: '0', price: '0', discount: '0', vatRate: '0', total: '0' });
  });

  it('στοιχεία που δεν είναι αντικείμενα (null, αριθμός, κείμενο) δίνουν κενή γραμμή', () => {
    const lines = toLineItems([null, 5, 'κάτι', undefined, []]);
    expectAllText(lines);
    expect(lines).toHaveLength(5);
    expect(lines.every((l) => JSON.stringify(l) === JSON.stringify(EMPTY_LINE))).toBe(true);
  });

  it('αραιός πίνακας: οι τρύπες γίνονται κενές γραμμές, όχι undefined', () => {
    const sparse = [{ name: 'πρώτη' }];
    sparse[2] = { name: 'τρίτη' };           // θέση 1 = τρύπα
    const lines = toLineItems(sparse);
    expect(lines).toHaveLength(3);
    expectAllText(lines);
    expect(lines[1]).toEqual(EMPTY_LINE);
  });

  it('τα ειδικά πεδία της γραμμής ταξιδεύουν μαζί της — και μόνο όταν είναι αντικείμενο', () => {
    const cf = { 'Αρ. παραγγελίας': 'PO-9' };
    expect(toLineItems([{ name: 'x', customFields: cf }])[0].customFields).toBe(cf);
    for (const bad of ['όχι αντικείμενο', 0, null, undefined, false]) {
      expect(toLineItems([{ name: 'x', customFields: bad }])[0]).not.toHaveProperty('customFields');
    }
  });

  it('ό,τι δεν είναι πίνακας δίνει κενή λίστα', () => {
    for (const raw of [undefined, null, {}, 'items', 0, { items: [] }]) {
      expect(toLineItems(raw)).toEqual([]);
    }
  });

  it('η σειρά των κλειδιών είναι σταθερή — ο έλεγχος «άλλαξε κάτι;» συγκρίνει JSON', () => {
    const [a] = toLineItems([{ name: 'x' }]);
    const [b] = toLineItems([{ total: 5, name: 'x' }]);
    expect(Object.keys(a)).toEqual(Object.keys(EMPTY_LINE));
    expect(Object.keys(b)).toEqual(Object.keys(EMPTY_LINE));
  });

  it('το EMPTY_LINE είναι κι αυτό πλήρες — από εκεί ξεκινά κάθε νέα γραμμή', () => {
    expectAllText([EMPTY_LINE]);
  });
});
