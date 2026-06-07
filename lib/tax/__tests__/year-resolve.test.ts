import { describe, it, expect } from 'vitest';
import { resolveYear, requiredYears } from '../year-resolve';

describe('resolveYear', () => {
  it('maps mode to an absolute year relative to reference', () => {
    expect(resolveYear(2024, 'REFERENCE')).toBe(2024);
    expect(resolveYear(2024, 'PRIOR_1')).toBe(2023);
    expect(resolveYear(2024, 'PRIOR_2')).toBe(2022);
    expect(resolveYear(2024, 'PRIOR_3')).toBe(2021);
  });
});

describe('requiredYears', () => {
  it('expands yearsBack into a descending year list', () => {
    expect(requiredYears(3, 2024)).toEqual([2024, 2023, 2022]);
    expect(requiredYears(1, 2025)).toEqual([2025]);
  });
});
