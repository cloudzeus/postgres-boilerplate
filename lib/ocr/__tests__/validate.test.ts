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

import { checkTotals, fixSwappedParties, qualityScore, normalizeAfm } from '../validate';

describe('normalizeAfm', () => {
  it('strips the EL country prefix', () => {
    expect(normalizeAfm('EL999863881')).toBe('999863881');
  });
  it('strips spaces, dots and other formatting', () => {
    expect(normalizeAfm('ΑΦΜ: 999 863.881')).toBe('999863881');
  });
  it('leaves a bare ΑΦΜ untouched', () => {
    expect(normalizeAfm('094014201')).toBe('094014201');
  });
  it('returns null when there are no digits', () => {
    expect(normalizeAfm('')).toBeNull();
    expect(normalizeAfm(null)).toBeNull();
    expect(normalizeAfm('EL')).toBeNull();
  });
});

describe('checkTotals', () => {
  it('passes when subtotal + vat == total within tolerance', () => {
    expect(checkTotals({ subtotal: 100, vatAmount: 24, totalAmount: 124 }).ok).toBe(true);
    expect(checkTotals({ subtotal: 100, vatAmount: 24, totalAmount: 124.01 }).ok).toBe(true);
  });
  it('fails when the arithmetic is off beyond tolerance', () => {
    const r = checkTotals({ subtotal: 100, vatAmount: 24, totalAmount: 130 });
    expect(r.ok).toBe(false);
    expect(r.issues.length).toBeGreaterThan(0);
  });
  it('is neutral (ok) when any total is missing', () => {
    expect(checkTotals({ subtotal: 100, vatAmount: null, totalAmount: 124 }).ok).toBe(true);
  });
});

describe('fixSwappedParties', () => {
  const ownAfm = '094014201';
  it('swaps issuer/recipient when the issuer ΑΦΜ is our own ΑΦΜ', () => {
    const out = fixSwappedParties(
      { companyName: 'US', vatNumber: ownAfm, customerName: 'THEM', customerVatNumber: '123456789' },
      ownAfm,
    );
    expect(out.vatNumber).toBe('123456789');
    expect(out.customerVatNumber).toBe(ownAfm);
    expect(out.companyName).toBe('THEM');
    expect(out.customerName).toBe('US');
  });
  it('leaves data unchanged when the issuer is not us', () => {
    const data = { vatNumber: '123456789', customerVatNumber: ownAfm };
    expect(fixSwappedParties(data, ownAfm)).toEqual(data);
  });
  it('no-ops when ownAfm is null', () => {
    const data = { vatNumber: '094014201' };
    expect(fixSwappedParties(data, null)).toEqual(data);
  });
});

describe('qualityScore', () => {
  it('ranks a fully-correct invoice better (lower) than one with a wrong ΑΦΜ', () => {
    const good = { companyName:'A', vatNumber:'094014201', customerName:'B', customerVatNumber:'090000045',
      invoiceNumber:'1', date:'2026-01-01', subtotal:100, vatAmount:24, totalAmount:124 };
    const badAfm = { ...good, vatNumber:'094014202' };               // present but invalid
    const badMath = { ...good, totalAmount: 999 };                   // present but wrong total
    expect(qualityScore(good, 'invoice')).toBeLessThan(qualityScore(badAfm, 'invoice'));
    expect(qualityScore(good, 'invoice')).toBeLessThan(qualityScore(badMath, 'invoice'));
  });
});
