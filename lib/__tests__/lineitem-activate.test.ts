import { describe, expect, it, vi, beforeEach } from 'vitest';

const { softone, db } = vi.hoisted(() => ({
  softone: { softoneCall: vi.fn(), softoneBrowseAll: vi.fn() },
  db: { softoneLineItem: { upsert: vi.fn() } },
}));
vi.mock('@/lib/softone', () => softone);
vi.mock('@/lib/db', () => ({ prisma: db }));

import { activateLineItem, clearInactiveLineItemCache, fetchInactiveLineItems, findInactiveLineItems } from '../softone-sync/lineitem-activate';

const row = (over: Record<string, unknown> = {}) => ({
  CODE: '62.02.00.0024', NAME: 'Ύδρευση 24%', ACNMSK: '62.02.00.0024', VAT: '1410|ΦΠΑ 24%', SODTYPE: '53',
  ISACTIVE: '0', LISOURCETYPE: '12,13,14,15', MTRTYPE: '0', ...over,
});

beforeEach(() => { vi.clearAllMocks(); clearInactiveLineItemCache(); });

describe('fetchInactiveLineItems', () => {
  it('το MTRL από τη στήλη κλειδιού της λίστας και αν δέχεται πιστωτές', async () => {
    softone.softoneBrowseAll.mockResolvedValue([
      { 'FLD-1': 'LINEITEM;4011', CODE: '62.02.00.0024', NAME: 'Ύδρευση', ACNMSK: '62.02.00.0024', VAT: 'ΦΠΑ 24%', LISOURCETYPE: '12,13,14,15' },
      { 'FLD-1': 'LINEITEM;6237', CODE: '0003', NAME: 'Φιλοξενία', LISOURCETYPE: '12,16' },
    ]);
    const r = await fetchInactiveLineItems();
    expect(r.map((x) => [x.mtrl, x.acceptsCreditors])).toEqual([[6237, true], [4011, false]]);
  });
});

describe('activateLineItem', () => {
  it('στέλνει ΜΟΝΟ ISACTIVE + LISOURCETYPE με τους πιστωτές και γράφει τον καθρέφτη από την ανάγνωση', async () => {
    softone.softoneCall
      .mockResolvedValueOnce({ success: true, data: { LINEITEM: [row()] } })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true, data: { LINEITEM: [row({ ISACTIVE: '1', LISOURCETYPE: '12,13,14,15,16' })] } });
    const r = await activateLineItem(4011, { allowCreditors: true });
    expect(softone.softoneCall.mock.calls[1][1]).toEqual({ OBJECT: 'LINEITEM', KEY: '4011', DATA: { LINEITEM: [{ ISACTIVE: 1, LISOURCETYPE: '12,13,14,15,16' }] } });
    expect(r).toMatchObject({ creditorsAdded: true, lisourceType: '12,13,14,15,16' });
    expect(db.softoneLineItem.upsert.mock.calls[0][0].update).toMatchObject({ code: '62.02.00.0024', vat: '1410', isActive: true, acnmsk: '62.02.00.0024' });
  });

  it('αλλαγή σε άλλο πεδίο μετά την αποστολή → σταματά δυνατά', async () => {
    softone.softoneCall
      .mockResolvedValueOnce({ success: true, data: { LINEITEM: [row()] } })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true, data: { LINEITEM: [row({ ISACTIVE: '1', ACNMSK: '99' })] } });
    await expect(activateLineItem(4011, { allowCreditors: false })).rejects.toMatchObject({ code: 'unexpected_change' });
    expect(db.softoneLineItem.upsert).not.toHaveBeenCalled();
  });
});

describe('findInactiveLineItems', () => {
  beforeEach(() => {
    softone.softoneBrowseAll.mockResolvedValue([
      { K: 'LINEITEM;4011', CODE: '62.02.00.0024', NAME: 'Ύδρευση παραγωγικής διαδικασίας με Φ.Π.Α. 24%', ACNMSK: '62.02.00.0024' },
      { K: 'LINEITEM;4012', CODE: '62.03.00.0024', NAME: 'Τηλεφωνικά-τηλεγραφικά με Φ.Π.Α. 24%', ACNMSK: '62.03.00.0024' },
    ]);
  });

  it('ίδιος λογαριασμός, ίδιος κωδικός ή κείμενο χωρίς τόνους· τίποτα χωρίς κριτήριο', async () => {
    expect((await findInactiveLineItems({ account: '62.02.00.0024' })).map((i) => i.mtrl)).toEqual([4011]);
    expect((await findInactiveLineItems({ code: '62.03.00.0024' })).map((i) => i.mtrl)).toEqual([4012]);
    expect((await findInactiveLineItems({ q: 'τηλεφωνικα 24' })).map((i) => i.mtrl)).toEqual([4012]);
    expect(await findInactiveLineItems({ q: 'x' })).toEqual([]);
    // Μία κλήση στο SoftOne για όλα — η λίστα έρχεται από τη μνήμη.
    expect(softone.softoneBrowseAll).toHaveBeenCalledTimes(1);
  });

  it('χωρίς SoftOne: καμία πρόταση, κανένα σφάλμα', async () => {
    softone.softoneBrowseAll.mockRejectedValue(new Error('offline'));
    expect(await findInactiveLineItems({ account: '62.02.00.0024' })).toEqual([]);
  });
});
