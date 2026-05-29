import { describe, it, expect } from 'vitest';
import { evaluateEligibility } from '../eligibility';

const asOf = new Date('2026-05-29T00:00:00Z');

const baseProgram = {
  kadRule: 'ONLY_LISTED' as const,
  kads: [{ code: '62.01', excluded: false }, { code: '63.11', excluded: true }],
  eligibleLegalForms: ['ΙΚΕ', 'ΑΕ'],
  minEmployeesFte: 2,
  minOperationalYears: 3,
  regions: ['Αττική', 'Κρήτη'],
};

const baseCompany = {
  activities: [{ code: '62.01.11' }],
  legalForm: 'Ι.Κ.Ε.',
  employeeCount: 5,
  foundingDate: new Date('2020-01-01T00:00:00Z'),
  regionName: 'Αττική',
};

describe('evaluateEligibility', () => {
  it('passes a fully compliant company', () => {
    const r = evaluateEligibility(baseCompany, baseProgram, asOf);
    expect(r.eligible).toBe(true);
    expect(r.criteria.find((c) => c.key === 'kad')?.pass).toBe(true);
  });
  it('ONLY_LISTED fails when no activity matches a listed ΚΑΔ', () => {
    const r = evaluateEligibility({ ...baseCompany, activities: [{ code: '10.10.00' }] }, baseProgram, asOf);
    expect(r.criteria.find((c) => c.key === 'kad')?.pass).toBe(false);
    expect(r.eligible).toBe(false);
  });
  it('ALL_EXCEPT_LISTED fails only when an activity is explicitly excluded', () => {
    const prog = { ...baseProgram, kadRule: 'ALL_EXCEPT_LISTED' as const };
    expect(evaluateEligibility({ ...baseCompany, activities: [{ code: '63.11.10' }] }, prog, asOf).criteria.find((c) => c.key === 'kad')?.pass).toBe(false);
    expect(evaluateEligibility({ ...baseCompany, activities: [{ code: '99.99.99' }] }, prog, asOf).criteria.find((c) => c.key === 'kad')?.pass).toBe(true);
  });
  it('normalises legal form (dots/case) when matching', () => {
    expect(evaluateEligibility(baseCompany, baseProgram, asOf).criteria.find((c) => c.key === 'legalForm')?.pass).toBe(true);
    expect(evaluateEligibility({ ...baseCompany, legalForm: 'ΟΕ' }, baseProgram, asOf).criteria.find((c) => c.key === 'legalForm')?.pass).toBe(false);
  });
  it('fails operational years below the minimum', () => {
    const r = evaluateEligibility({ ...baseCompany, foundingDate: new Date('2025-01-01T00:00:00Z') }, baseProgram, asOf);
    expect(r.criteria.find((c) => c.key === 'operationalYears')?.pass).toBe(false);
  });
  it('marks a criterion N/A (pass) when the program has no requirement', () => {
    const prog = { ...baseProgram, eligibleLegalForms: [] as string[] };
    const c = evaluateEligibility(baseCompany, prog, asOf).criteria.find((x) => x.key === 'legalForm');
    expect(c?.pass).toBe(true);
    expect(c?.note).toMatch(/δεν απαιτείται/);
  });
});
