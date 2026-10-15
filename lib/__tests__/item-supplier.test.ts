// Κωδικός & τιμή ανά προμηθευτή σε υπάρχον είδος — συνθετικά δεδομένα όπως τα επιστρέφει το getData.
import { describe, it, expect } from 'vitest';
import { parseItemSupplierData, planItemSupplier, isoDate } from '@/lib/item-supplier';

const DATA = {
  ITEM: [{ MTRL: '1266', CODE: '60006' }],
  MTRSUPCODE: [
    { LINENUM: '1', TRDR: '28', MTRSUPCODE: 'A-100', MTRSUPNAME: 'Προϊόν Α', ISACTIVE: '1' },
    { LINENUM: '2', TRDR: '31', MTRSUPCODE: 'B-200', ISACTIVE: '1' },
  ],
  MTRSUPPRCS: [
    { LINENUM: '1', TRDR: '28', SOCURRENCY: '100|EURO', SUPPRICE: '45', SUPDISC1: '0', ISACTIVE: '1', SUPDATE: '2026-12-31 00:00:00', LASTPRICE: '44' },
    { LINENUM: '2', TRDR: '29', SOCURRENCY: '100|EURO', SUPPRICE: '150', ISACTIVE: '1' },
  ],
};
const state = parseItemSupplierData(1266, DATA);

describe('parseItemSupplierData', () => {
  it('διαβάζει κωδικούς/τιμές με τα LINENUM τους', () => {
    expect(state.codes.map((c) => [c.linenum, c.trdr, c.code])).toEqual([[1, 28, 'A-100'], [2, 31, 'B-200']]);
    expect(state.prices[0]).toMatchObject({ linenum: 1, trdr: 28, currency: 100, price: 45, lastPrice: 44 });
  });
});

describe('planItemSupplier', () => {
  it('νέος προμηθευτής: νέα γραμμή κωδικού ΚΑΙ τιμής, οι υπάρχουσες ξαναστέλνονται όλες', () => {
    const p = planItemSupplier(state, { trdr: 2793, code: 'IT-9', name: 'Tubo', price: 0.5 });
    expect(p.payload?.KEY).toBe(1266);
    const codes = p.payload!.DATA.MTRSUPCODE;
    expect(codes.map((r) => r.LINENUM)).toEqual([1, 2, 9000001]);
    expect(codes[2]).toMatchObject({ TRDR: 2793, MTRSUPCODE: 'IT-9', ISACTIVE: 1 });
    const prices = p.payload!.DATA.MTRSUPPRCS;
    expect(prices.map((r) => r.LINENUM)).toEqual([1, 2, 9000001]);
    expect(prices[0]).toMatchObject({ TRDR: 28, SUPPRICE: 45, SOCURRENCY: 100, SUPDATE: '2026-12-31' });
    expect(prices[0]).not.toHaveProperty('LASTPRICE');           // μόνο ανάγνωση — ποτέ δεν στέλνεται
    expect(prices[2]).toMatchObject({ TRDR: 2793, SUPPRICE: 0.5, SOCURRENCY: 100 });
    expect(p.changes).toHaveLength(2);
  });

  it('υπάρχων προμηθευτής: η τιμή ενημερώνεται στη ΔΙΚΗ ΤΟΥ γραμμή, χωρίς νέα', () => {
    const p = planItemSupplier(state, { trdr: 28, price: 47.5 });
    expect(p.payload!.DATA.MTRSUPPRCS.map((r) => [r.LINENUM, r.SUPPRICE])).toEqual([[1, 47.5], [2, 150]]);
    expect(p.payload!.DATA).not.toHaveProperty('MTRSUPCODE');
  });

  it('ίδιος κωδικός & ίδια τιμή → τίποτα να σταλεί', () => {
    expect(planItemSupplier(state, { trdr: 28, code: 'a-100', price: 45 }).payload).toBeNull();
  });

  it('δεύτερος κωδικός για τον ίδιο προμηθευτή προστίθεται — δεν αντικαθιστά τον πρώτο', () => {
    const codes = planItemSupplier(state, { trdr: 28, code: 'A-101' }).payload!.DATA.MTRSUPCODE;
    expect(codes.filter((r) => r.TRDR === 28).map((r) => r.MTRSUPCODE)).toEqual(['A-100', 'A-101']);
  });

  it('ημερομηνία μόνο σε ISO', () => {
    expect(isoDate('2026-12-31 00:00:00')).toBe('2026-12-31');
    expect(isoDate('31/12/2026')).toBeNull();
  });
});
