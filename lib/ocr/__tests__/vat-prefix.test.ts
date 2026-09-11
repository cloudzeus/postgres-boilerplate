import { describe, it, expect } from 'vitest';
import { VAT_PREFIX_BY_COUNTRY, vatPrefixFor, applyVatPrefix } from '../vat-prefix';

describe('VAT_PREFIX_BY_COUNTRY / vatPrefixFor', () => {
  it('οι εξαιρέσεις: Ελλάδα EL, Β. Ιρλανδία XI, Ελβετία CHE, Μονακό FR', () => {
    expect(vatPrefixFor('GR')).toBe('EL');
    expect(vatPrefixFor('XI')).toBe('XI');
    expect(vatPrefixFor('CH')).toBe('CHE');
    expect(vatPrefixFor('MC')).toBe('FR');
  });
  it('όλες οι υπόλοιπες ισούνται με τον ISO-2 κωδικό', () => {
    for (const [iso, prefix] of Object.entries(VAT_PREFIX_BY_COUNTRY)) {
      if (['GR', 'CH', 'MC'].includes(iso)) continue;
      expect(prefix).toBe(iso);
    }
    expect(vatPrefixFor('DE')).toBe('DE');
    expect(vatPrefixFor('CY')).toBe('CY');
  });
  it('καλύπτει ΕΕ-27 + ΗΒ/XI + ΕΖΕΣ', () => {
    const eu27 = ['AT','BE','BG','CY','CZ','DE','DK','EE','ES','FI','FR','GR','HR','HU',
      'IE','IT','LT','LU','LV','MT','NL','PL','PT','RO','SE','SI','SK'];
    for (const c of [...eu27, 'GB', 'XI', 'CH', 'NO', 'IS', 'LI', 'SM']) {
      expect(vatPrefixFor(c), c).toBeTruthy();
    }
  });
  it('δέχεται «EL» ως συνώνυμο της Ελλάδας, πεζά και κενά', () => {
    expect(vatPrefixFor('el')).toBe('EL');
    expect(vatPrefixFor(' de ')).toBe('DE');
  });
  it('άγνωστη χώρα → null', () => {
    expect(vatPrefixFor('ZZ')).toBeNull();
    expect(vatPrefixFor('')).toBeNull();
    expect(vatPrefixFor(null)).toBeNull();
  });
});

describe('applyVatPrefix', () => {
  it('ήδη προθεματισμένο → αμετάβλητο', () => {
    expect(applyVatPrefix('CY10123456A', 'CY')).toBe('CY10123456A');
    expect(applyVatPrefix('DE144960040', 'FR')).toBe('DE144960040');
    expect(applyVatPrefix('CHE116281277', 'CH')).toBe('CHE116281277');
    expect(applyVatPrefix('XI123456789', 'GB')).toBe('XI123456789');
  });
  it('ελληνικό δεν προθεματίζεται ΠΟΤΕ', () => {
    expect(applyVatPrefix('094014201', 'GR')).toBe('094014201');
    expect(applyVatPrefix('EL999863881', 'GR')).toBe('999863881');
    expect(applyVatPrefix('GR 999 863 881', 'DE')).toBe('999863881');
  });
  it('ξένα ψηφία παίρνουν το πρόθεμα της χώρας', () => {
    expect(applyVatPrefix('144960040', 'DE')).toBe('DE144960040');
    expect(applyVatPrefix('10123456', 'CY')).toBe('CY10123456');
    expect(applyVatPrefix('116281277', 'CH')).toBe('CHE116281277');
  });
  it('ξένα αλφαριθμητικά κρατούν τα γράμματά τους', () => {
    expect(applyVatPrefix('6388047V', 'IE')).toBe('IE6388047V');
    expect(applyVatPrefix('10123456 A', 'CY')).toBe('CY10123456A');
  });
  it('καθαρίζει κενά, τελείες και παύλες', () => {
    expect(applyVatPrefix('144-960.040', 'DE')).toBe('DE144960040');
  });
  it('άγνωστη χώρα → καθαρισμένο, χωρίς πρόθεμα· κενό → κενό', () => {
    expect(applyVatPrefix('144960040', 'ZZ')).toBe('144960040');
    expect(applyVatPrefix('', 'DE')).toBe('');
  });
  it('είναι idempotent', () => {
    const once = applyVatPrefix('6388047V', 'IE');
    expect(applyVatPrefix(once, 'IE')).toBe(once);
  });
});
