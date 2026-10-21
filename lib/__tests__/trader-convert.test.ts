// «Μετατροπή» πιστωτή ⇄ προμηθευτή: νέα καρτέλα από τα στοιχεία της παλιάς (καθαρό μέρος + payload).
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/settings', () => ({ getSetting: async () => undefined, setSetting: async () => {} }));

import { CONVERSION_BY_SODTYPE, conversionErrors, conversionInput } from '@/lib/trader-convert';
import { buildTraderPayload } from '@/lib/softone';

// Συνθετικά στοιχεία — όχι πραγματικός συναλλασσόμενος.
const VALUES = {
  name: '  ΔΟΚΙΜΑΣΤΙΚΗ   ΕΚΔΟΤΙΚΗ ', afm: '099999999', irsData: '1104', profession: 'Εκδόσεις',
  address: 'Οδός 1', district: 'Κέντρο', zip: '10000', city: 'Αθήνα', country: '1000',
  phone: '2100000000', phone2: null, fax: '', email: 'info@example.com', webpage: null,
  kad: 581, kad1: null,
};

describe('CONVERSION_BY_SODTYPE', () => {
  it('πιστωτής → προμηθευτής και αντίστροφα· πελάτες/χρεώστες όχι', () => {
    expect(CONVERSION_BY_SODTYPE[16]).toMatchObject({ to: 'supplier', toSodtype: 12, fromObject: 'CREDITOR' });
    expect(CONVERSION_BY_SODTYPE[12]).toMatchObject({ to: 'creditor', toSodtype: 16, fromObject: 'SUPPLIER' });
    expect(CONVERSION_BY_SODTYPE[13]).toBeUndefined();
    expect(CONVERSION_BY_SODTYPE[15]).toBeUndefined();
  });
});

describe('conversionInput', () => {
  it('αντιγράφει τα στοιχεία, καθαρίζει κενά, κρατά τη χώρα ως id της SoftOne', () => {
    const i = conversionInput(VALUES, { vatStatus: '1', payment: '1004', currency: '100' }, ' 50-0012 ');
    expect(i).toMatchObject({
      name: 'ΔΟΚΙΜΑΣΤΙΚΗ ΕΚΔΟΤΙΚΗ', afm: '099999999', code: '50-0012', irsData: '1104', district: 'Κέντρο',
      countryId: '1000', country: '', fax: null, kad: 581, kad1: null, vatStatus: '1', payment: '1004', currency: '100',
    });
  });
  it('κενός κωδικός ⇒ null (αυτόματη αρίθμηση της SoftOne)', () => {
    expect(conversionInput(VALUES, {}, '  ').code).toBeNull();
  });
});

describe('conversionErrors', () => {
  it('μόνο 12/16, με επωνυμία, κωδικός έως 25', () => {
    expect(conversionErrors(16, VALUES, null)).toEqual([]);
    expect(conversionErrors(13, VALUES, null)).toHaveLength(1);
    expect(conversionErrors(16, { ...VALUES, name: ' ' }, null)).toHaveLength(1);
    expect(conversionErrors(16, VALUES, 'X'.repeat(26))).toHaveLength(1);
  });
});

describe('payload της νέας καρτέλας', () => {
  it('SUPPLIER με COUNTRY από id, DISTRICT, VATSTS/PAYMENT/SOCURRENCY και ΚΑΔ στο SUPEXTRA — ΧΩΡΙΣ TRDCATEGORY', () => {
    const p = buildTraderPayload('supplier', conversionInput(VALUES, { vatStatus: '0', payment: '1004', currency: '100' }, 'S1'));
    expect(p.OBJECT).toBe('SUPPLIER');
    expect(p.KEY).toBe('');
    const row = p.DATA.SUPPLIER[0];
    expect(row).toMatchObject({ NAME: 'ΔΟΚΙΜΑΣΤΙΚΗ ΕΚΔΟΤΙΚΗ', AFM: '099999999', CODE: 'S1', COUNTRY: 1000, DISTRICT: 'Κέντρο', VATSTS: 0, PAYMENT: 1004, SOCURRENCY: 100 });
    expect(row).not.toHaveProperty('TRDCATEGORY');
    expect(p.DATA.SUPEXTRA).toEqual([{ KAD: 581 }]);
  });
  it('μη αριθμητικές τιμές δεν γράφονται', () => {
    const row = buildTraderPayload('supplier', conversionInput(VALUES, { vatStatus: '', payment: 'x', currency: null }, null)).DATA.SUPPLIER[0];
    expect(row).not.toHaveProperty('VATSTS');
    expect(row).not.toHaveProperty('PAYMENT');
    expect(row).not.toHaveProperty('SOCURRENCY');
    expect(row).not.toHaveProperty('CODE');
  });
});
