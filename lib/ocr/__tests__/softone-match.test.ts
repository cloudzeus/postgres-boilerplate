// lib/ocr/__tests__/softone-match.test.ts
// matchDocItems: πέρασμα κωδικού → πέρασμα μνήμης (LineMatchRule), με mocked Prisma.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { db } = vi.hoisted(() => ({
  db: {
    ocrInvoiceItem: { findMany: vi.fn(), update: vi.fn() },
    ocrDocument: { findUnique: vi.fn(), update: vi.fn() },
    softoneItem: { findMany: vi.fn() },
    softoneExpense: { findMany: vi.fn() },
    lineMatchRule: { findMany: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('@/lib/db', () => ({ prisma: db }));

import { matchDocItems } from '../softone-match';

const updateFor = (id: string) =>
  db.ocrInvoiceItem.update.mock.calls.map((c) => c[0]).find((a) => a.where.id === id)?.data;

beforeEach(() => {
  vi.clearAllMocks();
  db.ocrInvoiceItem.update.mockResolvedValue({});
  db.ocrDocument.update.mockResolvedValue({});
  db.ocrDocument.findUnique.mockResolvedValue({ extractedData: { vatNumber: '094073495' } });
  db.softoneItem.findMany.mockResolvedValue([]);
  db.softoneExpense.findMany.mockResolvedValue([]);
  db.lineMatchRule.findMany.mockResolvedValue([]);
  db.lineMatchRule.update.mockResolvedValue({});
});

describe('matchDocItems — code pass', () => {
  it('ο κωδικός προηγείται και η μνήμη δεν χρειάζεται καν ερώτημα', async () => {
    db.ocrInvoiceItem.findMany.mockResolvedValue([
      { id: 'l1', code: '4003773035114', name: 'ΞΗΡΟΣ ΠΑΓΟΣ', softoneMatchedBy: null },
    ]);
    db.softoneItem.findMany.mockResolvedValueOnce([
      { mtrl: 77, code: '76-71106', code1: '4003773035114', code2: null, name: 'Ξηρός πάγος', isService: false },
    ]);

    const r = await matchDocItems('doc1');

    expect(r).toEqual({ matched: 1, total: 1 });
    expect(updateFor('l1')).toMatchObject({ softoneMtrl: 77, softoneExpn: null, softoneMatchedBy: 'code1', softoneCode: '76-71106' });
    expect(db.lineMatchRule.findMany).not.toHaveBeenCalled();
    expect(db.ocrDocument.update).toHaveBeenCalledWith({ where: { id: 'doc1' }, data: { itemsTotal: 1, itemsMatched: 1 } });
  });

  it('διατηρεί τις χειροκίνητες αντιστοιχίσεις και τις παραλείψεις', async () => {
    db.ocrInvoiceItem.findMany.mockResolvedValue([
      { id: 'l1', code: null, name: 'ΥΓΡΟ ΑΖΩΤΟ', softoneMatchedBy: 'manual', softoneMtrl: 77, softoneExpn: null },
      { id: 'l2', code: null, name: 'ΚΑΤΙ ΑΛΛΟ', softoneMatchedBy: 'skipped', softoneMtrl: null, softoneExpn: null },
    ]);

    const r = await matchDocItems('doc1');

    expect(r).toEqual({ matched: 1, total: 2 });
    expect(db.ocrInvoiceItem.update).not.toHaveBeenCalled();
    expect(db.lineMatchRule.findMany).not.toHaveBeenCalled();
  });

  it('χειροκίνητη γραμμή σε ΕΞΟΔΟ μετράει αντιστοιχισμένη· καθαρισμένη χειροκίνητη ΟΧΙ', async () => {
    db.ocrInvoiceItem.findMany.mockResolvedValue([
      { id: 'l1', code: null, name: 'ΕΝΟΙΚΙΟ', softoneMatchedBy: 'manual', softoneMtrl: null, softoneExpn: 9 },
      // Ο χρήστης καθάρισε την αντιστοίχιση: το `manual` έμεινε αλλά δεν υπάρχει πια στόχος.
      { id: 'l2', code: null, name: 'ΑΚΥΡΩΜΕΝΗ', softoneMatchedBy: 'manual', softoneMtrl: null, softoneExpn: null },
    ]);

    const r = await matchDocItems('doc1');

    // Ίδιος κανόνας με το `refreshDocTallies`: αντιστοιχισμένη = έχει mtrl ή expn.
    expect(r).toEqual({ matched: 1, total: 2 });
    expect(db.ocrDocument.update).toHaveBeenCalledWith({ where: { id: 'doc1' }, data: { itemsTotal: 2, itemsMatched: 1 } });
  });
});

describe('matchDocItems — memory pass', () => {
  it('εφαρμόζει τον κανόνα του εκδότη (όχι τον γενικό) και αυξάνει το timesUsed', async () => {
    db.ocrInvoiceItem.findMany.mockResolvedValue([
      { id: 'l1', code: null, name: 'ΥΓΡΟ ΑΖΩΤΟ 9.560 KG', softoneMatchedBy: null },
      { id: 'l2', code: null, name: 'Υγρό Άζωτο 12.080 kg', softoneMatchedBy: null },
    ]);
    db.lineMatchRule.findMany.mockResolvedValue([
      { id: 'r-generic', afm: '', pattern: 'υγρο αζωτο kg', mtrl: 1, expn: null, isService: false },
      { id: 'r-issuer', afm: '094073495', pattern: 'υγρο αζωτο kg', mtrl: 5, expn: null, isService: false },
    ]);
    db.softoneItem.findMany.mockResolvedValueOnce([
      { mtrl: 5, code: '00022', name: 'ΥΓΡΟ ΑΖΩΤΟ', isService: false },
    ]);

    const r = await matchDocItems('doc1');

    expect(db.lineMatchRule.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { pattern: { in: ['υγρο αζωτο kg'] }, afm: { in: ['094073495', ''] } },
    }));
    expect(r).toEqual({ matched: 2, total: 2 });
    for (const id of ['l1', 'l2']) {
      expect(updateFor(id)).toMatchObject({
        softoneMtrl: 5, softoneExpn: null, softoneCode: '00022', softoneName: 'ΥΓΡΟ ΑΖΩΤΟ',
        softoneIsService: false, softoneMatchedBy: 'memory',
      });
    }
    expect(db.lineMatchRule.update).toHaveBeenCalledTimes(1);
    expect(db.lineMatchRule.update).toHaveBeenCalledWith({ where: { id: 'r-issuer' }, data: { timesUsed: { increment: 2 } } });
  });

  it('κανόνας εξόδου γεμίζει το softoneExpn και μετράει ως αντιστοιχισμένη γραμμή', async () => {
    db.ocrInvoiceItem.findMany.mockResolvedValue([
      { id: 'l1', code: null, name: 'Μεταφορές CONEX (7)', softoneMatchedBy: null },
    ]);
    db.lineMatchRule.findMany.mockResolvedValue([
      { id: 'r1', afm: '', pattern: 'μεταφορες conex', mtrl: null, expn: 103, isService: true },
    ]);
    db.softoneExpense.findMany.mockResolvedValueOnce([{ expn: 103, code: '103', name: 'Μεταφορικά Αγορών' }]);

    const r = await matchDocItems('doc1');

    expect(r).toEqual({ matched: 1, total: 1 });
    expect(updateFor('l1')).toMatchObject({
      softoneMtrl: null, softoneExpn: 103, softoneCode: '103', softoneName: 'Μεταφορικά Αγορών',
      softoneIsService: true, softoneMatchedBy: 'memory',
    });
    expect(db.ocrDocument.update).toHaveBeenCalledWith({ where: { id: 'doc1' }, data: { itemsTotal: 1, itemsMatched: 1 } });
  });

  it('χωρίς κανόνα η γραμμή καθαρίζει και μένει αταίριαστη', async () => {
    db.ocrInvoiceItem.findMany.mockResolvedValue([
      { id: 'l1', code: null, name: 'ΚΑΤΙ ΑΓΝΩΣΤΟ', softoneMatchedBy: 'code' },
    ]);

    const r = await matchDocItems('doc1');

    expect(r).toEqual({ matched: 0, total: 1 });
    expect(updateFor('l1')).toEqual({
      softoneMtrl: null, softoneExpn: null, softoneCode: null, softoneName: null,
      softoneIsService: null, softoneMatchedBy: null,
    });
  });
});
