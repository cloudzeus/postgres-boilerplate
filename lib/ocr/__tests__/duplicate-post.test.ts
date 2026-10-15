import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db, s1 } = vi.hoisted(() => ({
  db: { ocrDocument: { findMany: vi.fn() }, softoneTrader: { findMany: vi.fn() } },
  s1: { softoneCheckPurchaseDoc: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/softone', () => s1);

import { findDuplicatePosting, sameInvoice } from '../duplicate-post';

const MARG = '999317206';
beforeEach(() => {
  vi.clearAllMocks();
  db.ocrDocument.findMany.mockResolvedValue([]);
  db.softoneTrader.findMany.mockResolvedValue([]);
  s1.softoneCheckPurchaseDoc.mockResolvedValue({ exists: false, ref: null });
});

describe('sameInvoice', () => {
  it('ίδιος ΑΦΜ (με/χωρίς EL) + ίδιος αριθμός', () => {
    expect(sameInvoice({ afm: `EL${MARG}`, number: '126738' }, { afm: MARG, number: '126 738' })).toBe(true);
    expect(sameInvoice({ afm: MARG, number: '126738' }, { afm: '094019245', number: '126738' })).toBe(false);
    expect(sameInvoice({ afm: MARG, number: '' }, { afm: MARG, number: '' })).toBe(false);
  });
});

describe('findDuplicatePosting', () => {
  const input = { id: 'new', afm: MARG, type: { series: null, number: '126738' }, date: '2026-09-14' };

  it('ήδη καταχωρισμένο ΣΤΗΝ ΕΦΑΡΜΟΓΗ από άλλο αρχείο (το παλιό IMG_0003)', async () => {
    db.ocrDocument.findMany.mockResolvedValue([{ fileName: 'IMG_0003.pdf', postedRef: '115577', extractedData: { invoiceNumber: '126738' }, document: null }]);
    await expect(findDuplicatePosting(input)).resolves.toEqual({ where: 'app', ref: '115577', fileName: 'IMG_0003.pdf' });
    expect(s1.softoneCheckPurchaseDoc).not.toHaveBeenCalled();
  });

  it('στο SoftOne, σε ΑΛΛΗ καρτέλα του ίδιου ΑΦΜ (955 ενώ το έγγραφο δείχνει 958)', async () => {
    db.softoneTrader.findMany.mockResolvedValue([{ trdr: 2789, afm: MARG }, { trdr: 2792, afm: MARG }]);
    s1.softoneCheckPurchaseDoc.mockImplementation(async (trdr: number) => (trdr === 2789 ? { exists: true, ref: '115577' } : { exists: false, ref: null }));
    await expect(findDuplicatePosting(input)).resolves.toEqual({ where: 'softone', ref: '115577' });
  });

  it('νέο τιμολόγιο ⇒ null', async () => {
    db.softoneTrader.findMany.mockResolvedValue([{ trdr: 2789, afm: MARG }]);
    await expect(findDuplicatePosting(input)).resolves.toBeNull();
  });
});
