import { describe, it, expect } from 'vitest';
import { autofillAnswers } from '../assessment-autofill';
import type { QuestionDraftWithId } from '../assessment-autofill';

const asOf = new Date('2026-05-29T00:00:00Z');
const company = {
  legalForm: 'Ι.Κ.Ε.',
  employeeCount: 5,
  foundingDate: new Date('2020-01-01T00:00:00Z'),
  regionName: 'Αττική',
};

const questions: QuestionDraftWithId[] = [
  { id: 'q1', answerType: 'NUMERIC', companyField: 'employeeCount', options: [] },
  { id: 'q2', answerType: 'NUMERIC', companyField: 'operationalYears', options: [] },
  { id: 'q3', answerType: 'SINGLE_CHOICE', companyField: 'legalForm', options: [{ id: 'o1', label: 'ΑΕ' }, { id: 'o2', label: 'ΙΚΕ' }] },
  { id: 'q4', answerType: 'BOOLEAN', companyField: null, options: [] },
];

describe('autofillAnswers', () => {
  it('fills employeeCount as a numeric AUTO answer', () => {
    const a = autofillAnswers(company, questions, asOf).find((x) => x.questionId === 'q1');
    expect(a?.valueNumber).toBe(5);
    expect(a?.source).toBe('AUTO');
  });
  it('derives operationalYears from foundingDate', () => {
    const a = autofillAnswers(company, questions, asOf).find((x) => x.questionId === 'q2');
    expect(Math.round(a!.valueNumber!)).toBe(6);
    expect(a?.source).toBe('AUTO');
  });
  it('matches a SINGLE_CHOICE option by normalised label', () => {
    const a = autofillAnswers(company, questions, asOf).find((x) => x.questionId === 'q3');
    expect(a?.selectedOptionId).toBe('o2');
    expect(a?.source).toBe('AUTO');
  });
  it('does not produce an answer for unmapped (manual) questions', () => {
    const a = autofillAnswers(company, questions, asOf).find((x) => x.questionId === 'q4');
    expect(a).toBeUndefined();
  });
});
