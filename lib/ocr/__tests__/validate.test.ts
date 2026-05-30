import { describe, it, expect } from 'vitest';
import { isValidAfm } from '../validate';

describe('isValidAfm', () => {
  it('accepts a valid 9-digit ΑΦΜ', () => {
    expect(isValidAfm('094014201')).toBe(true);   // ΟΤΕ Α.Ε. — real valid ΑΦΜ
  });
  it('rejects a number that fails the mod-11 check digit', () => {
    expect(isValidAfm('094014202')).toBe(false);
  });
  it('rejects wrong length / non-digits / all zeros', () => {
    expect(isValidAfm('12345678')).toBe(false);
    expect(isValidAfm('12345678a')).toBe(false);
    expect(isValidAfm('000000000')).toBe(false);
  });
  it('strips spaces and non-digit noise before checking', () => {
    expect(isValidAfm('094 014 201')).toBe(true);
  });
});
