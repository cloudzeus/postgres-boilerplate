import { describe, it, expect } from 'vitest';
import { coerceValue } from '../coerce';

describe('coerceValue', () => {
  it('TEXT trims and collapses whitespace, null on empty', () => {
    expect(coerceValue('  Τιμολόγιο   123 ', 'TEXT')).toBe('Τιμολόγιο 123');
    expect(coerceValue('   ', 'TEXT')).toBeNull();
    expect(coerceValue(null, 'TEXT')).toBeNull();
  });
  it('NUMBER parses Greek and plain formats', () => {
    expect(coerceValue('1.234,56', 'NUMBER')).toBe(1234.56);
    expect(coerceValue('1234.56', 'NUMBER')).toBe(1234.56);
    expect(coerceValue('12', 'NUMBER')).toBe(12);
    expect(coerceValue('abc', 'NUMBER')).toBeNull();
  });
  it('CURRENCY strips € and thousands separators', () => {
    expect(coerceValue('€ 1.240,00', 'CURRENCY')).toBe(1240);
    expect(coerceValue('45,20 EUR', 'CURRENCY')).toBe(45.2);
  });
  it('NUMBER: single dot with 3 fractional digits is a Greek thousands separator', () => {
    expect(coerceValue('1.234', 'NUMBER')).toBe(1234);
    expect(coerceValue('100.000', 'NUMBER')).toBe(100000);
    expect(coerceValue('1.234.567', 'NUMBER')).toBe(1234567);
    expect(coerceValue('1.5', 'NUMBER')).toBe(1.5);
    expect(coerceValue('0,5', 'NUMBER')).toBe(0.5);
  });
  it('CURRENCY: whole-euro Greek amounts', () => {
    expect(coerceValue('€ 1.500', 'CURRENCY')).toBe(1500);
    expect(coerceValue('1.500,00 €', 'CURRENCY')).toBe(1500);
  });
  it('DATE returns ISO yyyy-mm-dd for dd/mm/yyyy and dd-mm-yy', () => {
    expect(coerceValue('05/03/2026', 'DATE')).toBe('2026-03-05');
    expect(coerceValue('5-3-26', 'DATE')).toBe('2026-03-05');
    expect(coerceValue('2026-03-05', 'DATE')).toBe('2026-03-05');
    expect(coerceValue('χθες', 'DATE')).toBeNull();
  });
  it('LIST splits on newline, semicolon or comma and drops empties', () => {
    expect(coerceValue('A123; B456,C789\nD000', 'LIST')).toEqual(['A123', 'B456', 'C789', 'D000']);
    expect(coerceValue('', 'LIST')).toBeNull();
  });
});
