// lib/ocr/__tests__/allocation-shape.test.ts
// Η μνήμη του σχήματος: τι αξίζει να θυμηθούμε, και τι ΔΕΝ επιτρέπεται να προταθεί ξανά.
import { describe, it, expect } from 'vitest';
import { isShapeWorthRemembering, toShapeParts, parseShapeParts } from '../allocation-shape';

const part = (registryMtrl: number, percent: number, accountCode: string | null = null) =>
  ({ registryMtrl, percent, accountCode });

describe('isShapeWorthRemembering', () => {
  it('δύο κομμάτια και πάνω = σχήμα', () => {
    expect(isShapeWorthRemembering([part(1, 60), part(2, 40)])).toBe(true);
    expect(isShapeWorthRemembering([part(1, 50), part(2, 30), part(3, 20)])).toBe(true);
  });

  it('ΕΝΑ κομμάτι στο 100 % ΔΕΝ είναι σχήμα', () => {
    // Το καλύπτει ήδη το `LineMatchRule`. Δύο μνήμες για το ίδιο πράγμα διαφωνούν μόλις ο
    // χρήστης αλλάξει τη μία — και μετά κανείς δεν ξέρει ποια ισχύει.
    expect(isShapeWorthRemembering([part(1, 100)])).toBe(false);
    expect(isShapeWorthRemembering([])).toBe(false);
  });

  it('κομμάτι χωρίς λογαριασμό ή χωρίς μερίδιο ακυρώνει το σχήμα', () => {
    expect(isShapeWorthRemembering([part(0, 60), part(2, 40)])).toBe(false);
    expect(isShapeWorthRemembering([part(1, 0), part(2, 100)])).toBe(false);
    expect(isShapeWorthRemembering([part(1, -10), part(2, 110)])).toBe(false);
    expect(isShapeWorthRemembering([part(1, Number.NaN), part(2, 40)])).toBe(false);
  });
});

describe('toShapeParts', () => {
  it('κρατά ΠΟΣΟΣΤΑ και σειρά, όχι ποσά', () => {
    const out = toShapeParts([part(7, 33.3333, '62.98'), part(9, 66.6667, '64.00')]);
    expect(out).toEqual([
      { registryMtrl: 7, accountCode: '62.98', percent: 33.3333 },
      { registryMtrl: 9, accountCode: '64.00', percent: 66.6667 },
    ]);
    expect(out[0]).not.toHaveProperty('amount');
  });

  it('κενός κωδικός λογαριασμού γίνεται null, όχι undefined', () => {
    expect(toShapeParts([{ registryMtrl: 1, percent: 50 }, { registryMtrl: 2, percent: 50 }])[0].accountCode)
      .toBeNull();
  });
});

describe('parseShapeParts — ό,τι διαβάζεται από τη βάση', () => {
  it('έγκυρο σχήμα διαβάζεται', () => {
    const r = parseShapeParts([{ registryMtrl: 1, percent: 60, accountCode: 'x' }, { registryMtrl: 2, percent: 40 }]);
    expect(r).toHaveLength(2);
    expect(r![1]).toMatchObject({ registryMtrl: 2, percent: 40, accountCode: null });
  });

  it('σχήμα που ΔΕΝ κλείνει στο 100 δεν προτείνεται', () => {
    // Θα γέμιζε τη φόρμα με επιμερισμό που ο χρήστης δεν μπορεί να αποθηκεύσει.
    expect(parseShapeParts([{ registryMtrl: 1, percent: 60 }, { registryMtrl: 2, percent: 30 }])).toBeNull();
  });

  it('δέχεται ανοχή στρογγυλοποίησης (33,33 + 33,33 + 33,34)', () => {
    expect(parseShapeParts([
      { registryMtrl: 1, percent: 33.33 }, { registryMtrl: 2, percent: 33.33 }, { registryMtrl: 3, percent: 33.34 },
    ])).toHaveLength(3);
  });

  it('σκουπίδια στη στήλη Json δεν ρίχνουν τίποτα — επιστρέφουν null', () => {
    for (const bad of [null, undefined, 'κάτι', 42, {}, [], [1, 2], [{ percent: 50 }, { percent: 50 }]]) {
      expect(parseShapeParts(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('ένα χαλασμένο κομμάτι ακυρώνει ΟΛΟΚΛΗΡΟ το σχήμα, δεν εφαρμόζεται μισό', () => {
    // Μερική εφαρμογή θα έχανε ποσά — χειρότερο από το να μην προτείνουμε τίποτα.
    expect(parseShapeParts([{ registryMtrl: 1, percent: 60 }, { registryMtrl: 0, percent: 40 }])).toBeNull();
  });
});
