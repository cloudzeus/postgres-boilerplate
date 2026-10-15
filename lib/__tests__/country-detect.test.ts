// Χώρα εκδότη από ό,τι γράφει το παραστατικό. Συνθετικές διευθύνσεις.
import { describe, it, expect } from 'vitest';
import { countryInText, detectIssuerCountry } from '@/lib/country-detect';

describe('countryInText', () => {
  it('όνομα χώρας στο τέλος της διεύθυνσης', () => {
    expect(countryInText('Via Esempio, 1 - 30020 PAESE (VE) - ITALY')).toBe('IT');
    expect(countryInText('Musterstraße 40 - 74321 Musterstadt, Deutschland')).toBe('DE');
    expect(countryInText('Lane 1\nDublin 2\nIreland')).toBe('IE');
    expect(countryInText('OSB 254. SOK. NO:4/1 ERGENE/TEKIRDAG/TURKEY')).toBe('TR');
    expect(countryInText('Bb, 18410 Mesto, Srbija')).toBe('RS');
    expect(countryInText('Türkiye')).toBe('TR');
  });
  it('πρόθεμα Τ.Κ. χώρας', () => {
    expect(countryInText('AT-2355 Wiener Neudorf, POB36')).toBe('AT');
    expect(countryInText('D-74321 Stadt')).toBe('DE');
  });
  it('νικά το τελευταίο ταίριασμα· λέξεις που μοιάζουν δεν μετρούν', () => {
    expect(countryInText('Italy Street 5, London, United Kingdom')).toBe('GB');
    expect(countryInText('Canvey Island, Essex, UK')).toBe('GB');
    expect(countryInText('Via Tommaso 39')).toBeNull();
    expect(countryInText('ΛΕΩΦ. ΚΗΦΙΣΙΑΣ 10, ΜΑΡΟΥΣΙ')).toBeNull();
  });
});

describe('detectIssuerCountry', () => {
  it('πεδίο χώρας (όνομα ή ISO) πριν από τη διεύθυνση', () => {
    expect(detectIssuerCountry({ country: 'ITALY', address: 'Via 1' })).toBe('IT');
    expect(detectIssuerCountry({ country: 'it' })).toBe('IT');
    expect(detectIssuerCountry({ country: 'EL' })).toBe('GR');
    expect(detectIssuerCountry({ country: null, address: 'Mathaf area 11-4694 BEIRUT', city: 'BEIRUT' })).toBeNull();
    expect(detectIssuerCountry({ country: 'Lebanon' })).toBe('LB');
  });
});
