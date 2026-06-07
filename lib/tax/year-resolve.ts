export type FinancialYearModeStr = 'REFERENCE' | 'PRIOR_1' | 'PRIOR_2' | 'PRIOR_3';

const OFFSET: Record<FinancialYearModeStr, number> = {
  REFERENCE: 0, PRIOR_1: 1, PRIOR_2: 2, PRIOR_3: 3,
};

export function resolveYear(referenceYear: number, mode: FinancialYearModeStr): number {
  return referenceYear - OFFSET[mode];
}

export function requiredYears(yearsBack: number, referenceYear: number): number[] {
  const n = Math.max(1, yearsBack);
  return Array.from({ length: n }, (_, i) => referenceYear - i);
}
