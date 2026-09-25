// lib/ocr/__tests__/line-allocation.test.ts
// Η απαράβατη προδιαγραφή: τα ποσά ενός επιμερισμού αθροίζουν ΑΚΡΙΒΩΣ στο σύνολο της γραμμής.
// Ένα λεπτό διαφορά ανά παραστατικό είναι ασυμφωνία που τη βρίσκει το λογιστήριο, όχι εμείς.
import { describe, it, expect } from 'vitest';
import {
  computeAllocationAmounts, validateAllocations, percentOf, type AllocationInput,
} from '../line-allocation';

const alloc = (registryMtrl: number, percent: number): AllocationInput => ({ registryMtrl, percent });
const sum = (xs: { amount: number }[]) => Math.round(xs.reduce((t, x) => t + x.amount, 0) * 100) / 100;

describe('computeAllocationAmounts', () => {
  it('το άθροισμα κλείνει ΑΚΡΙΒΩΣ — τρία ίσα μέρη που δεν διαιρούνται', () => {
    const lines = computeAllocationAmounts([alloc(1, 33.3333), alloc(2, 33.3333), alloc(3, 33.3334)], 1055);
    expect(lines.map((l) => l.amount)).toEqual([351.67, 351.67, 351.66]);
    expect(sum(lines)).toBe(1055);
  });

  it('ο ΤΕΛΕΥΤΑΙΟΣ απορροφά το υπόλοιπο, όχι ο πρώτος', () => {
    const lines = computeAllocationAmounts([alloc(1, 50), alloc(2, 50)], 0.01);
    expect(lines.map((l) => l.amount)).toEqual([0.01, 0]);
    expect(sum(lines)).toBe(0.01);
  });

  it('δύο μέρη 33/67', () => {
    const lines = computeAllocationAmounts([alloc(1, 33), alloc(2, 67)], 1308.2);
    expect(lines.map((l) => l.amount)).toEqual([431.71, 876.49]);
    expect(sum(lines)).toBe(1308.2);
  });

  it('ένας μόνο επιμερισμός παίρνει ΟΛΟ το ποσό', () => {
    const lines = computeAllocationAmounts([alloc(1, 100)], 124);
    expect(lines[0].amount).toBe(124);
  });

  it('αρνητικό σύνολο (πιστωτικό) κλείνει κι αυτό', () => {
    const lines = computeAllocationAmounts([alloc(1, 30), alloc(2, 70)], -99.99);
    expect(sum(lines)).toBe(-99.99);
  });

  it('η σειρά (`order`) ακολουθεί την είσοδο', () => {
    const lines = computeAllocationAmounts([alloc(7, 40), alloc(9, 60)], 100);
    expect(lines.map((l) => [l.order, l.registryMtrl])).toEqual([[0, 7], [1, 9]]);
  });

  it('κρατά το `accountCode` που δόθηκε', () => {
    const [l] = computeAllocationAmounts([{ registryMtrl: 1, percent: 100, accountCode: '64.02.06.0099' }], 10);
    expect(l.accountCode).toBe('64.02.06.0099');
  });

  it('πολλά μέρη με άσχημα ποσοστά — πάντα κλείνει', () => {
    for (const total of [1055, 1308.2, 0.05, 999999.99, 7.77]) {
      const lines = computeAllocationAmounts(
        [alloc(1, 16.6667), alloc(2, 16.6667), alloc(3, 16.6666), alloc(4, 16.6667), alloc(5, 16.6667), alloc(6, 16.6666)],
        total,
      );
      expect(sum(lines), `σύνολο ${total}`).toBe(Math.round(total * 100) / 100);
    }
  });
});

describe('validateAllocations', () => {
  it('καθαρός επιμερισμός δεν έχει προβλήματα', () => {
    expect(validateAllocations([alloc(1, 40), alloc(2, 60)], 100)).toEqual([]);
  });

  it('κενή λίστα', () => {
    expect(validateAllocations([], 100).map((p) => p.code)).toEqual(['no_allocations']);
  });

  it('ποσοστά που δεν κάνουν 100', () => {
    const p = validateAllocations([alloc(1, 40), alloc(2, 50)], 100);
    expect(p.map((x) => x.code)).toContain('percent_sum');
    expect(p.find((x) => x.code === 'percent_sum')).toMatchObject({ sum: 90 });
  });

  it('δέχεται 33,33 + 33,33 + 33,34 (ανοχή)', () => {
    expect(validateAllocations([alloc(1, 33.33), alloc(2, 33.33), alloc(3, 33.34)], 100)).toEqual([]);
  });

  it('ποσοστό εκτός ορίων: μηδέν, αρνητικό, πάνω από 100', () => {
    for (const bad of [0, -5, 101]) {
      const p = validateAllocations([alloc(1, bad), alloc(2, 100 - bad)], 100);
      expect(p.some((x) => x.code === 'percent_range'), `ποσοστό ${bad}`).toBe(true);
    }
  });

  it('ΧΩΡΙΣ επιλεγμένο λογαριασμό δεν «κλείνει», όσο σωστά κι αν αθροίζουν τα ποσοστά', () => {
    // Η πράσινη ένδειξη «κλείνει με το σύνολο» πάνω από άδειο λογαριασμό υπόσχεται ότι τελείωσες.
    const p = validateAllocations([{ registryMtrl: 0, percent: 100 }], 1055);
    expect(p.map((x) => x.code)).toContain('no_account');
    expect(p.find((x) => x.code === 'no_account')).toMatchObject({ order: 0 });
  });

  it('δείχνει ΠΟΙΑ γραμμή του επιμερισμού δεν έχει λογαριασμό', () => {
    const p = validateAllocations([alloc(7, 50), { registryMtrl: 0, percent: 50 }], 100);
    const miss = p.filter((x) => x.code === 'no_account');
    expect(miss).toHaveLength(1);
    expect(miss[0]).toMatchObject({ order: 1 });
  });

  it('δύο ΚΕΝΟΙ λογαριασμοί δεν είναι «διπλός λογαριασμός» — είναι δύο που λείπουν', () => {
    const p = validateAllocations([{ registryMtrl: 0, percent: 50 }, { registryMtrl: 0, percent: 50 }], 100);
    expect(p.filter((x) => x.code === 'no_account')).toHaveLength(2);
    expect(p.map((x) => x.code)).not.toContain('duplicate_account');
  });

  it('ο ίδιος λογαριασμός δύο φορές', () => {
    const p = validateAllocations([alloc(5, 50), alloc(5, 50)], 100);
    expect(p.map((x) => x.code)).toContain('duplicate_account');
  });

  it('γραμμή χωρίς σύνολο', () => {
    for (const t of [null, undefined, NaN]) {
      expect(validateAllocations([alloc(1, 100)], t).map((x) => x.code)).toContain('no_total');
    }
  });

  it('επιστρέφει ΟΛΑ τα προβλήματα μαζί, όχι το πρώτο', () => {
    const p = validateAllocations([alloc(5, 0), alloc(5, 50)], null);
    expect(new Set(p.map((x) => x.code))).toEqual(new Set(['no_total', 'percent_range', 'duplicate_account', 'percent_sum']));
  });
});

describe('percentOf', () => {
  it('ποσό → ποσοστό', () => {
    expect(percentOf(431.71, 1308.2)).toBeCloseTo(33, 1);
    expect(percentOf(1055, 1055)).toBe(100);
  });

  it('μηδενικό σύνολο δεν σκάει', () => {
    expect(percentOf(10, 0)).toBe(0);
  });
});
