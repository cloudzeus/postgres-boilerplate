import { describe, it, expect } from 'vitest';
import { guessValueType, isGlAccount } from '../guess';

describe('guessValueType', () => {
  it.each([
    ['30/06/2026', 'DATE'], ['16.6.2026', 'DATE'], ['2026-06-30', 'DATE'], ['2026.06.30', 'DATE'], ['22/06/2026 10:59', 'DATE'],
    ['30.06.26', 'DATE'], ['2026-06-30T10:59', 'DATE'],
    ['3.584,00 EUR', 'CURRENCY'], ['78.298,47€', 'CURRENCY'], ['1.015,69', 'CURRENCY'], ['229,40', 'CURRENCY'], ['4,122.85', 'CURRENCY'],
    ['3.584,00 ευρώ', 'CURRENCY'], ['3.584,00 ΕΥΡΩ', 'CURRENCY'],
    ['24.000', 'NUMBER'], ['309', 'NUMBER'], ['24 %', 'NUMBER'], ['437.775,64 kWh', 'NUMBER'], ['300 M3', 'NUMBER'],
    ['ΤΠΥ0000017', 'TEXT'], ['094170559', 'TEXT'], ['', 'TEXT'], ['Επί πιστώσει', 'TEXT'], ['60.64.00.000.010', 'TEXT'],
    ['60.64.00', 'TEXT'], ['-094170559', 'TEXT'], ['31/02/2026', 'TEXT'],
  ])('%s → %s', (raw, expected) => { expect(guessValueType(raw)).toBe(expected); });
});

describe('isGlAccount', () => {
  it.each(['60.64.00.000.010', '62.03.90.000.023', '25.09.00.000.006', '61.90.01.016.023'])('accepts %s', (s) => { expect(isGlAccount(s)).toBe(true); });
  it.each(['3.584,00', '2026.06.30', '24.000', 'ΤΠΥ0000017', '60.64'])('rejects %s', (s) => { expect(isGlAccount(s)).toBe(false); });
  it('ignores spaces written between groups', () => { expect(isGlAccount('60.64.00. 000.010')).toBe(true); });
});
