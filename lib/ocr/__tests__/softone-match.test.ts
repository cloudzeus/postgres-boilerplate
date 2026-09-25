// lib/ocr/__tests__/softone-match.test.ts
// matchDocItems: πέρασμα κωδικού → πέρασμα μνήμης (LineMatchRule), με mocked Prisma.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { db } = vi.hoisted(() => ({
  db: {
    ocrInvoiceItem: { findMany: vi.fn(), update: vi.fn() },
    ocrDocument: { findUnique: vi.fn(), update: vi.fn() },
    softoneItem: { findMany: vi.fn() },
    softoneExpense: { findMany: vi.fn() },
    softoneTrader: { findUnique: vi.fn(), findFirst: vi.fn() },
    purchaseDocType: { findUnique: vi.fn(), findMany: vi.fn() },
    softoneDocSeries: { findUnique: vi.fn(), findMany: vi.fn() },
    lineMatchRule: { findMany: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('@/lib/db', () => ({ prisma: db }));

const { softone } = vi.hoisted(() => ({
  softone: { softoneCheckPurchaseDoc: vi.fn(), softoneFindTraderByAfm: vi.fn() },
}));

vi.mock('@/lib/softone', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  softoneCheckPurchaseDoc: softone.softoneCheckPurchaseDoc,
  softoneFindTraderByAfm: softone.softoneFindTraderByAfm,
}));

import { buildDuplicateCheck, matchDocItems, alignTraderToTarget } from '../softone-match';

const updateFor = (id: string) =>
  db.ocrInvoiceItem.update.mock.calls.map((c) => c[0]).find((a) => a.where.id === id)?.data;

beforeEach(() => {
  vi.clearAllMocks();
  db.ocrInvoiceItem.update.mockResolvedValue({});
  db.ocrDocument.update.mockResolvedValue({});
  // Ο ΑΦΜ εκδότη διαβάζεται από τη ΣΤΗΛΗ `issuerAfm` (κανονικοποιημένη, με πρόθεμα χώρας
  // όπου υπάρχει) — το ίδιο κλειδί που γράφει η μνήμη. Το JSON δεν το ξαναπαράγει.
  db.ocrDocument.findUnique.mockResolvedValue({ issuerAfm: '094073495' });
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
        softoneMtrl: 5, softoneExpn: null, softoneLinMtrl: null, softoneCode: '00022', softoneName: 'ΥΓΡΟ ΑΖΩΤΟ',
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
      softoneMtrl: null, softoneExpn: 103, softoneLinMtrl: null, softoneCode: '103', softoneName: 'Μεταφορικά Αγορών',
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
      softoneMtrl: null, softoneExpn: null, softoneLinMtrl: null, softoneCode: null, softoneName: null,
      softoneIsService: null, softoneMatchedBy: null,
    });
  });
});

describe('alignTraderToTarget — ο τύπος του συναλλασσομένου ακολουθεί τη σειρά', () => {
  /** Έγγραφο με ΑΦΜ, τρέχοντα συναλλασσόμενο και σειρά, όπως το διαβάζει η συνάρτηση. */
  const docRow = (over: Record<string, unknown> = {}) => ({
    issuerAfm: '094073495', softoneTrdr: 100, softoneSeries: '6645', seriesSource: 1553, ...over,
  });

  beforeEach(() => {
    // Ο απαιτούμενος τύπος βγαίνει πλέον από το κοινό `lib/ocr/required-trader-kind.ts`, που
    // διαβάζει τα μητρώα σειρών ΟΜΑΔΙΚΑ (`findMany`) — μία ανάγνωση για όσα έγγραφα κι αν είναι.
    db.softoneDocSeries.findMany.mockResolvedValue([
      { sosource: 1553, code: '6645', name: 'Τιμολόγιο Δαπανών', section: '6645', postObject: null, postLines: null },
    ]);
    db.purchaseDocType.findMany.mockResolvedValue([]);
  });

  it('σειρά 1553: ο προμηθευτής αντικαθίσταται από τον ΧΡΕΩΣΤΗ του ίδιου ΑΦΜ', async () => {
    db.ocrDocument.findUnique.mockResolvedValue(docRow());
    // Ο τρέχων είναι προμηθευτής (12) — το LINDEBDOC θέλει 15.
    db.softoneTrader.findUnique.mockResolvedValue({ sodtype: 12 });
    db.softoneTrader.findFirst.mockResolvedValue({ trdr: 200, code: 'Χ.0001', name: 'ΑΛΦΑ ΑΕ', sodtype: 15 });

    expect(await alignTraderToTarget('d1')).toBe(true);
    // Ψάχνει ΜΟΝΟ στον τοπικό καθρέφτη, με το ΑΦΜ και το SODTYPE που απαιτεί το object.
    expect(db.softoneTrader.findFirst.mock.calls[0][0].where)
      .toMatchObject({ afm: '094073495', sodtype: 15, isActive: true });
    expect(db.ocrDocument.update.mock.calls.at(-1)?.[0].data)
      .toMatchObject({ softoneTrdr: 200, softoneCode: 'Χ.0001', softoneKind: 'Χρεώστης' });
  });

  it('σωστός ήδη ο τύπος → καμία αλλαγή, καμία αναζήτηση', async () => {
    db.ocrDocument.findUnique.mockResolvedValue(docRow());
    db.softoneTrader.findUnique.mockResolvedValue({ sodtype: 15 });

    expect(await alignTraderToTarget('d1')).toBe(false);
    expect(db.softoneTrader.findFirst).not.toHaveBeenCalled();
    expect(db.ocrDocument.update).not.toHaveBeenCalled();
  });

  it('δεν υπάρχει χρεώστης με αυτό το ΑΦΜ → δεν αλλάζει τίποτα (το λέει το εμπόδιο)', async () => {
    db.ocrDocument.findUnique.mockResolvedValue(docRow());
    db.softoneTrader.findUnique.mockResolvedValue({ sodtype: 12 });
    db.softoneTrader.findFirst.mockResolvedValue(null);

    expect(await alignTraderToTarget('d1')).toBe(false);
    expect(db.ocrDocument.update).not.toHaveBeenCalled();
  });

  it('μη υποστηριζόμενη ενότητα → δεν μαντεύουμε τύπο', async () => {
    db.ocrDocument.findUnique.mockResolvedValue(docRow({ seriesSource: 1351 }));
    db.softoneTrader.findUnique.mockResolvedValue({ sodtype: 12 });

    expect(await alignTraderToTarget('d1')).toBe(false);
    expect(db.softoneTrader.findFirst).not.toHaveBeenCalled();
  });
});

