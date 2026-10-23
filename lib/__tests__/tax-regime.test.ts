import { describe, it, expect } from 'vitest';
import { taxRegime, hasMyData, asInstallCountry, INSTALL_COUNTRY_OPTIONS } from '../tax-regime';

describe('asInstallCountry', () => {
  it('δέχεται GR και CY, σε όποια γραφή', () => {
    expect(asInstallCountry('CY')).toBe('CY');
    expect(asInstallCountry(' cy ')).toBe('CY');
    expect(asInstallCountry('GR')).toBe('GR');
  });
  it('ΑΓΝΩΣΤΟ ή κενό ⇒ Ελλάδα· η υπάρχουσα εγκατάσταση δεν αλλάζει συμπεριφορά από μόνη της', () => {
    for (const v of [null, undefined, '', 'XX', 42, {}]) expect(asInstallCountry(v)).toBe('GR');
  });
});

describe('taxRegime', () => {
  it('Ελλάδα: myDATA και Δ.Ο.Υ.', () => {
    expect(taxRegime('GR')).toMatchObject({ myData: true, taxOffices: true, vatLabel: 'ΑΦΜ', registryLabel: 'ΑΑΔΕ' });
  });
  it('Κύπρος: ΟΥΤΕ myDATA ΟΥΤΕ Δ.Ο.Υ., και το ΑΦΜ λέγεται ΑΦΤ', () => {
    expect(taxRegime('CY')).toMatchObject({ myData: false, taxOffices: false, vatLabel: 'ΑΦΤ' });
  });
  it('hasMyData είναι συντομία του ίδιου κανόνα', () => {
    expect(hasMyData('CY')).toBe(false);
    expect(hasMyData('GR')).toBe(true);
    expect(hasMyData(undefined)).toBe(true);
  });
});

describe('επιλογές ρύθμισης', () => {
  it('καλύπτουν ακριβώς τις χώρες που ξέρει ο κανόνας', () => {
    expect(INSTALL_COUNTRY_OPTIONS.map((o) => o.value)).toEqual(['GR', 'CY']);
    for (const o of INSTALL_COUNTRY_OPTIONS) expect(o.label).not.toBe(o.value);
  });
});
