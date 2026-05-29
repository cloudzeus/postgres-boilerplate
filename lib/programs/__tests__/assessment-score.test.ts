import { describe, it, expect } from 'vitest';
import { awardPoints, computeScore } from '../assessment-score';
import type { ScoringQuestion, ScoringAnswer } from '../questionnaire-types';

const single: ScoringQuestion = {
  id: 'q1', answerType: 'SINGLE_CHOICE', weight: 2, maxPoints: 10,
  options: [{ id: 'o1', points: 0 }, { id: 'o2', points: 10 }],
};
const bool: ScoringQuestion = { id: 'q2', answerType: 'BOOLEAN', weight: 1, maxPoints: 10, options: [] };
const num: ScoringQuestion = { id: 'q3', answerType: 'NUMERIC', weight: 1, maxPoints: 5, options: [] };

describe('awardPoints', () => {
  it('returns the selected option points for SINGLE_CHOICE', () => {
    expect(awardPoints(single, { questionId: 'q1', selectedOptionId: 'o2' })).toBe(10);
    expect(awardPoints(single, { questionId: 'q1', selectedOptionId: 'o1' })).toBe(0);
  });
  it('returns maxPoints for a true BOOLEAN, 0 for false/undefined', () => {
    expect(awardPoints(bool, { questionId: 'q2', valueBool: true })).toBe(10);
    expect(awardPoints(bool, { questionId: 'q2', valueBool: false })).toBe(0);
    expect(awardPoints(bool, undefined)).toBe(0);
  });
  it('clamps NUMERIC value to [0, maxPoints]', () => {
    expect(awardPoints(num, { questionId: 'q3', valueNumber: 3 })).toBe(3);
    expect(awardPoints(num, { questionId: 'q3', valueNumber: 99 })).toBe(5);
    expect(awardPoints(num, { questionId: 'q3', valueNumber: -2 })).toBe(0);
  });
});

describe('computeScore', () => {
  const qs = [single, bool];
  it('POINTS_SUM sums awarded points and compares to threshold', () => {
    const answers: ScoringAnswer[] = [
      { questionId: 'q1', selectedOptionId: 'o2' }, // 10
      { questionId: 'q2', valueBool: false },       // 0
    ];
    const r = computeScore('POINTS_SUM', 15, 20, qs, answers);
    expect(r.score).toBe(10);
    expect(r.passed).toBe(false);
  });
  it('WEIGHTED normalises per-question fraction by weight and scales to maxScore', () => {
    const answers: ScoringAnswer[] = [
      { questionId: 'q1', selectedOptionId: 'o2' },
      { questionId: 'q2', valueBool: false },
    ];
    const r = computeScore('WEIGHTED', 75, 100, qs, answers);
    expect(Math.round(r.score)).toBe(67);
    expect(r.passed).toBe(false);
  });
  it('WEIGHTED passes when threshold met', () => {
    const answers: ScoringAnswer[] = [
      { questionId: 'q1', selectedOptionId: 'o2' },
      { questionId: 'q2', valueBool: true },
    ];
    const r = computeScore('WEIGHTED', 75, 100, qs, answers); // (1*2+1*1)/3*100=100
    expect(r.score).toBe(100);
    expect(r.passed).toBe(true);
  });
  it('handles zero total weight without dividing by zero', () => {
    const r = computeScore('WEIGHTED', 50, 100, [{ id: 'q', answerType: 'BOOLEAN', weight: 0, maxPoints: 10, options: [] }], []);
    expect(r.score).toBe(0);
    expect(r.passed).toBe(false);
  });
});
