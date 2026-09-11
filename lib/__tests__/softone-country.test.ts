// Καθαρή λογική της χώρας στο setData του συναλλασσομένου: ISO-2 → COUNTRY id.
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: {} }));

import { buildTraderPayload, matchCountryId, type SoftoneCountry } from '@/lib/softone';

const COUNTRIES: SoftoneCountry[] = [
  { id: '1000', shortcut: 'GR', name: 'ΕΛΛΑΔΑ', intcode: 'GR', intercode: 'GR' },
  { id: '1012', shortcut: 'CY', name: 'ΚΥΠΡΟΣ', intcode: 'CY', intercode: 'CY' },
  // Εγκατάσταση που κρατά τον ISO κωδικό ΜΟΝΟ στο Intrastat πεδίο.
  { id: '1004', shortcut: 'ΓΕΡΜ', name: 'ΓΕΡΜΑΝΙΑ', intcode: 'DE', intercode: '' },
  { id: '1099', shortcut: '', name: 'ΕΛΒΕΤΙΑ', intcode: '', intercode: 'CH' },
];

describe('matchCountryId', () => {
  it('ταιριάζει σε SHORTCUT, INTCODE ή INTERCODE', () => {
    expect(matchCountryId('CY', COUNTRIES)).toBe('1012');
    expect(matchCountryId('de', COUNTRIES)).toBe('1004');
    expect(matchCountryId('CH', COUNTRIES)).toBe('1099');
  });
  it('null για άγνωστο ή μη ISO-2', () => {
    expect(matchCountryId('PT', COUNTRIES)).toBeNull();
    expect(matchCountryId('ΚΥΠΡΟΣ', COUNTRIES)).toBeNull();
    expect(matchCountryId(null, COUNTRIES)).toBeNull();
    expect(matchCountryId('CY', [])).toBeNull();
  });
});

describe('buildTraderPayload — COUNTRY', () => {
  const base = { name: 'ALPHA LTD', afm: 'CY10123456A', address: 'Makariou 1', city: 'Λευκωσία', zip: '1065' };

  it('γράφει το αριθμητικό COUNTRY όταν η χώρα βρεθεί στο μητρώο', () => {
    const p = buildTraderPayload('supplier', { ...base, country: 'CY' }, COUNTRIES);
    expect(p.OBJECT).toBe('SUPPLIER');
    expect(p.DATA.SUPPLIER[0]).toMatchObject({
      NAME: 'ALPHA LTD', AFM: 'CY10123456A', COUNTRY: 1012, ZIP: '1065', CITY: 'Λευκωσία',
    });
  });

  it('παραλείπει το COUNTRY όταν η χώρα δεν βρεθεί ή δεν δόθηκε', () => {
    expect(buildTraderPayload('creditor', { ...base, country: 'PT' }, COUNTRIES).DATA.CREDITOR[0])
      .not.toHaveProperty('COUNTRY');
    expect(buildTraderPayload('supplier', base, COUNTRIES).DATA.SUPPLIER[0])
      .not.toHaveProperty('COUNTRY');
    // Χωρίς μητρώο (π.χ. το SoftOne δεν απάντησε) το payload μένει έγκυρο.
    expect(buildTraderPayload('supplier', { ...base, country: 'CY' }).DATA.SUPPLIER[0])
      .not.toHaveProperty('COUNTRY');
  });
});
