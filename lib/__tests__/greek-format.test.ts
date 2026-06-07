import { describe, it, expect } from 'vitest';
import {
  parseGreekNumber,
  parseGreekCurrency,
  parseGreekPercentage,
  parseGreekDate,
  coerceFinancialValue,
} from '../greek-format';

describe('parseGreekNumber', () => {
  it('parses dot-thousands + comma-decimal', () => {
    expect(parseGreekNumber('1.556.540,27')).toBe(1556540.27);
  });
  it('parses plain integers', () => {
    expect(parseGreekNumber('400000')).toBe(400000);
  });
  it('parses negatives', () => {
    expect(parseGreekNumber('-1.234,50')).toBe(-1234.5);
  });
  it('returns null for blank / garbage', () => {
    expect(parseGreekNumber('')).toBeNull();
    expect(parseGreekNumber('abc')).toBeNull();
    expect(parseGreekNumber(null)).toBeNull();
  });
  it('accepts already-numeric input', () => {
    expect(parseGreekNumber(1556540.27)).toBe(1556540.27);
  });
  it('treats dot as thousands separator: "1.234" → 1234', () => {
    expect(parseGreekNumber('1.234')).toBe(1234);
  });
});

describe('parseGreekCurrency', () => {
  it('strips euro symbol and spaces', () => {
    expect(parseGreekCurrency('400.000,00 €')).toBe(400000);
    expect(parseGreekCurrency('€ 27.604,25')).toBe(27604.25);
  });
});

describe('parseGreekPercentage', () => {
  it('parses a percentage to its numeric value', () => {
    expect(parseGreekPercentage('17,9%')).toBe(17.9);
    expect(parseGreekPercentage('100')).toBe(100);
  });
});

describe('parseGreekDate', () => {
  it('parses dd/mm/yyyy and dd.mm.yyyy', () => {
    expect(parseGreekDate('31/12/2024')?.toISOString().slice(0, 10)).toBe('2024-12-31');
    expect(parseGreekDate('01.06.2025')?.toISOString().slice(0, 10)).toBe('2025-06-01');
  });
  it('passes through ISO', () => {
    expect(parseGreekDate('2024-12-31')?.toISOString().slice(0, 10)).toBe('2024-12-31');
  });
  it('returns null for garbage', () => {
    expect(parseGreekDate('not a date')).toBeNull();
  });
  it('parses dd-mm-yyyy (hyphen separator)', () => {
    expect(parseGreekDate('15-03-2024')?.toISOString().slice(0, 10)).toBe('2024-03-15');
  });
});

describe('coerceFinancialValue', () => {
  it('dispatches by valueType', () => {
    expect(coerceFinancialValue('1.556.540,27', 'CURRENCY')).toBe(1556540.27);
    expect(coerceFinancialValue('17,9%', 'PERCENT')).toBe(17.9);
    expect(coerceFinancialValue('5', 'INTEGER')).toBe(5);
    expect(coerceFinancialValue('5,7', 'INTEGER')).toBe(6); // rounds
    expect(coerceFinancialValue('ΝΑΙ', 'BOOLEAN')).toBe(1);
    expect(coerceFinancialValue('1', 'BOOLEAN')).toBe(1);
    expect(coerceFinancialValue('ΟΧΙ', 'BOOLEAN')).toBe(0);
  });
  it('returns null when unparseable', () => {
    expect(coerceFinancialValue('—', 'CURRENCY')).toBeNull();
  });
  it('empty string BOOLEAN → null (no answer, not explicit false)', () => {
    expect(coerceFinancialValue('', 'BOOLEAN')).toBeNull();
  });
  it('DATE returns epoch ms number', () => {
    expect(coerceFinancialValue('31/12/2024', 'DATE')).toBe(Date.UTC(2024, 11, 31));
  });
});
