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

import {
  checkTotals, fixSwappedParties, qualityScore, normalizeAfm,
  normalizeVatId, vatCountry, isForeignVatId, viesPrefix, parseAfmParam,
} from '../validate';

describe('normalizeVatId', () => {
  it('ελληνικό με πρόθεμα EL/GR → σκέτα ψηφία, χώρα GR', () => {
    expect(normalizeVatId('EL999863881')).toEqual({ id: '999863881', country: 'GR' });
    expect(normalizeVatId('GR 094 014 201')).toEqual({ id: '094014201', country: 'GR' });
  });
  it('κόβει ετικέτα, κενά, τελείες και παύλες', () => {
    expect(normalizeVatId('ΑΦΜ: 999 863.881')).toEqual({ id: '999863881', country: 'GR' });
    expect(normalizeVatId('VAT No. DE 144-960-040')).toEqual({ id: 'DE144960040', country: 'DE' });
  });
  it('ξένο VAT κρατά το πρόθεμα και τα γράμματα του αριθμού', () => {
    expect(normalizeVatId('CY 10123456 A')).toEqual({ id: 'CY10123456A', country: 'CY' });
    expect(normalizeVatId('IE6388047V')).toEqual({ id: 'IE6388047V', country: 'IE' });
    expect(normalizeVatId('de144960040')).toEqual({ id: 'DE144960040', country: 'DE' });
  });
  it('XI (Β. Ιρλανδία) κρατά το πρόθεμα αλλά η χώρα είναι GB', () => {
    expect(normalizeVatId('XI123456789')).toEqual({ id: 'XI123456789', country: 'GB' });
  });
  it('«NO» στην αρχή είναι η Νορβηγία, όχι ετικέτα «No.»', () => {
    expect(normalizeVatId('NO 974760827')).toEqual({ id: 'NO974760827', country: 'NO' });
  });
  it('σκέτα ψηφία: GR μόνο όταν περνούν τον έλεγχο mod-11', () => {
    expect(normalizeVatId('094014201')).toEqual({ id: '094014201', country: 'GR' });
    expect(normalizeVatId('123456789')).toEqual({ id: '123456789', country: null });
  });
  it('άγνωστο πρόθεμα πέφτει πίσω στα ψηφία', () => {
    expect(normalizeVatId('ZZ12345678')).toEqual({ id: '12345678', country: null });
  });
  it('σκουπίδια → null', () => {
    expect(normalizeVatId('')).toBeNull();
    expect(normalizeVatId(null)).toBeNull();
    expect(normalizeVatId('EL')).toBeNull();
    expect(normalizeVatId('—/—')).toBeNull();
  });
});

describe('vatCountry / isForeignVatId / viesPrefix', () => {
  it('διαβάζει τη χώρα από αποθηκευμένο id', () => {
    expect(vatCountry('CY10123456A')).toBe('CY');
    expect(vatCountry('XI123456789')).toBe('GB');
    expect(vatCountry('094014201')).toBe('GR');
    expect(vatCountry('123456789')).toBeNull();
    expect(vatCountry('')).toBeNull();
  });
  it('ξένο = γνωστή χώρα ≠ GR (το άγνωστο μετράει ως ελληνικό)', () => {
    expect(isForeignVatId('DE144960040')).toBe(true);
    expect(isForeignVatId('094014201')).toBe(false);
    expect(isForeignVatId('123456789')).toBe(false);
  });
  it('VIES μόνο για χώρες ΕΕ (+XI) — όχι CH/NO/GB', () => {
    expect(viesPrefix('CY10123456A')).toBe('CY');
    expect(viesPrefix('XI123456789')).toBe('XI');
    expect(viesPrefix('CHE116281277')).toBeNull();
    expect(viesPrefix('NO974760827')).toBeNull();
    expect(viesPrefix('094014201')).toBeNull();
  });
});

describe('parseAfmParam', () => {
  it('δέχεται 8–12 ψηφία και ξένο id με γνωστό πρόθεμα', () => {
    expect(parseAfmParam('094073495')).toBe('094073495');
    expect(parseAfmParam('CY10123456A')).toBe('CY10123456A');
    expect(parseAfmParam('DE144960040')).toBe('DE144960040');
  });
  it('απορρίπτει EL… (τα ελληνικά αποθηκεύονται σκέτα), άγνωστο πρόθεμα και σκουπίδια', () => {
    expect(parseAfmParam('EL094073495')).toBeNull();
    expect(parseAfmParam('ZZ12345678')).toBeNull();
    expect(parseAfmParam('cy10123456a')).toBeNull();
    expect(parseAfmParam('1234567')).toBeNull();
    expect(parseAfmParam('094073495/../x')).toBeNull();
  });
});

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
  it('κρατά το πρόθεμα χώρας ενός ξένου VAT id', () => {
    expect(normalizeAfm('CY 10123456 A')).toBe('CY10123456A');
    expect(normalizeAfm('DE144960040')).toBe('DE144960040');
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


describe('qualityScore — ξένος εκδότης', () => {
  const base = { companyName: 'A', customerName: 'B', customerVatNumber: '090000045',
    invoiceNumber: '1', date: '2026-01-01', subtotal: 100, vatAmount: 24, totalAmount: 124 };
  it('δεν τιμωρεί ξένο VAT id με τον ελληνικό έλεγχο mod-11', () => {
    expect(qualityScore({ ...base, vatNumber: 'DE144960040' }, 'invoice'))
      .toBe(qualityScore({ ...base, vatNumber: '094014201' }, 'invoice'));
  });
});
