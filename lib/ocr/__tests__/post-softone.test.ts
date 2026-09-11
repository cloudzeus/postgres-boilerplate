// lib/ocr/__tests__/post-softone.test.ts
// Η καταχώριση στο SoftOne: dry-run χωρίς ΚΑΜΙΑ κλήση, διακόπτης ρυθμίσεων, read-back μετά το setData.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emptyDocument, type DocumentJson } from '../canonical';

const { db, softone, settings, documentMod } = vi.hoisted(() => ({
  db: {
    ocrDocument: { findUnique: vi.fn(), update: vi.fn() },
    ocrInvoiceItem: { findMany: vi.fn() },
    vatCategory: { findMany: vi.fn() },
    templateRun: { findFirst: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
  softone: { softoneCall: vi.fn(), softoneGetData: vi.fn() },
  settings: { getSetting: vi.fn() },
  documentMod: { loadDocumentJson: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/softone', () => softone);
vi.mock('@/lib/settings', () => settings);
vi.mock('@/lib/ocr/document', () => documentMod);

import { postDocumentToSoftone, postingPreview, PostError } from '../post-softone';

const document = (over: Partial<DocumentJson> = {}): DocumentJson => ({
  ...emptyDocument('invoice'),
  date: '2026-03-14',
  type: { label: 'ΤΙΜΟΛΟΓΙΟ', series: 'ΤΠΥ', number: '17', myDataType: null },
  totals: { net: 100, discount: null, vatAmount: 24, withholding: null, fees: null, total: 124, payable: 124 },
  lines: [
    { code: 'A1', name: 'Είδος Α', unit: null, quantity: 2, unitPrice: 50, discount: 0, net: 100, vatRate: 24, vatAmount: 24, total: 124, custom: {} },
  ],
  ...over,
});

const READY_DOC = {
  id: 'd1', status: 'COMPLETED', category: 'EXPENSE',
  softoneTrdr: 12345, softoneSeries: '7001', seriesSource: 1251,
  postStatus: 'NONE', postedRef: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  db.ocrDocument.findUnique.mockResolvedValue({ ...READY_DOC });
  db.ocrDocument.update.mockResolvedValue({});
  db.ocrInvoiceItem.findMany.mockResolvedValue([{ rowIndex: 0, softoneMtrl: 555, softoneExpn: null, softoneIsService: false }]);
  db.vatCategory.findMany.mockResolvedValue([{ code: '1', rate: 24 }, { code: '4', rate: 0 }]);
  documentMod.loadDocumentJson.mockResolvedValue(document());
  settings.getSetting.mockResolvedValue(false);
});

describe('postingPreview (dry-run)', () => {
  it('δεν αγγίζει ΠΟΤΕ το SoftOne ούτε το έγγραφο, και επιστρέφει το payload', async () => {
    const preview = await postingPreview('d1');
    expect(softone.softoneCall).not.toHaveBeenCalled();
    expect(softone.softoneGetData).not.toHaveBeenCalled();
    expect(db.ocrDocument.update).not.toHaveBeenCalled();
    expect(preview.blockers).toEqual([]);
    expect(preview.enabled).toBe(false);
    expect(preview.payload?.DATA.PURDOC[0]).toMatchObject({ SERIES: 7001, TRDR: 12345, FINCODE: '17', TRNDATE: '2026-03-14' });
    expect(preview.payload?.DATA.ITELINES).toEqual([
      { LINENUM: 9000001, MTRL: 555, QTY1: 2, PRICE: 50, DISC1PRC: 0, VAT: 1, COMMENTS: 'Είδος Α' },
    ]);
  });

  it('εμπόδια σε ελληνικά, με payload για να φαίνεται τι ΘΑ έφευγε', async () => {
    db.ocrDocument.findUnique.mockResolvedValue({ ...READY_DOC, softoneTrdr: null, softoneSeries: null, seriesSource: null });
    const preview = await postingPreview('d1');
    expect(preview.blockers.map((b) => b.code)).toEqual(['no_trader', 'no_series']);
    expect(preview.blockers[0].message).toMatch(/προμηθευτ/i);
    expect(softone.softoneCall).not.toHaveBeenCalled();
  });

  it('δείχνει την κατάσταση καταχώρισης, ώστε η κάρτα να κλειδώσει το κουμπί', async () => {
    db.ocrDocument.findUnique.mockResolvedValue({ ...READY_DOC, postStatus: 'POSTED', postedRef: '90210' });
    const preview = await postingPreview('d1');
    expect(preview.postStatus).toBe('POSTED');
    expect(preview.postedRef).toBe('90210');
    expect(softone.softoneCall).not.toHaveBeenCalled();
  });

  it('ζητά τις κατηγορίες ΦΠΑ ταξινομημένες, ώστε ίδιοι συντελεστές να λύνονται σταθερά', async () => {
    await postingPreview('d1');
    expect(db.vatCategory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ order: 'asc' }, { code: 'asc' }] }),
    );
  });

  it('άγνωστο έγγραφο → PostError not_found', async () => {
    db.ocrDocument.findUnique.mockResolvedValue(null);
    await expect(postingPreview('nope')).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('postDocumentToSoftone', () => {
  it('με κλειστό τον διακόπτη: καμία κλήση, καμία αλλαγή κατάστασης', async () => {
    settings.getSetting.mockResolvedValue(false);
    await expect(postDocumentToSoftone('d1')).rejects.toMatchObject({ code: 'posting_disabled' });
    expect(softone.softoneCall).not.toHaveBeenCalled();
    expect(db.ocrDocument.update).not.toHaveBeenCalled();
  });

  it('εμπόδιο → PostError πριν καν κοιτάξει τον διακόπτη', async () => {
    db.ocrDocument.findUnique.mockResolvedValue({ ...READY_DOC, category: null });
    await expect(postDocumentToSoftone('d1')).rejects.toMatchObject({ code: 'no_category' });
    expect(settings.getSetting).not.toHaveBeenCalled();
    expect(softone.softoneCall).not.toHaveBeenCalled();
  });

  it('ανοιχτός διακόπτης → setData, read-back και POSTED', async () => {
    settings.getSetting.mockResolvedValue(true);
    softone.softoneCall.mockResolvedValue({ success: true, id: 90210 });
    softone.softoneGetData.mockResolvedValue({ PURDOC: [{ FINDOC: '90210', FINCODE: '17', TRDR: '12345' }] });

    const res = await postDocumentToSoftone('d1');

    expect(softone.softoneCall).toHaveBeenCalledWith('setData', expect.objectContaining({ OBJECT: 'PURDOC', KEY: '' }));
    expect(softone.softoneGetData).toHaveBeenCalledWith('PURDOC', '90210');
    expect(res.ref).toBe('90210');
    const last = db.ocrDocument.update.mock.calls.at(-1)?.[0];
    expect(last.data).toMatchObject({ postStatus: 'POSTED', postedRef: '90210', postError: null });
    // Η καταχώριση είναι ανθρώπινη επιβεβαίωση: το έγγραφο μπορεί πλέον να γίνει παράδειγμα
    // αναφοράς για τον ίδιο εκδότη.
    expect(last.data.verifiedAt).toBeInstanceOf(Date);
  });

  it('μια ΑΠΟΤΥΧΗΜΕΝΗ καταχώριση δεν επιβεβαιώνει τίποτα', async () => {
    settings.getSetting.mockResolvedValue(true);
    softone.softoneCall.mockResolvedValue({ success: false, error: 'κάτι έσπασε' });
    await expect(postDocumentToSoftone('d1')).rejects.toThrow();
    for (const call of db.ocrDocument.update.mock.calls) {
      expect(call[0].data).not.toHaveProperty('verifiedAt');
    }
  });

  it('setData success αλλά read-back δεν ταιριάζει → FAILED, ΜΕ το postedRef φυλαγμένο', async () => {
    settings.getSetting.mockResolvedValue(true);
    softone.softoneCall.mockResolvedValue({ success: true, id: 90210 });
    softone.softoneGetData.mockResolvedValue({ PURDOC: [{ FINDOC: '90210', FINCODE: '999', TRDR: '777' }] });

    await expect(postDocumentToSoftone('d1')).rejects.toThrow(/δεν επιβεβαιώθηκε/);
    const last = db.ocrDocument.update.mock.calls.at(-1)?.[0];
    expect(last.data.postStatus).toBe('FAILED');
    expect(String(last.data.postError)).toMatch(/δεν επιβεβαιώθηκε/);
    // Το παραστατικό ΥΠΑΡΧΕΙ στο SoftOne: ο αριθμός του γράφτηκε ΠΡΙΝ την επαλήθευση, και η
    // αποτυχία της επαλήθευσης δεν τον σβήνει — αλλιώς κανείς δεν θα ήξερε τι να διορθώσει.
    const refWrite = db.ocrDocument.update.mock.calls.find((c) => c[0].data.postedRef === '90210');
    expect(refWrite).toBeTruthy();
    expect(last.data).not.toHaveProperty('postedRef');
  });

  it('ήδη καταχωρισμένο → PostError already_posted, ΚΑΜΙΑ κλήση και καμία εγγραφή', async () => {
    settings.getSetting.mockResolvedValue(true);
    db.ocrDocument.findUnique.mockResolvedValue({ ...READY_DOC, postStatus: 'POSTED', postedRef: '90210' });

    await expect(postDocumentToSoftone('d1')).rejects.toMatchObject({ code: 'already_posted' });
    await expect(postDocumentToSoftone('d1')).rejects.toThrow(/90210/);
    expect(softone.softoneCall).not.toHaveBeenCalled();
    expect(softone.softoneGetData).not.toHaveBeenCalled();
    expect(db.ocrDocument.update).not.toHaveBeenCalled();
  });

  it('ήδη καταχωρισμένο ΚΑΙ με εμπόδια → μιλάει για την καταχώριση, όχι για τα εμπόδια', async () => {
    db.ocrDocument.findUnique.mockResolvedValue({ ...READY_DOC, category: null, postStatus: 'POSTED', postedRef: '7' });
    await expect(postDocumentToSoftone('d1')).rejects.toMatchObject({ code: 'already_posted' });
  });

  it('setData αποτυγχάνει → FAILED και το σφάλμα ανεβαίνει', async () => {
    settings.getSetting.mockResolvedValue(true);
    softone.softoneCall.mockResolvedValue({ success: false, error: 'ΛΑΘΟΣ ΣΕΙΡΑ', errorcode: 0 });
    await expect(postDocumentToSoftone('d1')).rejects.toThrow(/ΛΑΘΟΣ ΣΕΙΡΑ/);
    expect(softone.softoneGetData).not.toHaveBeenCalled();
    const last = db.ocrDocument.update.mock.calls.at(-1)?.[0];
    expect(last.data.postStatus).toBe('FAILED');
  });

  it('ο τύπος του σφάλματος είναι PostError για τις προϋποθέσεις', async () => {
    db.ocrDocument.findUnique.mockResolvedValue({ ...READY_DOC, status: 'PENDING' });
    const err = await postDocumentToSoftone('d1').catch((e) => e);
    expect(err).toBeInstanceOf(PostError);
    expect(err.code).toBe('not_completed');
  });
});