// ── buildDuplicateCheck ─────────────────────────────────────────────────────
// Ο ΜΟΝΟΣ καλών του `softoneCheckPurchaseDoc`: αν ρωτήσει με λάθος αναφορά, ο έλεγχος
// διπλοεγγραφής κοιτάζει αλλού από εκεί που γράφει η καταχώριση — και δεν το πιάνει κανείς,
// γιατί παντού αλλού η συνάρτηση είναι mocked.
describe('buildDuplicateCheck', () => {
  beforeEach(() => {
    softone.softoneCheckPurchaseDoc.mockReset();
    softone.softoneCheckPurchaseDoc.mockResolvedValue({ exists: false, ref: null });
  });

  it('ρωτάει με ΤΗΝ ΙΔΙΑ αναφορά που θα καταχωριζόταν: αριθμός χωρίς πρόθεμα + πλήρης ταυτότητα', async () => {
    await buildDuplicateCheck(12345, { series: 'ΤΠΥ', number: '17' }, '2026-03-14');
    expect(softone.softoneCheckPurchaseDoc).toHaveBeenCalledWith(
      12345, { number: '17', fincode: 'ΤΠΥ 17' }, '2026-03-14',
    );
  });

  it('πρόθεμα ενσωματωμένο στον αριθμό: ρωτάει με το ΥΠΟΛΟΙΠΟ, όχι με ολόκληρο το string', async () => {
    await buildDuplicateCheck(12345, { series: 'ΤΙΜ Α32', number: 'ΤΙΜ Α32-000085237' }, null);
    expect(softone.softoneCheckPurchaseDoc).toHaveBeenCalledWith(
      12345, { number: '000085237', fincode: 'ΤΙΜ Α32-000085237' }, null,
    );
  });

  it('αριθμός που ΕΙΝΑΙ σκέτο το πρόθεμα: ο έλεγχος ΤΡΕΧΕΙ, δεν παρακάμπτεται σιωπηλά', async () => {
    // Το `stripSeriesPrefix` επιστρέφει κενό· αν το κρατούσαμε, το early return «χωρίς αριθμό»
    // θα ακύρωνε τον έλεγχο για κάθε τέτοιο παραστατικό (π.χ. «ΤΔΑ» των γραμμών 1009/1034).
    await buildDuplicateCheck(12345, { series: 'ΤΔΑ', number: 'ΤΔΑ' }, null);
    expect(softone.softoneCheckPurchaseDoc).toHaveBeenCalledWith(12345, { number: 'ΤΔΑ', fincode: 'ΤΔΑ' }, null);
  });

  it('το αποτέλεσμα γίνεται πεδία του εγγράφου', async () => {
    softone.softoneCheckPurchaseDoc.mockResolvedValue({ exists: true, ref: 'ΤΙΜ-AA-2455' });
    const r = await buildDuplicateCheck(12345, { series: null, number: '2455' }, '2026-03-14');
    expect(r.softoneDocExists).toBe(true);
    expect(r.softoneDocRef).toBe('ΤΙΜ-AA-2455');
    expect(r.softoneDocChecked).toBeInstanceOf(Date);
  });

  it('χωρίς συναλλασσόμενο ή χωρίς αριθμό δεν ρωτάει καθόλου — «δεν ξέρω», όχι «δεν υπάρχει»', async () => {
    expect(await buildDuplicateCheck(null, { series: 'ΤΠΥ', number: '17' }, null))
      .toMatchObject({ softoneDocExists: null, softoneDocRef: null });
    expect(await buildDuplicateCheck(12345, { series: null, number: null }, null))
      .toMatchObject({ softoneDocExists: null, softoneDocRef: null });
    expect(await buildDuplicateCheck(12345, null, null))
      .toMatchObject({ softoneDocExists: null, softoneDocRef: null });
    expect(softone.softoneCheckPurchaseDoc).not.toHaveBeenCalled();
  });

  it('σφάλμα SoftOne δεν σκάει τη σάρωση — «δεν ξέρω»', async () => {
    softone.softoneCheckPurchaseDoc.mockRejectedValue(new Error('boom'));
    expect(await buildDuplicateCheck(12345, { series: 'ΤΠΥ', number: '17' }, null))
      .toMatchObject({ softoneDocExists: null, softoneDocRef: null });
  });
});
