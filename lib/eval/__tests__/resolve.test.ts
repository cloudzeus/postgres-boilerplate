import { describe, it, expect } from 'vitest';
import { resolveCriterionInputs, neededFieldKeys, type FinancialsMap } from '../resolve';
import { evaluateCriterion, computeAssessment, type Criterion } from '../score';

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

const b5: Criterion = {
  code: 'B5', label: 'Π/Υ vs Κ.Ε. τριετίας', weight: 15,
  variables: [
    { key: 'ke1', source: 'FINANCIAL', fieldKey: 'E3.500', yearMode: 'REFERENCE' },
    { key: 'ke2', source: 'FINANCIAL', fieldKey: 'E3.500', yearMode: 'PRIOR_1' },
    { key: 'ke3', source: 'FINANCIAL', fieldKey: 'E3.500', yearMode: 'PRIOR_2' },
    { key: 'budget', source: 'PARAM', constant: 400000 },
    { key: 'maxKe', source: 'DERIVED', formula: 'MAX(ke1, ke2, ke3)' },
    { key: 'ratio', source: 'DERIVED', formula: 'budget / maxKe' },
  ],
  indexKey: 'ratio', bandMode: 'LOOKUP',
  bands: [{ min: null, max: 0.5, score: 100 }, { min: 0.5, max: null, score: 0 }],
};

const financials: FinancialsMap = {
  'E3.526': { 2024: 27604.25 },
  'E3.528': { 2024: 14890.91 },
  'E3.500': { 2024: 1556540.27, 2023: 1237397.74, 2022: 1209574.89 },
};

describe('resolveCriterionInputs', () => {
  it('pulls FINANCIAL values by fieldKey × resolved year + PARAM constants', () => {
    expect(resolveCriterionInputs(b1, financials, 2024)).toEqual({ ebit: 27604.25, interest: 14890.91 });
    expect(resolveCriterionInputs(b5, financials, 2024)).toEqual({
      ke1: 1556540.27, ke2: 1237397.74, ke3: 1209574.89, budget: 400000,
    });
  });
  it('null when a value is missing', () => {
    expect(resolveCriterionInputs(b1, {}, 2024)).toEqual({ ebit: null, interest: null });
  });
  it('neededFieldKeys lists FINANCIAL keys', () => {
    expect(neededFieldKeys([b1, b5]).sort()).toEqual(['E3.500', 'E3.526', 'E3.528']);
  });
});

describe('end-to-end: resolve → evaluate (real company values)', () => {
  it('B1 from stored financials → δείκτης 1,85 → 50', () => {
    const r = evaluateCriterion(b1, resolveCriterionInputs(b1, financials, 2024));
    expect(r.index).toBeCloseTo(1.85, 2); expect(r.score).toBe(50);
  });
  it('B5 budget/MAX(triennium) → ratio 0,257 → 100', () => {
    const r = evaluateCriterion(b5, resolveCriterionInputs(b5, financials, 2024));
    expect(r.index).toBeCloseTo(0.257, 2); expect(r.score).toBe(100);
  });
  it('computeAssessment over resolved criteria', () => {
    const results = [b1, b5].map((c) => evaluateCriterion(c, resolveCriterionInputs(c, financials, 2024)));
    const a = computeAssessment(results, 75);
    // (50*20 + 100*15) / (20+15) = 2500/35 = 71.43
    expect(a.total).toBeCloseTo(71.43, 1);
    expect(a.verdict).toBe('NOT_ELIGIBLE');
  });
});
