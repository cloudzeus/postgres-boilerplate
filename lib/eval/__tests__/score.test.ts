import { describe, it, expect } from 'vitest';
import { evaluateExpression } from '../expression';
import { lookupBand } from '../bands';
import { evaluateCriterion, computeAssessment, type Criterion, type CriterionResult } from '../score';

describe('evaluateExpression', () => {
  it('arithmetic + functions', () => {
    expect(evaluateExpression('ebit / interest', { ebit: 27604.25, interest: 14890.91 })).toBeCloseTo(1.8537, 3);
    expect(evaluateExpression('budget / MAX(a,b,c)', { budget: 400000, a: 1556540.27, b: 1237397.74, c: 1209574.89 })).toBeCloseTo(0.2570, 3);
    expect(evaluateExpression('ebitda / ke', { ebitda: 39808.30, ke: 1556540.27 })).toBeCloseTo(0.02557, 4);
  });
  it('throws on missing variable / div by zero', () => {
    expect(() => evaluateExpression('a / b', { a: 1, b: 0 })).toThrow();
    expect(() => evaluateExpression('x + 1', {})).toThrow();
  });
});

describe('lookupBand', () => {
  const bands = [{ min: null, max: 1, score: 0 }, { min: 1, max: 5, score: 50 }, { min: 5, max: null, score: 100 }];
  it('maps a value to its band score', () => {
    expect(lookupBand(bands, 0.5)).toBe(0);
    expect(lookupBand(bands, 1.85)).toBe(50);
    expect(lookupBand(bands, 26.08)).toBe(100);
  });
});

describe('ΠΑΡΑΓΟΥΜΕ ΣΤΗΝ ΕΛΛΑΔΑ — Β1 computed criterion', () => {
  const b1: Criterion = {
    code: 'B1', label: 'Κάλυψη Τόκων', weight: 20,
    variables: [
      { key: 'ebit', source: 'FINANCIAL', fieldKey: 'E3.526', yearMode: 'REFERENCE' },
      { key: 'interest', source: 'FINANCIAL', fieldKey: 'E3.528', yearMode: 'REFERENCE' },
      { key: 'icr', source: 'DERIVED', formula: 'ebit / interest' },
    ],
    indexKey: 'icr', bandMode: 'LOOKUP',
    bands: [{ min: null, max: 1, score: 0 }, { min: 1, max: 5, score: 50 }, { min: 5, max: null, score: 100 }],
  };
  it('1,85 → 50', () => {
    const r = evaluateCriterion(b1, { ebit: 27604.25, interest: 14890.91 });
    expect(r.index).toBeCloseTo(1.85, 2); expect(r.score).toBe(50);
  });
  it('26,08 → 100', () => {
    const r = evaluateCriterion(b1, { ebit: 286391.22, interest: 10980.42 });
    expect(r.index).toBeCloseTo(26.08, 2); expect(r.score).toBe(100);
  });
});

describe('computeAssessment — reproduces the real scoring sheet', () => {
  const weights = [20, 15, 15, 20, 15, 10, 5];
  const make = (scores: number[]): CriterionResult[] =>
    scores.map((score, i) => ({ code: `B${i + 1}`, weight: weights[i], index: null, score }));

  it('scenario 1 → 72,00 → ΑΠΟΡΡΙΨΗ (threshold 75)', () => {
    const a = computeAssessment(make([50, 60, 20, 100, 100, 100, 100]), 75);
    expect(a.total).toBe(72); expect(a.verdict).toBe('NOT_ELIGIBLE');
  });
  it('scenario 2 → 86,50 → ΕΓΚΡΙΣΗ', () => {
    const a = computeAssessment(make([100, 50, 60, 100, 100, 100, 100]), 75);
    expect(a.total).toBe(86.5); expect(a.verdict).toBe('ELIGIBLE');
  });
});
