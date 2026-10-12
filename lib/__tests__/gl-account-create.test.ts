import { describe, expect, it, vi, beforeEach } from 'vitest';

const { softone, db } = vi.hoisted(() => ({
  softone: { softoneCall: vi.fn(), softoneGetTable: vi.fn() },
  db: { vatCategory: { findMany: vi.fn() } },
}));
vi.mock('@/lib/softone', () => softone);
vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/settings', () => ({ getSetting: vi.fn().mockResolvedValue(null) }));

import { planGlAccount } from '../softone-sync/gl-account-create';

// Ένα μικρό λογιστικό σχέδιο όπως το Demo S1.
const CHART = [
  { ACNT: '4110', CODE: '62.00.00', NAME: 'Ηλεκτρικό ρεύμα παραγωγής', ACNGRADE: '3', ACNMOVING: '0', VAT: '' },
  { ACNT: '4114', CODE: '62.00.00.0019', NAME: 'Ηλεκτρικό ρεύμα παραγωγής με Φ.Π.Α. 19%', ACNGRADE: '4', ACNMOVING: '1', VAT: '1190' },
  { ACNT: '8306', CODE: '62.00.00.0024', NAME: 'Ηλεκτρικό ρεύμα παραγωγής με Φ.Π.Α. 24%', ACNGRADE: '4', ACNMOVING: '1', VAT: '1410' },
  { ACNT: '3795', CODE: '54.00.29.0006', NAME: 'Φ.Π.Α. εισρ-δαπ εσωτερ.με Φ.Π.Α. 6%', ACNGRADE: '4', ACNMOVING: '1', VAT: '' },
  { ACNT: '8285', CODE: '54.00.29.0024', NAME: 'Φ.Π.Α. εισρ-δαπ εσωτερ.με Φ.Π.Α. 24%', ACNGRADE: '4', ACNMOVING: '1', VAT: '' },
  { ACNT: '6000', CODE: '15.01', NAME: 'Κτίρια υπό εκτέλεση', ACNGRADE: '2', ACNMOVING: '0', VAT: '' },
  { ACNT: '6001', CODE: '15.01.77', NAME: 'Επενδυτικά κτίρια υπό εκτέλεση', ACNGRADE: '3', ACNMOVING: '0', VAT: '' },
];

beforeEach(() => {
  vi.clearAllMocks();
  db.vatCategory.findMany.mockResolvedValue([
    { code: '1060', rate: 6, isActive: true }, { code: '1190', rate: 19, isActive: true }, { code: '1410', rate: 24, isActive: true },
  ]);
  softone.softoneGetTable.mockImplementation(async (_t: string, fields: string[], filter: string) => {
    let m: RegExpMatchArray | null;
    if ((m = filter.match(/^CODE='(.+)'$/))) return CHART.filter((r) => r.CODE === m![1]);
    if ((m = filter.match(/^CODE LIKE '(.+)\.%'$/))) return CHART.filter((r) => r.CODE.startsWith(`${m![1]}.`));
    if (filter.includes('ACNTVATID>0')) return [{ ACNTVATID: '3800', VAT: '1190' }, { ACNTVATID: '8285', VAT: '1410' }, { ACNTVATID: '8285', VAT: '1410' }];
    if ((m = filter.match(/^ACNT=(\d+)$/))) return CHART.filter((r) => r.ACNT === m![1]);
    void fields;
    return [];
  });
  softone.softoneCall.mockResolvedValue({
    success: true,
    data: {
      ACNTGL: [{ ACNSCHEMA: '1|Πρότυπο', ACNT: '8306', CODE: '62.00.00.0024', NAME: 'x', ACNTYPE: '60', SOCURRENCY: '100|EURO', VAT: '1410|ΦΠΑ 24%', ACNTVATID: '8285', INSDATE: '2021-05-23' }],
      SODOCTYPE: [{ SODTYPE: '89', ID: '8306', FISCPRD: '2026', SODOC01: '3617' }],
    },
  });
});

describe('planGlAccount', () => {
  it('ρεύμα 6%: πρότυπο ο αδελφός με ΦΠΑ, ΦΠΑ από τον χάρτη, λογαριασμός ΦΠΑ 6% — όχι του προτύπου', async () => {
    const p = await planGlAccount({ code: '62.00.00.0006', name: 'Ηλεκτρικό ρεύμα παραγωγής με Φ.Π.Α. 6%', vatRate: 6 });
    expect(p.template.code).toBe('62.00.00.0024');
    expect(p.vat).toEqual({ rate: 6, code: '1060' });
    expect(p.vatAccount?.code).toBe('54.00.29.0006');
    const row = p.payload.DATA.ACNTGL[0];
    expect(row).toMatchObject({ CODE: '62.00.00.0006', VAT: '1060', ACNTVATID: 3795, ACNSCHEMA: '1', SOCURRENCY: '100', ACNTYPE: '60' });
    expect(row).not.toHaveProperty('ACNT');
    expect(row).not.toHaveProperty('INSDATE');
    expect(p.payload.DATA.SODOCTYPE).toEqual([{ FISCPRD: '2026', SODOC01: '3617' }]);
  });

  it('υπάρχων λογαριασμός ή εκτός δομής → καμία αποστολή', async () => {
    await expect(planGlAccount({ code: '62.00.00.0024', name: 'x', vatRate: 24 })).rejects.toMatchObject({ code: 'exists' });
    await expect(planGlAccount({ code: '99.99.99.0024', name: 'x', vatRate: 24 })).rejects.toMatchObject({ code: 'no_parent' });
    await expect(planGlAccount({ code: '62.00', name: 'x', vatRate: 24 })).rejects.toMatchObject({ code: 'invalid_code' });
  });
});

describe('planGlAccount — ομάδα 3ης βαθμίδας', () => {
  it('15.01.00 κάτω από 15.01, πρότυπο η ομάδα 15.01.77, χωρίς ΦΠΑ', async () => {
    const p = await planGlAccount({ code: '15.01.00', name: 'Κτίρια υπό εκτέλεση', vatRate: null });
    expect(p.parent.code).toBe('15.01');
    expect(p.template.code).toBe('15.01.77');
    expect(p.vat).toBeNull();
  });
});
