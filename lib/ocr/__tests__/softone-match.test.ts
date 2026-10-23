// lib/ocr/__tests__/softone-match.test.ts
// matchDocItems: πέρασμα κωδικού → πέρασμα μνήμης (LineMatchRule), με mocked Prisma.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { db } = vi.hoisted(() => ({
  db: {
    ocrInvoiceItem: { findMany: vi.fn(), update: vi.fn() },
    ocrDocument: { findUnique: vi.fn(), update: vi.fn() },
    softoneItem: { findMany: vi.fn() },
    softoneExpense: { findMany: vi.fn() },
    softoneLineItem: { findMany: vi.fn() },
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

import { buildDuplicateCheck, matchDocItems, alignTraderToTarget, refreshDocTallies } from '../softone-match';

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

  it('κανόνας σε «Έξοδο» (EXPN) ΔΕΝ εφαρμόζεται πια: η SoftOne απορρίπτει τη γραμμή EXPANAL από τη σύνδεση', async () => {
    db.ocrInvoiceItem.findMany.mockResolvedValue([
      { id: 'l1', code: null, name: 'Μεταφορές CONEX (7)', softoneMatchedBy: null },
    ]);
    db.lineMatchRule.findMany.mockResolvedValue([
      { id: 'r1', afm: '', pattern: 'μεταφορες conex', mtrl: null, expn: 103, isService: true },
    ]);
    db.softoneExpense.findMany.mockResolvedValueOnce([{ expn: 103, code: '103', name: 'Μεταφορικά Αγορών' }]);

    const r = await matchDocItems('doc1');

    expect(r).toEqual({ matched: 0, total: 1 });
    expect(updateFor('l1')).toMatchObject({ softoneExpn: null, softoneMatchedBy: null });
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

describe('refreshDocTallies — ο ΕΠΙΜΕΡΙΣΜΟΣ μετράει ως αντιστοίχιση', () => {
  const tallyOf = (docId: string) =>
    db.ocrDocument.update.mock.calls.map((c) => c[0]).find((a) => a.where.id === docId)?.data;

  it('γραμμή χωρίς mtrl/expn/lin αλλά ΜΕ επιμερισμό μετράει αντιστοιχισμένη', async () => {
    // Το πραγματικό σενάριο: ο χρήστης έσπασε τη γραμμή σε λογαριασμούς. Η καταχώριση δεν έχει
    // κανένα εμπόδιο — αλλά η λίστα έλεγε «1 χωρίς αντιστοίχιση · Λύσε» και του ζητούσε να
    // ξανακάνει δουλειά που είχε ήδη κάνει.
    db.ocrInvoiceItem.findMany.mockResolvedValue([
      { documentId: 'd1', softoneMtrl: null, softoneExpn: null, softoneLinMtrl: null, _count: { allocations: 2 } },
    ]);
    await refreshDocTallies(['d1']);
    expect(tallyOf('d1')).toMatchObject({ itemsTotal: 1, itemsMatched: 1 });
  });

  it('χωρίς επιμερισμό και χωρίς μητρώο παραμένει ΑΝΑΝΤΙΣΤΟΙΧΙΣΤΗ', async () => {
    db.ocrInvoiceItem.findMany.mockResolvedValue([
      { documentId: 'd1', softoneMtrl: null, softoneExpn: null, softoneLinMtrl: null, _count: { allocations: 0 } },
    ]);
    await refreshDocTallies(['d1']);
    expect(tallyOf('d1')).toMatchObject({ itemsTotal: 1, itemsMatched: 0 });
  });

  it('γραμμή ΧΩΡΙΣ το πεδίο `_count` δεν ρίχνει τον υπολογισμό', async () => {
    db.ocrInvoiceItem.findMany.mockResolvedValue([
      { documentId: 'd1', softoneMtrl: 555, softoneExpn: null, softoneLinMtrl: null },
    ]);
    await expect(refreshDocTallies(['d1'])).resolves.toBeUndefined();
    expect(tallyOf('d1')).toMatchObject({ itemsTotal: 1, itemsMatched: 1 });
  });
});

describe('matchDocItems — μνήμη είδους χρέωσης (λογαριασμοί κοινής ωφέλειας)', () => {
  const HERON_DOC = {
    issuerAfm: '099810593',
    document: { issuer: { name: 'ΗΡΩΝ ΕΝΕΡΓΕΙΑΚΗ Α.Ε', vat: '099810593' }, type: { label: 'ΕΚΚΑΘΑΡΙΣΤΙΚΟΣ' } },
  };

  it('νέο κείμενο του ίδιου είδους χρέωσης βρίσκει τον ΓΕΝΙΚΟ κανόνα του είδους', async () => {
    db.ocrDocument.findUnique.mockResolvedValue(HERON_DOC);
    db.ocrInvoiceItem.findMany.mockResolvedValue([
      { id: 'l1', code: null, name: 'Χρεώσεις Προμήθειας Ρεύματος', vatRate: 6, total: 57212.91, softoneMatchedBy: null },
      { id: 'l2', code: null, name: 'Τέλος υπέρ ΕΡΤ', vatRate: 0, total: 3.06, softoneMatchedBy: null },
    ]);
    db.lineMatchRule.findMany.mockResolvedValue([
      { id: 'r1', afm: '', pattern: '@utility:electricity:consumption', mtrl: null, expn: null, lin: 7400, isService: false, costCntr: 5, prjc: null, prjcStage: null },
    ]);
    db.softoneLineItem.findMany.mockResolvedValue([{ mtrl: 7400, code: '6408', name: 'Ηλεκτρικό ρεύμα' }]);

    const r = await matchDocItems('doc1');

    // Το ερώτημα ζητά ΚΑΙ τα κλειδιά είδους χρέωσης, όχι μόνο τα κείμενα.
    const asked = db.lineMatchRule.findMany.mock.calls[0][0].where.pattern.in as string[];
    expect(asked).toEqual(expect.arrayContaining(['@utility:electricity:consumption', '@utility:electricity:ert']));
    expect(r).toEqual({ matched: 1, total: 2 });
    expect(updateFor('l1')).toMatchObject({ softoneLinMtrl: 7400, softoneCode: '6408', softoneMatchedBy: 'memory', softoneCostCntr: 5 });
    expect(updateFor('l2')).toMatchObject({ softoneLinMtrl: null, softoneMatchedBy: null });
  });

  it('ο κανόνας ΚΕΙΜΕΝΟΥ του εκδότη υπερισχύει του κανόνα είδους χρέωσης', async () => {
    db.ocrDocument.findUnique.mockResolvedValue(HERON_DOC);
    db.ocrInvoiceItem.findMany.mockResolvedValue([
      { id: 'l1', code: null, name: 'Ρυθμιζόμενες Χρεώσεις', vatRate: 6, total: 10289.12, softoneMatchedBy: null },
    ]);
    db.lineMatchRule.findMany.mockResolvedValue([
      { id: 'r1', afm: '099810593', pattern: '@utility:electricity:consumption', mtrl: null, expn: null, lin: 7400, isService: false, costCntr: null, prjc: null, prjcStage: null },
      { id: 'r2', afm: '099810593', pattern: 'ρυθμιζομενες χρεωσεις', mtrl: null, expn: null, lin: 7401, isService: false, costCntr: null, prjc: null, prjcStage: null },
    ]);
    db.softoneLineItem.findMany.mockResolvedValue([]);

    await matchDocItems('doc1');
    expect(updateFor('l1')).toMatchObject({ softoneLinMtrl: 7401 });
  });

  it('ο κανόνας του ΦΠΑ της γραμμής κερδίζει την προεπιλογή του είδους (ύδρευση 13% / πάγιο 24%)', async () => {
    db.ocrDocument.findUnique.mockResolvedValue({ issuerAfm: '094079101', document: { issuer: { name: 'ΕΥΔΑΠ' } } });
    db.ocrInvoiceItem.findMany.mockResolvedValue([
      { id: 'l1', code: null, name: 'ΥΔΡΕΥΣΗ (198,00M3)', vatRate: 13, total: 600, softoneMatchedBy: null },
      { id: 'l2', code: null, name: 'ΠΑΓΙΟ ΤΕΛΟΣ ΤΡΙΜΗΝΟΥ', vatRate: 24, total: 5.5, softoneMatchedBy: null },
    ]);
    db.lineMatchRule.findMany.mockResolvedValue([
      { id: 'r1', afm: '', pattern: '@utility:water:consumption', mtrl: null, expn: null, lin: 8540, isService: false, costCntr: null, prjc: null, prjcStage: null },
      { id: 'r2', afm: '', pattern: '@utility:water:consumption@24', mtrl: null, expn: null, lin: 8542, isService: false, costCntr: null, prjc: null, prjcStage: null },
    ]);
    db.softoneLineItem.findMany.mockResolvedValue([]);
    await matchDocItems('doc1');
    expect(updateFor('l1')).toMatchObject({ softoneLinMtrl: 8540 });
    expect(updateFor('l2')).toMatchObject({ softoneLinMtrl: 8542 });
  });

  it('ναύλος άγνωστου μεταφορέα βρίσκει τον γενικό κανόνα της οικογένειας «ναύλοι»', async () => {
    db.ocrDocument.findUnique.mockResolvedValue({ issuerAfm: 'ATU19208701', document: { issuer: { name: 'LKW WALTER' } } });
    db.ocrInvoiceItem.findMany.mockResolvedValue([
      { id: 'l1', code: null, name: 'Freight', vatRate: 0, total: 3200, softoneMatchedBy: null },
      { id: 'l2', code: null, name: 'Reactor 16m3', vatRate: 0, total: 74000, softoneMatchedBy: null },
    ]);
    db.lineMatchRule.findMany.mockResolvedValue([
      { id: 'r1', afm: '', pattern: '@family:freight', mtrl: null, expn: null, lin: 8545, isService: false, costCntr: null, prjc: null, prjcStage: null },
    ]);
    const r = await matchDocItems('doc1');
    expect(r).toEqual({ matched: 1, total: 2 });
    expect(updateFor('l1')).toMatchObject({ softoneLinMtrl: 8545, softoneMatchedBy: 'memory' });
    expect(updateFor('l2')).toMatchObject({ softoneExpn: null, softoneMtrl: null });
  });

  it('συνηθισμένο τιμολόγιο: κανένα κλειδί είδους χρέωσης', async () => {
    db.ocrDocument.findUnique.mockResolvedValue({ issuerAfm: '094073495', document: { issuer: { name: 'SOL HELLAS' } } });
    db.ocrInvoiceItem.findMany.mockResolvedValue([
      { id: 'l1', code: null, name: 'Διοξείδιο του άνθρακα', vatRate: 24, total: 50, softoneMatchedBy: null },
    ]);
    await matchDocItems('doc1');
    const asked = db.lineMatchRule.findMany.mock.calls[0][0].where.pattern.in as string[];
    expect(asked.some((p) => p.startsWith('@utility:') || p.startsWith('@family:'))).toBe(false);
  });
});
