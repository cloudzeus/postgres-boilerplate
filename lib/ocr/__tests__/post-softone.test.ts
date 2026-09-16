// lib/ocr/__tests__/post-softone.test.ts
// Η καταχώριση στο SoftOne: dry-run χωρίς ΚΑΜΙΑ κλήση, διακόπτης ρυθμίσεων, read-back μετά το setData.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emptyDocument, type DocumentJson } from '../canonical';

const { db, softone, settings, documentMod } = vi.hoisted(() => ({
  db: {
    ocrDocument: { findUnique: vi.fn(), update: vi.fn() },
    ocrInvoiceItem: { findMany: vi.fn() },
    vatCategory: { findMany: vi.fn() },
    purchaseDocType: { findUnique: vi.fn() },
    softoneDocSeries: { findUnique: vi.fn() },
    softoneItem: { findMany: vi.fn() },
    softoneTrader: { findUnique: vi.fn() },
    softoneLineItem: { findMany: vi.fn() },
    softoneExpense: { findMany: vi.fn() },
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
  // Σειρά αγοράς εμπορευμάτων → PURDOC με πίνακα ανά γραμμή (η προεπιλογή της ενότητας 1251).
  db.purchaseDocType.findUnique.mockResolvedValue({ name: 'Τιμολόγιο Αγοράς', section: 'Τιμολόγιο Αγοράς', postObject: null, postLines: null, enabled: true });
  // Ο συναλλασσόμενος του εγγράφου είναι ΠΡΟΜΗΘΕΥΤΗΣ (12) — ό,τι δέχεται το PURDOC.
  db.softoneTrader.findUnique.mockResolvedValue({ sodtype: 12 });
  db.softoneDocSeries.findUnique.mockResolvedValue(null);
  db.softoneItem.findMany.mockResolvedValue([{ mtrl: 555, myDataCode: 'category2_1' }]);
  db.softoneLineItem.findMany.mockResolvedValue([]);
  db.softoneExpense.findMany.mockResolvedValue([]);
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
    expect(preview.payload?.DATA.PURDOC?.[0]).toMatchObject({ SERIES: 7001, TRDR: 12345, FINCODE: '17', TRNDATE: '2026-03-14' });
    expect(preview.payload?.DATA.ITELINES).toEqual([
      { LINENUM: 9000001, MTRL: 555, QTY1: 2, PRICE: 50, DISC1PRC: 0, VAT: 1, COMMENTS: 'Είδος Α', MYDATACODE: 'category2_1' },
    ]);
    expect(preview.target).toMatchObject({ object: 'PURDOC', lines: 'AUTO', source: 'default' });
  });

  // Ο στόχος έρχεται από τη ΣΕΙΡΑ, όχι από το τι ταίριαξε η γραμμή: το ίδιο έγγραφο με σειρά
  // πιστωτών γίνεται «Ειδικές συναλλαγές» και ΔΕΝ πάει ποτέ σε παραστατικό αγορών.
  it('σειρά πιστωτών (1653) → LINCREDOC / LINLINES, με τη χρεοπίστωση στο MTRL', async () => {
    db.ocrDocument.findUnique.mockResolvedValue({ ...READY_DOC, softoneSeries: '1001', seriesSource: 1653 });
    db.softoneDocSeries.findUnique.mockResolvedValue({ name: 'Τιμολόγιο Δαπανών (Λήψη)', section: '1001', postObject: null, postLines: null, enabled: true });
    db.softoneTrader.findUnique.mockResolvedValue({ sodtype: 16 });
    db.ocrInvoiceItem.findMany.mockResolvedValue([
      { rowIndex: 0, softoneMtrl: null, softoneExpn: null, softoneLinMtrl: 777, softoneIsService: null },
    ]);
    db.softoneItem.findMany.mockResolvedValue([]);
    db.softoneLineItem.findMany.mockResolvedValue([
      { mtrl: 777, mtrType: 1, classType: 5, classCategory: 2, myDataCode: 'category2_5' },
    ]);

    const preview = await postingPreview('d1');

    expect(preview.blockers).toEqual([]);
    expect(preview.target).toMatchObject({ object: 'LINCREDOC', lines: 'LINLINES' });
    expect(preview.payload.OBJECT).toBe('LINCREDOC');
    expect(preview.payload.DATA.LINCREDOC?.[0]).toMatchObject({ SERIES: 1001, TRDR: 12345 });
    expect(preview.payload.DATA.LINLINES).toEqual([
      { LINENUM: 9000001, MTRL: 777, MTRTYPE: 1, QTY1: 2, PRICE: 50, DISC1PRC: 0, NETLINEVAL: 100, VAT: 1, COMMENTS: 'Είδος Α' },
    ]);
    // Το LINLINES δεν έχει πεδίο χαρακτηρισμού — δεν στέλνουμε MYDATACODE εκεί.
    expect(preview.payload.DATA.LINLINES?.[0]).not.toHaveProperty('MYDATACODE');
    expect(preview.warnings.map((w) => w.code)).toContain('mydata_from_master');
  });

  it('γραμμή σε έξοδο ενώ η σειρά στέλνει LINLINES → εμπόδιο, όχι σιωπηλή απώλεια', async () => {
    db.ocrDocument.findUnique.mockResolvedValue({ ...READY_DOC, softoneSeries: '1001', seriesSource: 1653 });
    db.softoneDocSeries.findUnique.mockResolvedValue({ name: 'Τιμολόγιο Δαπανών (Λήψη)', section: '1001', postObject: null, postLines: null, enabled: true });
    db.softoneTrader.findUnique.mockResolvedValue({ sodtype: 16 });
    db.ocrInvoiceItem.findMany.mockResolvedValue([
      { rowIndex: 0, softoneMtrl: null, softoneExpn: 91, softoneLinMtrl: null, softoneIsService: null },
    ]);
    db.softoneItem.findMany.mockResolvedValue([]);
    db.softoneExpense.findMany.mockResolvedValue([{ expn: 91, classTypeX: null, classCategoryX: null }]);

    const preview = await postingPreview('d1');
    expect(preview.blockers.map((b) => b.code)).toContain('lines_need_lineitem');
    expect(preview.blockers.find((b) => b.code === 'lines_need_lineitem')?.message).toMatch(/ΧΡΕΟΠΙΣΤΩΣΕΙΣ/);
    // Καμία γραμμή δεν χώρεσε: το payload το λέει καθαρά αντί να «καθαρίσει» το πρόβλημα.
    expect(preview.payload.DATA.LINLINES).toBeUndefined();
  });

  it('ρητή ρύθμιση πίνακα γραμμών νικά την προεπιλογή της ενότητας', async () => {
    db.purchaseDocType.findUnique.mockResolvedValue({ name: 'Τιμολόγιο Αγοράς', section: '', postObject: null, postLines: 'ITELINES', enabled: true });

    const preview = await postingPreview('d1');
    expect(preview.target).toMatchObject({ object: 'PURDOC', lines: 'ITELINES', source: 'configured' });
    expect(preview.payload.DATA.ITELINES).toHaveLength(1);
  });

  // Το SERIES μιας κεφαλίδας ανήκει σε ΜΙΑ ενότητα: μια ρύθμιση που δείχνει σε άλλο object θα
  // έστελνε αριθμό σειράς 1251 σε παραστατικό 1253. Αγνοείται σιωπηλά.
  it('ρύθμιση object εκτός ενότητας αγνοείται', async () => {
    db.purchaseDocType.findUnique.mockResolvedValue({ name: 'Τιμολόγιο Λήψης Υπηρεσιών', section: '', postObject: 'LINSUPDOC', postLines: 'LINLINES', enabled: true });

    const preview = await postingPreview('d1');
    expect(preview.target).toMatchObject({ object: 'PURDOC', lines: 'AUTO' });
    expect(preview.payload.OBJECT).toBe('PURDOC');
  });

  it('σειρά εκτός μητρώου → series_unknown και όχι σιωπηλή προεπιλογή', async () => {
    db.ocrDocument.findUnique.mockResolvedValue({ ...READY_DOC, softoneSeries: '10002', seriesSource: 1653 });
    db.softoneDocSeries.findUnique.mockResolvedValue(null);
    db.softoneTrader.findUnique.mockResolvedValue({ sodtype: 16 });

    const preview = await postingPreview('d1');
    expect(preview.blockers.map((b) => b.code)).toContain('series_unknown');
  });

  // Ο ίδιος εκδότης υπάρχει συχνά και ως προμηθευτής (12) και ως πιστωτής (16)· το read-back δεν
  // το πιάνει ποτέ, γιατί συγκρίνει με ό,τι στείλαμε.
  it('προμηθευτής (12) σε σειρά πιστωτών → trader_kind_mismatch', async () => {
    db.ocrDocument.findUnique.mockResolvedValue({ ...READY_DOC, softoneSeries: '1001', seriesSource: 1653 });
    db.softoneDocSeries.findUnique.mockResolvedValue({ name: 'Τιμολόγιο Δαπανών (Λήψη)', section: '1001', postObject: null, postLines: null, enabled: true });
    db.softoneTrader.findUnique.mockResolvedValue({ sodtype: 12 });
    db.ocrInvoiceItem.findMany.mockResolvedValue([
      { rowIndex: 0, softoneMtrl: null, softoneExpn: null, softoneLinMtrl: 777, softoneIsService: null },
    ]);
    db.softoneItem.findMany.mockResolvedValue([]);
    db.softoneLineItem.findMany.mockResolvedValue([{ mtrl: 777, mtrType: 0, classType: 1, classCategory: 1, myDataCode: 'x' }]);

    const preview = await postingPreview('d1');
    expect(preview.blockers.map((b) => b.code)).toContain('trader_kind_mismatch');
    expect(preview.blockers.find((b) => b.code === 'trader_kind_mismatch')?.message).toMatch(/συναλλασσόμεν/i);
  });

  it('εμπόδια σε ελληνικά, με payload για να φαίνεται τι ΘΑ έφευγε', async () => {
    db.ocrDocument.findUnique.mockResolvedValue({ ...READY_DOC, softoneTrdr: null, softoneSeries: null, seriesSource: null });
    const preview = await postingPreview('d1');
    // Χωρίς σειρά δεν υπάρχει και ενότητα, άρα ούτε υποστηριζόμενος προορισμός.
    expect(preview.blockers.map((b) => b.code)).toEqual(['no_trader', 'no_series', 'series_module_unsupported']);
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
  });

  // Ποιος «επιβεβαιώνει» ένα έγγραφο είναι η πιο ακριβή λεπτομέρεια αυτού του αρχείου: ένα
  // επιβεβαιωμένο έγγραφο γίνεται παράδειγμα αναφοράς για ΚΑΘΕ επόμενο του ίδιου εκδότη
  // (`lib/ocr/example-lookup.ts`). Λάθος σφραγίδα = λάθος που διδάσκει τον εαυτό του.
  it('ΑΥΤΟΜΑΤΗ ανάρτηση (εκτελεστής προτύπων) ΔΕΝ επιβεβαιώνει το έγγραφο', async () => {
    settings.getSetting.mockResolvedValue(true);
    softone.softoneCall.mockResolvedValue({ success: true, id: 90210 });
    softone.softoneGetData.mockResolvedValue({ PURDOC: [{ FINDOC: '90210', FINCODE: '17', TRDR: '12345' }] });

    await postDocumentToSoftone('d1');                       // όπως το καλεί το lib/templates/run.ts

    for (const call of db.ocrDocument.update.mock.calls) {
      expect(call[0].data).not.toHaveProperty('verifiedAt');
      expect(call[0].data).not.toHaveProperty('verifiedById');
    }
  });

  it('ΧΕΙΡΟΚΙΝΗΤΗ ανάρτηση επιβεβαιώνει, με τον χρήστη που την έκανε', async () => {
    settings.getSetting.mockResolvedValue(true);
    softone.softoneCall.mockResolvedValue({ success: true, id: 90210 });
    softone.softoneGetData.mockResolvedValue({ PURDOC: [{ FINDOC: '90210', FINCODE: '17', TRDR: '12345' }] });

    await postDocumentToSoftone('d1', { verified: true, verifiedById: 'u1' });

    const last = db.ocrDocument.update.mock.calls.at(-1)?.[0];
    expect(last.data.verifiedAt).toBeInstanceOf(Date);
    expect(last.data.verifiedById).toBe('u1');
  });

  it('μια ΑΠΟΤΥΧΗΜΕΝΗ χειροκίνητη ανάρτηση δεν επιβεβαιώνει τίποτα', async () => {
    settings.getSetting.mockResolvedValue(true);
    softone.softoneCall.mockResolvedValue({ success: false, error: 'κάτι έσπασε' });
    await expect(postDocumentToSoftone('d1', { verified: true, verifiedById: 'u1' })).rejects.toThrow();
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

  it('το read-back διαβάζει ΤΟ ΙΔΙΟ object που γράφτηκε', async () => {
    settings.getSetting.mockResolvedValue(true);
    db.ocrDocument.findUnique.mockResolvedValue({ ...READY_DOC, softoneSeries: '1001', seriesSource: 1653 });
    db.softoneDocSeries.findUnique.mockResolvedValue({ name: 'Τιμολόγιο Δαπανών (Λήψη)', section: '1001', postObject: null, postLines: null, enabled: true });
    db.softoneTrader.findUnique.mockResolvedValue({ sodtype: 16 });
    db.ocrInvoiceItem.findMany.mockResolvedValue([
      { rowIndex: 0, softoneMtrl: null, softoneExpn: null, softoneLinMtrl: 777, softoneIsService: null },
    ]);
    db.softoneItem.findMany.mockResolvedValue([]);
    db.softoneLineItem.findMany.mockResolvedValue([{ mtrl: 777, mtrType: 1, classType: 1, classCategory: 1, myDataCode: 'x' }]);
    softone.softoneCall.mockResolvedValue({ success: true, id: 4242 });
    softone.softoneGetData.mockResolvedValue({ LINCREDOC: [{ FINDOC: '4242', FINCODE: '17', TRDR: '12345' }] });

    await postDocumentToSoftone('d1');

    expect(softone.softoneCall).toHaveBeenCalledWith('setData', expect.objectContaining({ OBJECT: 'LINCREDOC' }));
    expect(softone.softoneGetData).toHaveBeenCalledWith('LINCREDOC', '4242');
  });

  it('ο τύπος του σφάλματος είναι PostError για τις προϋποθέσεις', async () => {
    db.ocrDocument.findUnique.mockResolvedValue({ ...READY_DOC, status: 'PENDING' });
    const err = await postDocumentToSoftone('d1').catch((e) => e);
    expect(err).toBeInstanceOf(PostError);
    expect(err.code).toBe('not_completed');
  });
});
