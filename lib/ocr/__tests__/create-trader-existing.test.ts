import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db, s1, q } = vi.hoisted(() => ({
  db: { softoneTrader: { findMany: vi.fn(), upsert: vi.fn() } },
  s1: { softoneCreateTrader: vi.fn(), softoneFetchCountries: vi.fn(), softoneGetTable: vi.fn(), matchCountryId: vi.fn(), TRADER_KIND_SODTYPE: { supplier: 12, creditor: 16, debtor: 15 } },
  q: { applyTraderToDocs: vi.fn(), TRADER_KIND_LABEL: { supplier: 'Προμηθευτής', creditor: 'Πιστωτής', debtor: 'Χρεώστης' } },
}));
vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/softone', () => s1);
vi.mock('@/lib/ocr/queues', () => q);
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));

import { createTraderInSoftone } from '../create-trader';

const input = {
  name: 'Α ΜΑΡΓΑΡΙΤΗΣ ΙΚΕ', afm: '999317206', code: null, irsData: null, profession: null, address: null,
  zip: null, city: null, phone: null, email: null, country: 'GR', latitude: null, longitude: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  s1.softoneFetchCountries.mockResolvedValue([]);
  s1.matchCountryId.mockReturnValue(1);
  s1.softoneGetTable.mockResolvedValue([]);
  db.softoneTrader.findMany.mockResolvedValue([]);
  db.softoneTrader.upsert.mockResolvedValue({});
  q.applyTraderToDocs.mockResolvedValue(1);
  s1.softoneCreateTrader.mockResolvedValue({ trdr: 2792, code: '958' });
});

describe('createTraderInSoftone — ποτέ δεύτερη καρτέλα για τον ίδιο ΑΦΜ', () => {
  it('υπάρχει στον καθρέφτη ⇒ ΔΕΝ δημιουργεί· συνδέει τα παραστατικά στην υπάρχουσα', async () => {
    db.softoneTrader.findMany.mockResolvedValue([{ trdr: 2789, code: '955', name: 'Α ΜΑΡΓΑΡΙΤΗΣ ΙΚΕ', afm: '999317206' }]);
    const r = await createTraderInSoftone({ afm: '999317206', kind: 'supplier', input, actor: null });
    expect(s1.softoneCreateTrader).not.toHaveBeenCalled();
    expect(r).toMatchObject({ trdr: 2789, code: '955', existing: true });
    expect(q.applyTraderToDocs).toHaveBeenCalledWith('999317206', expect.objectContaining({ trdr: 2789 }), expect.anything());
  });

  it('υπάρχει μόνο στο SoftOne (εκτός καθρέφτη) ⇒ επίσης σύνδεση', async () => {
    s1.softoneGetTable.mockResolvedValue([{ TRDR: '2789', CODE: '955', NAME: 'Α ΜΑΡΓΑΡΙΤΗΣ ΙΚΕ', AFM: '999317206', ISACTIVE: '1' }]);
    const r = await createTraderInSoftone({ afm: '999317206', kind: 'supplier', input, actor: null });
    expect(s1.softoneCreateTrader).not.toHaveBeenCalled();
    expect(r.existing).toBe(true);
  });

  it('δεν υπάρχει ⇒ δημιουργία', async () => {
    const r = await createTraderInSoftone({ afm: '999317206', kind: 'supplier', input, actor: null });
    expect(s1.softoneCreateTrader).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ trdr: 2792 });
    expect(r.existing).toBeUndefined();
  });
});
