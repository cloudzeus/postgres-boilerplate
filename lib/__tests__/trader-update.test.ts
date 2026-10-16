import { describe, it, expect } from 'vitest';
import { planTraderUpdate, traderValuesFromRow, unappliedChanges, TRADER_OBJECT_BY_SODTYPE } from '@/lib/trader-update';

const live = traderValuesFromRow(
  { NAME: 'ΑΛΦΑ ΑΕ', AFM: '094014201', IRSDATA: '1104', ADDRESS: 'Οδός 1', ZIP: '10431', CITY: 'ΑΘΗΝΑ', PHONE01: '2101234567', EMAIL: '' },
  { KAD: '120', KAD1: '' },
);

describe('planTraderUpdate', () => {
  it('στέλνει ΜΟΝΟ ό,τι άλλαξε', () => {
    const p = planTraderUpdate(live, { ...live, city: 'ΠΕΙΡΑΙΑΣ', email: 'info@alfa.gr' });
    expect(p.changes.map((c) => c.key)).toEqual(['city', 'email']);
    expect(p.row).toEqual({ CITY: 'ΠΕΙΡΑΙΑΣ', EMAIL: 'info@alfa.gr' });
    expect(p.extra).toBeNull();
  });
  it('απόντα κλειδιά = «δεν αγγίζω»· κενά/διπλά κενά δεν είναι αλλαγή', () => {
    expect(planTraderUpdate(live, { name: '  ΑΛΦΑ   ΑΕ ' }).changes).toEqual([]);
    expect(planTraderUpdate(live, { zip: '10431' }).changes).toEqual([]);
  });
  it('σβήσιμο πεδίου = κενό string· η επωνυμία δεν σβήνεται', () => {
    expect(planTraderUpdate(live, { phone: '' }).row).toEqual({ PHONE01: '' });
    const p = planTraderUpdate(live, { name: '' });
    expect(p.errors).toHaveLength(1);
    expect(p.changes).toEqual([]);
  });
  it('όριο χαρακτήρων του schema', () => {
    expect(planTraderUpdate(live, { zip: '12345678901' }).errors[0]).toMatch(/Τ\.Κ\..*10/);
  });
  it('Δ.Ο.Υ./χώρα ως αριθμητικά κλειδιά· ΚΑΔ στον πίνακα EXTRA', () => {
    const p = planTraderUpdate(live, { irsData: '1159', country: '1000', kad: 777 });
    expect(p.row).toEqual({ IRSDATA: 1159, COUNTRY: 1000 });
    expect(p.extra).toEqual({ KAD: 777 });
    expect(planTraderUpdate(live, { country: 'GR' }).errors[0]).toMatch(/Χώρα/);
  });
  it('μετά την εγγραφή: ό,τι δεν κράτησε η SoftOne', () => {
    const p = planTraderUpdate(live, { city: 'ΠΕΙΡΑΙΑΣ', kad: 777 });
    expect(unappliedChanges(p, { ...live, city: 'ΠΕΙΡΑΙΑΣ', kad: 777 })).toEqual([]);
    expect(unappliedChanges(p, { ...live, city: 'ΑΘΗΝΑ', kad: 120 }).map((c) => c.key)).toEqual(['city', 'kad']);
  });
  it('object ανά τύπο — οι χρηματικοί λογαριασμοί (14) δεν τροποποιούνται', () => {
    expect(TRADER_OBJECT_BY_SODTYPE[13]).toEqual({ object: 'CUSTOMER', extra: 'CUSEXTRA' });
    expect(TRADER_OBJECT_BY_SODTYPE[14]).toBeUndefined();
  });
});
