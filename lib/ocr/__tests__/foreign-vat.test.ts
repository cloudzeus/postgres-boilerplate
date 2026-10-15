// Ξένο ΑΦΜ χωρίς πρόθεμα + χώρα από το ίδιο το παραστατικό → «IT…»/«DE…». Συνθετικά στοιχεία.
import { describe, it, expect } from 'vitest';
import { foreignVatFromCountry, vatBodyFits } from '@/lib/ocr/vat-prefix';
import { normalizeDocument } from '@/lib/ocr/canonical';

describe('vatBodyFits / foreignVatFromCountry', () => {
  it('πρόθεμα μόνο όταν ο αριθμός έχει τη μορφή της χώρας', () => {
    expect(foreignVatFromCountry('01808880270', 'IT')).toBe('IT01808880270');
    expect(foreignVatFromCountry('144960040', 'DE')).toBe('DE144960040');
    expect(foreignVatFromCountry('U19208701', 'AT')).toBe('ATU19208701');
    expect(foreignVatFromCountry('123456789', 'IT')).toBeNull();      // 9 ψηφία ≠ ιταλική μορφή
    expect(foreignVatFromCountry('IT01808880270', 'IT')).toBeNull();  // ήδη με πρόθεμα
    expect(foreignVatFromCountry('094073495', 'GR')).toBeNull();
    expect(foreignVatFromCountry('8070036187', 'TR')).toBeNull();     // εκτός ΕΕ: χωρίς πρόθεμα ΦΠΑ
    expect(vatBodyFits('NL', '123456789B01')).toBe(true);
    expect(vatBodyFits('TR', '8070036187')).toBeNull();
  });
});

describe('normalizeDocument — ΑΦΜ εκδότη', () => {
  const doc = (issuer: Record<string, unknown>) => normalizeDocument({ kind: 'invoice', issuer, lines: [] });
  it('ξένο από τη χώρα/διεύθυνση του παραστατικού', () => {
    expect(doc({ vat: '01808880270', country: 'ITALY' }).issuer.vat).toBe('IT01808880270');
    expect(doc({ vat: '144960040', address: 'Musterstraße 1, 74321 Stadt, Deutschland' }).issuer.vat).toBe('DE144960040');
  });
  it('έγκυρο ελληνικό ή χωρίς ένδειξη χώρας μένει ως έχει', () => {
    expect(doc({ vat: '094073495', address: 'Via Roma 1, Italy' }).issuer.vat).toBe('094073495');
    expect(doc({ vat: '01808880270' }).issuer.vat).toBe('01808880270');
  });
});

describe('normalizeDocument — επικοινωνία εκδότη', () => {
  it('κρατά τηλέφωνο 2, fax, ιστοσελίδα', () => {
    const d = normalizeDocument({ kind: 'invoice', issuer: { name: 'X', phone: '1', phone2: '2', fax: '3', website: 'www.x.it' }, lines: [] });
    expect(d.issuer).toMatchObject({ phone: '1', phone2: '2', fax: '3', website: 'www.x.it' });
  });
});
