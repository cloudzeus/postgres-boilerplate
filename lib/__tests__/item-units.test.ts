// Μονάδες μέτρησης είδους — συνθετικές μονάδες (ids όπως στη Demo: 101 Τεμάχια, 107 Κιβώτια, 150 Κιλά).
import { describe, it, expect } from 'vitest';
import { itemUnitFields, unitsError, ratioFromText, toBaseQty } from '@/lib/item-units';


describe('itemUnitFields', () => {
  it('κιβώτιο των 100 για αγορά, τεμάχιο για πώληση', () => {
    expect(itemUnitFields({ base: '101', buy: '107', buyRatio: 100 })).toEqual({
      MTRUNIT1: '101', MTRUNIT3: '107', MU31: 100, MTRUNIT4: '101', MU41: 1, MU13MODE: 1,
    });
  });
  it('χωρίς επιλογή → όλα στη βασική, σχέση 1', () => {
    expect(itemUnitFields({ base: '101' })).toEqual({ MTRUNIT1: '101', MTRUNIT3: '101', MU31: 1, MTRUNIT4: '101', MU41: 1 });
    expect(itemUnitFields({ base: '101', buy: '101', buyRatio: 50 }).MU31).toBe(1);
  });
});

describe('unitsError', () => {
  it('άλλη μονάδα χωρίς θετική σχέση → μήνυμα', () => {
    expect(unitsError({ base: '101', buy: '107', buyRatio: 0 })).toMatch(/αγορών/);
    expect(unitsError({ base: '101', sell: '107', sellRatio: null })).toMatch(/πώλησης/);
    expect(unitsError({ base: '101', buy: '107', buyRatio: 100 })).toBeNull();
  });
});

describe('ratioFromText / toBaseQty', () => {
  it('σχέση από την περιγραφή', () => {
    expect(ratioFromText('ΒΙΔΕΣ Μ6 ΚΟΥΤΙ 100 ΤΕΜ')).toBe(100);
    expect(ratioFromText('Guanti nitrile x100')).toBe(100);
    expect(ratioFromText('Box of 50 gloves')).toBe(50);
    expect(ratioFromText('Γάντια 12pcs')).toBe(12);
    expect(ratioFromText('ΣΩΛΗΝΑΣ Φ80 4M')).toBeNull();
    expect(ratioFromText('Μ6x1')).toBeNull();
  });
  it('ποσότητα στη βασική', () => {
    expect(toBaseQty(2, 100)).toBe(200);
    expect(toBaseQty(1.5, null)).toBe(1.5);
  });
});
