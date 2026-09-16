// lib/ocr/__tests__/queues.test.ts
// Ουρές «Νέοι συναλλασσόμενοι» / «Είδη & έξοδα» (spec 2026-09-11 §2/§3) με mocked Prisma.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { db } = vi.hoisted(() => ({
  db: {
    ocrDocument: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn(), groupBy: vi.fn() },
    ocrInvoiceItem: { findMany: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    ignoredIssuer: { findMany: vi.fn() },
    softoneTrader: { findMany: vi.fn() },
    // Τα μητρώα σειρών: από εκεί βγαίνει ο ΑΠΑΙΤΟΥΜΕΝΟΣ τύπος καρτέλας κάθε παραστατικού
    // (`lib/ocr/required-trader-kind.ts`), ομαδικά.
    purchaseDocType: { findMany: vi.fn() },
    softoneDocSeries: { findMany: vi.fn() },
    softoneItem: { findMany: vi.fn(), findUnique: vi.fn() },
    softoneExpense: { findMany: vi.fn(), findUnique: vi.fn() },
    softoneLineItem: { findMany: vi.fn(), findUnique: vi.fn() },
    softoneCostCenter: { findMany: vi.fn(), findUnique: vi.fn() },
    softoneProject: { findMany: vi.fn(), findUnique: vi.fn() },
    softoneProjectStage: { findMany: vi.fn(), findUnique: vi.fn() },
    softoneMyDataClassType: { findMany: vi.fn() },
    softoneMyDataClassCategory: { findMany: vi.fn() },
    lineMatchRule: { findMany: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/softone', () => ({
  softoneFindTraderByAfm: vi.fn(),
  softoneCheckPurchaseDoc: vi.fn(),
  // Το `TRADER_KIND_LABEL` των ουρών παράγεται από αυτό το λεξικό — κρατάμε τις αληθινές τιμές.
  SODTYPE_LABEL: { 12: 'Προμηθευτής', 13: 'Πελάτης', 15: 'Χρεώστης', 16: 'Πιστωτής' } as Record<number, string>,
  TRADER_KIND_SODTYPE: { supplier: 12, creditor: 16, debtor: 15 },
}));

import { clearClassificationCache } from '../mydata-labels';
import {
  loadTraderQueue, applyTraderToDocs, loadItemQueue, suggestForGroup,
  applyMatchToGroup, skipGroup, countQueues, QueueError, TRADER_KIND_LABEL,
  loadTraderCodeSamples,
} from '../queues';

// Το `issuerAfm` είναι ΣΤΗΛΗ (γράφεται στην εξαγωγή): εδώ το παράγουμε από το ίδιο fixture
// ώστε τα δεδομένα να είναι συνεπή με ό,τι θα είχε γράψει η ροή upload/reextract.
const doc = (o: Partial<Record<string, unknown>> & { id: string }) => {
  const row = {
    fileName: `${o.id}.pdf`, thumbUrl: null, createdAt: new Date('2025-03-01T00:00:00Z'),
    extractedData: {}, softoneSeries: null, seriesSource: null, invoiceKind: null, ...o,
  } as Record<string, unknown>;
  if (!('issuerAfm' in row)) {
    const vat = String((row.extractedData as { vatNumber?: unknown } | null)?.vatNumber ?? '').replace(/\D+/g, '');
    row.issuerAfm = vat || null;
  }
  return row;
};

beforeEach(() => {
  vi.clearAllMocks();
  db.ocrDocument.findMany.mockResolvedValue([]);
  db.ocrDocument.updateMany.mockResolvedValue({ count: 0 });
  db.ocrDocument.update.mockResolvedValue({});
  db.ocrDocument.groupBy.mockResolvedValue([]);
  db.ocrInvoiceItem.findMany.mockResolvedValue([]);
  db.ocrInvoiceItem.updateMany.mockResolvedValue({ count: 0 });
  db.ocrInvoiceItem.count.mockResolvedValue(0);
  db.ignoredIssuer.findMany.mockResolvedValue([]);
  db.softoneTrader.findMany.mockResolvedValue([]);
  db.purchaseDocType.findMany.mockResolvedValue([]);
  db.softoneDocSeries.findMany.mockResolvedValue([]);
  db.softoneItem.findMany.mockResolvedValue([]);
  db.softoneItem.findUnique.mockResolvedValue(null);
  db.softoneExpense.findMany.mockResolvedValue([]);
  db.softoneExpense.findUnique.mockResolvedValue(null);
  db.softoneLineItem.findMany.mockResolvedValue([]);
  db.softoneLineItem.findUnique.mockResolvedValue(null);
  db.softoneCostCenter.findMany.mockResolvedValue([]);
  db.softoneProject.findMany.mockResolvedValue([]);
  db.softoneProjectStage.findMany.mockResolvedValue([]);
  db.softoneMyDataClassType.findMany.mockResolvedValue([]);
  db.softoneMyDataClassCategory.findMany.mockResolvedValue([]);
  clearClassificationCache();
  db.lineMatchRule.findMany.mockResolvedValue([]);
  db.lineMatchRule.upsert.mockResolvedValue({});
  db.ocrDocument.findUnique.mockResolvedValue(null);
  db.$transaction.mockResolvedValue([]);
});

describe('loadTraderQueue', () => {
  it('ομαδοποιεί κατά ΑΦΜ: συχνότερη επωνυμία, πρώτο μη κενό πεδίο, σύνολα, δείγμα εγγράφων', async () => {
    db.ocrDocument.findMany.mockResolvedValue([
      doc({
        id: 'd1', thumbUrl: 'https://cdn/d1.webp', createdAt: new Date('2025-03-12T00:00:00Z'),
        softoneSeries: '7001', seriesSource: 1251, invoiceKind: 'product',
        extractedData: {
          vatNumber: 'EL094073495', companyName: 'ΑΛΦΑ ΑΕ', companyDoy: null,
          companyAddress: 'ΑΘΗΝΩΝ 1', totalAmount: 100.5, date: '12/03/2025',
        },
      }),
      doc({
        id: 'd2', createdAt: new Date('2025-02-10T00:00:00Z'),
        extractedData: {
          vatNumber: '094073495', companyName: 'ΑΛΦΑ ΑΕ', companyDoy: 'ΦΑΕ ΑΘΗΝΩΝ',
          companyPhone: '2101234567', totalAmount: '50', date: '10/02/2025',
        },
      }),
      doc({ id: 'd3', extractedData: { vatNumber: '094073495', companyName: 'ΑΛΦΑ Α.Ε.' } }),
      // Χωρίς ΑΦΜ → δεν μπαίνει σε καμία ομάδα (το ερώτημα ήδη το αποκλείει, αλλά κρατάμε τη δικλείδα).
      doc({ id: 'd4', extractedData: { companyName: 'ΑΓΝΩΣΤΟΣ' } }),
    ]);

    const { groups, truncated } = await loadTraderQueue();

    // Το ΑΦΜ έρχεται από τη ΣΤΗΛΗ: το ερώτημα φιλτράρει `issuerAfm`, χωρίς σάρωση JSON.
    expect(db.ocrDocument.findMany.mock.calls[0][0].where).toMatchObject({
      status: 'COMPLETED', softoneTrdr: null, issuerAfm: { not: null },
    });
    expect(truncated).toBe(false);
    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g.afm).toBe('094073495');
    expect(g.name).toBe('ΑΛΦΑ ΑΕ');          // 2 εμφανίσεις vs 1
    expect(g.doy).toBe('ΦΑΕ ΑΘΗΝΩΝ');        // πρώτο μη κενό (d1 κενό)
    expect(g.address).toBe('ΑΘΗΝΩΝ 1');
    expect(g.phone).toBe('2101234567');
    expect(g.docCount).toBe(3);
    expect(g.total).toBe(150.5);
    expect(g.lastDate).toBe(new Date(Date.UTC(2025, 2, 12)).toISOString());
    expect(g.thumbUrl).toBe('https://cdn/d1.webp');
    expect(g.suggestedKind).toBe('supplier');
    expect(g.docs[0]).toEqual({ id: 'd1', fileName: 'd1.pdf', date: '12/03/2025', total: 100.5, series: '7001' });
  });

  it('σειρά πιστωτών (1653) → πρόταση «πιστωτής»', async () => {
    db.ocrDocument.findMany.mockResolvedValue([
      doc({ id: 'd1', seriesSource: 1653, extractedData: { vatNumber: '999888777', companyName: 'ΔΕΗ' } }),
    ]);
    const { groups } = await loadTraderQueue();
    expect(groups[0].suggestedKind).toBe('creditor');
  });

  it('σειρά χρεωστών (1553) → πρόταση «χρεώστης»· 1253 μένει πλευρά προμηθευτή', async () => {
    db.ocrDocument.findMany.mockResolvedValue([
      doc({ id: 'd1', seriesSource: 1553, extractedData: { vatNumber: '999888777', companyName: 'ΓΑΜΑ' } }),
    ]);
    expect((await loadTraderQueue()).groups[0].suggestedKind).toBe('debtor');

    db.ocrDocument.findMany.mockResolvedValue([
      doc({ id: 'd2', seriesSource: 1253, extractedData: { vatNumber: '999888777', companyName: 'ΓΑΜΑ' } }),
    ]);
    expect((await loadTraderQueue()).groups[0].suggestedKind).toBe('supplier');
  });

  /**
   * Η εκκρεμότητα είναι ΑΝΑ ΤΥΠΟ: ο ίδιος εκδότης είναι συχνά και προμηθευτής και πιστωτής, με
   * ΞΕΧΩΡΙΣΤΗ καρτέλα για τον καθένα. Μία καρτέλα δεν ξεμπλοκάρει την άλλη.
   */
  describe('εκκρεμότητα ανά απαιτούμενο τύπο', () => {
    const creditorSeries = () => db.softoneDocSeries.findMany.mockResolvedValue([
      { sosource: 1653, code: 'ΤΙΜΔ', name: 'Τιμολόγιο Δαπανών', section: null, postObject: null, postLines: null },
    ]);
    const linkedOnCreditorSeries = () => db.ocrDocument.findMany.mockResolvedValue([
      doc({
        id: 'd1', softoneTrdr: 5001, softoneSeries: 'ΤΙΜΔ', seriesSource: 1653,
        extractedData: { vatNumber: '094073495', companyName: 'ΑΛΦΑ ΑΕ' },
      }),
    ]);

    it('καρτέλα προμηθευτή + σειρά πιστωτών ⇒ εκκρεμής ΜΟΝΟ για πιστωτή, με τον λόγο', async () => {
      creditorSeries();
      linkedOnCreditorSeries();
      db.softoneTrader.findMany.mockResolvedValue([
        { trdr: 5001, code: 'Π.0001', name: 'ΑΛΦΑ ΑΕ', afm: '094073495', sodtype: 12 },
      ]);

      const { groups } = await loadTraderQueue();

      expect(groups).toHaveLength(1);
      const g = groups[0];
      expect(g.missing).toHaveLength(1);
      expect(g.missing[0]).toMatchObject({ kind: 'creditor', sodtype: 16, docCount: 1, series: ['ΤΙΜΔ'] });
      expect(g.missing[0].reason).toBe('Χρειάζεται καρτέλα πιστωτή για τη σειρά ΤΙΜΔ');
      // Η πρόταση της φόρμας ακολουθεί την ΑΠΟΔΕΙΞΗ, όχι την ευρετική.
      expect(g.suggestedKind).toBe('creditor');
      // …και η υπάρχουσα καρτέλα φαίνεται, ώστε ο χρήστης να ξέρει τι υπάρχει ήδη.
      expect(g.cards).toEqual([
        { trdr: 5001, code: 'Π.0001', name: 'ΑΛΦΑ ΑΕ', sodtype: 12, label: 'Προμηθευτής', kind: 'supplier' },
      ]);
    });

    it('μόλις υπάρξει και η καρτέλα πιστωτή, ο εκδότης φεύγει από την ουρά', async () => {
      creditorSeries();
      linkedOnCreditorSeries();
      db.softoneTrader.findMany.mockResolvedValue([
        { trdr: 5001, code: 'Π.0001', name: 'ΑΛΦΑ ΑΕ', afm: '094073495', sodtype: 12 },
        { trdr: 7001, code: '53-00002', name: 'ΑΛΦΑ ΑΕ', afm: '094073495', sodtype: 16 },
      ]);

      expect((await loadTraderQueue()).groups).toEqual([]);
    });

    it('έγγραφο ΜΕ καρτέλα αλλά ΧΩΡΙΣ αναγνωρισμένη σειρά δεν γεννά φανταστική εκκρεμότητα', async () => {
      db.ocrDocument.findMany.mockResolvedValue([
        doc({ id: 'd1', softoneTrdr: 5001, extractedData: { vatNumber: '094073495' } }),
      ]);
      db.softoneTrader.findMany.mockResolvedValue([
        { trdr: 5001, code: 'Π.0001', name: 'ΑΛΦΑ ΑΕ', afm: '094073495', sodtype: 12 },
      ]);

      expect((await loadTraderQueue()).groups).toEqual([]);
    });

    it('έγγραφο ΧΩΡΙΣ καρτέλα και χωρίς σειρά μένει εκκρεμές, αλλά χωρίς απαιτούμενο τύπο', async () => {
      db.ocrDocument.findMany.mockResolvedValue([
        doc({ id: 'd1', extractedData: { vatNumber: '094073495', companyName: 'ΑΛΦΑ ΑΕ' } }),
      ]);

      const g = (await loadTraderQueue()).groups[0];
      expect(g.missing).toEqual([]);
      expect(g.unknownSeriesDocs).toBe(1);
    });
  });

  it('η ετικέτα κάθε τύπου βγαίνει από το ίδιο λεξικό SODTYPE με το lib/softone', () => {
    expect(TRADER_KIND_LABEL).toEqual({ supplier: 'Προμηθευτής', creditor: 'Πιστωτής', debtor: 'Χρεώστης' });
  });

  it('οι αγνοημένοι εκδότες βγαίνουν από την ουρά και επιστρέφονται μόνο όταν ζητηθούν', async () => {
    db.ocrDocument.findMany.mockResolvedValue([
      doc({ id: 'd1', extractedData: { vatNumber: '094073495', companyName: 'ΑΛΦΑ ΑΕ' } }),
      doc({ id: 'd2', extractedData: { vatNumber: '111222333', companyName: 'ΒΗΤΑ ΟΕ' } }),
    ]);
    db.ignoredIssuer.findMany.mockResolvedValue([{ afm: '111222333', reason: 'χειρόγραφο' }]);

    const plain = await loadTraderQueue();
    expect(plain.groups.map((g) => g.afm)).toEqual(['094073495']);
    expect(plain.ignored).toEqual([]);

    const withIgnored = await loadTraderQueue({ includeIgnored: true });
    expect(withIgnored.groups.map((g) => g.afm)).toEqual(['094073495']);
    expect(withIgnored.ignored).toEqual([{ afm: '111222333', name: 'ΒΗΤΑ ΟΕ', reason: 'χειρόγραφο' }]);
  });
});

describe('applyTraderToDocs', () => {
  it('άγνωστη σειρά ⇒ ένα updateMany με την καρτέλα του χρήστη, χωρίς ανάγνωση JSON', async () => {
    // Χωρίς σειρά δεν υπάρχει πληροφορία για τον τύπο: γράφεται ό,τι έδωσε ο χρήστης.
    db.ocrDocument.findMany.mockResolvedValue([
      { id: 'd1', seriesSource: null, softoneSeries: null },
      { id: 'd2', seriesSource: null, softoneSeries: null },
    ]);
    db.ocrDocument.updateMany.mockResolvedValue({ count: 2 });

    const n = await applyTraderToDocs(
      'EL 094073495',
      { trdr: 5001, code: 'Π.0001', name: 'ΑΛΦΑ ΑΕ', kind: 'Προμηθευτής', sodtype: 12 },
    );

    expect(n).toBe(2);
    expect(db.ocrDocument.findUnique).not.toHaveBeenCalled();
    // Τα εκκρεμή έγγραφα του ΑΦΜ διαβάζονται με το indexed `issuerAfm` και μόνο τα πεδία σειράς.
    expect(db.ocrDocument.findMany.mock.calls[0][0]).toMatchObject({
      where: { status: 'COMPLETED', softoneTrdr: null, issuerAfm: '094073495' },
      select: { id: true, seriesSource: true, softoneSeries: true },
    });
    const arg = db.ocrDocument.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: { in: ['d1', 'd2'] } });
    expect(arg.data).toMatchObject({ softoneTrdr: 5001, softoneCode: 'Π.0001', softoneName: 'ΑΛΦΑ ΑΕ', softoneKind: 'Προμηθευτής' });
  });

  it('σειρά πιστωτών + καρτέλα προμηθευτή ⇒ ΔΕΝ γράφεται τίποτα (μένει εκκρεμές για πιστωτή)', async () => {
    db.ocrDocument.findMany.mockResolvedValue([{ id: 'd1', seriesSource: 1653, softoneSeries: 'ΤΙΜΔ' }]);
    db.softoneDocSeries.findMany.mockResolvedValue([
      { sosource: 1653, code: 'ΤΙΜΔ', name: 'Τιμολόγιο Δαπανών', section: null, postObject: null, postLines: null },
    ]);
    // Στον καθρέφτη υπάρχει ΜΟΝΟ προμηθευτής (12)· το LINCREDOC θέλει 16.
    db.softoneTrader.findMany.mockResolvedValue([
      { trdr: 5001, code: 'Π.0001', name: 'ΑΛΦΑ ΑΕ', sodtype: 12, kind: 'Προμηθευτής' },
    ]);

    const n = await applyTraderToDocs(
      '094073495',
      { trdr: 5001, code: 'Π.0001', name: 'ΑΛΦΑ ΑΕ', kind: 'Προμηθευτής', sodtype: 12 },
    );

    expect(n).toBe(0);
    expect(db.ocrDocument.updateMany).not.toHaveBeenCalled();
  });

  it('η καρτέλα που ζητά η σειρά κερδίζει — ακόμη κι αν ο χρήστης έδωσε άλλη', async () => {
    db.ocrDocument.findMany.mockResolvedValue([{ id: 'd1', seriesSource: 1653, softoneSeries: 'ΤΙΜΔ' }]);
    db.softoneDocSeries.findMany.mockResolvedValue([
      { sosource: 1653, code: 'ΤΙΜΔ', name: 'Τιμολόγιο Δαπανών', section: null, postObject: null, postLines: null },
    ]);
    db.softoneTrader.findMany.mockResolvedValue([
      { trdr: 5001, code: 'Π.0001', name: 'ΑΛΦΑ ΑΕ', sodtype: 12, kind: 'Προμηθευτής' },
      { trdr: 7001, code: '53-00002', name: 'ΑΛΦΑ ΑΕ', sodtype: 16, kind: 'Πιστωτής' },
    ]);
    db.ocrDocument.updateMany.mockResolvedValue({ count: 1 });

    const n = await applyTraderToDocs(
      '094073495',
      { trdr: 5001, code: 'Π.0001', name: 'ΑΛΦΑ ΑΕ', kind: 'Προμηθευτής', sodtype: 12 },
    );

    expect(n).toBe(1);
    expect(db.ocrDocument.updateMany.mock.calls[0][0].data)
      .toMatchObject({ softoneTrdr: 7001, softoneCode: '53-00002', softoneKind: 'Πιστωτής' });
  });

  it('επιστρέφει 0 όταν το updateMany δεν άγγιξε τίποτα', async () => {
    db.ocrDocument.updateMany.mockResolvedValue({ count: 0 });
    expect(await applyTraderToDocs('094073495', { trdr: 1, code: null, name: 'X', kind: 'Πιστωτής' })).toBe(0);
  });

  it('χωρίς έγκυρο ΑΦΜ δεν γράφει τίποτα', async () => {
    expect(await applyTraderToDocs('  ', { trdr: 1, code: null, name: 'X', kind: 'Πιστωτής' })).toBe(0);
    expect(db.ocrDocument.updateMany).not.toHaveBeenCalled();
  });

  // Το ΑΦΜ με πρόθεμα χώρας γράφεται στο ΚΑΝΟΝΙΚΟ έγγραφο, όχι στα παράγωγα: αν γραφόταν κατευθείαν
  // στο `extractedData`/`issuerAfm`, η πρώτη αποθήκευση μετά θα τα ξανάφτιαχνε από το `document` και
  // το πρόθεμα θα εξαφανιζόταν — το έγγραφο θα ξαναέμπαινε στην ουρά με το γυμνό ΑΦΜ.
  describe('με πρόθεμα χώρας (opts.vatId)', () => {
    const LEGACY = { vatNumber: '144960040', companyName: 'MÜLLER GMBH', totalAmount: 124 };

    beforeEach(() => {
      db.ocrDocument.findMany.mockResolvedValue([{ id: 'd1' }]);
      db.ocrDocument.findUnique.mockResolvedValue({ document: null, extractedData: LEGACY, docType: 'INVOICE' });
      db.ocrInvoiceItem.findMany.mockResolvedValue([]);
    });

    it('το προθεματισμένο id φτάνει σε document.issuer.vat, extractedData.vatNumber και issuerAfm', async () => {
      const n = await applyTraderToDocs(
        '144960040',
        { trdr: 5001, code: 'Π.0009', name: 'MÜLLER GMBH', kind: 'Προμηθευτής' },
        { vatId: 'DE144960040' },
      );

      expect(n).toBe(1);
      expect(db.ocrDocument.updateMany).not.toHaveBeenCalled();
      const arg = db.ocrDocument.update.mock.calls.at(-1)?.[0];
      expect(arg.where).toEqual({ id: 'd1' });
      expect((arg.data.document as { issuer: { vat: string } }).issuer.vat).toBe('DE144960040');
      expect((arg.data.extractedData as { vatNumber: string }).vatNumber).toBe('DE144960040');
      expect(arg.data.issuerAfm).toBe('DE144960040');
      // …και ο συναλλασσόμενος ταξιδεύει στο ΙΔΙΟ update, δηλαδή στο ίδιο transaction.
      expect(arg.data).toMatchObject({ softoneTrdr: 5001, softoneCode: 'Π.0009', softoneName: 'MÜLLER GMBH' });
      expect(db.$transaction).toHaveBeenCalledTimes(1);
    });

    it('ίδιο ΑΦΜ μετά την κανονικοποίηση → απλό updateMany, χωρίς ανάγνωση εγγράφου', async () => {
      db.ocrDocument.updateMany.mockResolvedValue({ count: 3 });
      const n = await applyTraderToDocs(
        '144960040',
        { trdr: 5001, code: null, name: 'X', kind: 'Προμηθευτής' },
        { vatId: 'EL 144960040' },
      );
      expect(n).toBe(3);
      expect(db.ocrDocument.updateMany).toHaveBeenCalledTimes(1);
      expect(db.ocrDocument.findUnique).not.toHaveBeenCalled();
    });
  });
});

const LINES = [
  { id: 'l1', documentId: 'doc1', code: null, name: 'ΥΓΡΟ ΑΖΩΤΟ 9.560 KG', quantity: 9.56, price: 2, total: 19.12, softoneIsService: null },
  { id: 'l2', documentId: 'doc2', code: null, name: 'Υγρό Άζωτο 12.080 kg', quantity: 12.08, price: 2, total: 24.16, softoneIsService: null },
  { id: 'l3', documentId: 'doc1', code: null, name: 'ΜΙΣΘΩΜΑ ΦΙΑΛΩΝ', quantity: 1, price: 10, total: 10, softoneIsService: true },
];
const DOCS = [
  { id: 'doc1', fileName: 'a.pdf', issuerAfm: '094073495', extractedData: { companyName: 'ΑΛΦΑ ΑΕ' }, softoneName: null },
  { id: 'doc2', fileName: 'b.pdf', issuerAfm: '094073495', extractedData: {}, softoneName: 'ΑΛΦΑ ΑΕ' },
];

describe('loadItemQueue', () => {
  it('ομαδοποιεί τις εκκρεμείς γραμμές ανά (ΑΦΜ, κείμενο) με προμηθευτή, δείγμα και κατηγορία', async () => {
    db.ocrInvoiceItem.findMany.mockResolvedValue(LINES);
    db.ocrDocument.findMany.mockResolvedValue(DOCS);

    const { groups, total } = await loadItemQueue();

    expect(total).toBe(2);
    const [g1, g2] = groups;
    expect(g1.key).toBe('094073495|υγρο αζωτο kg');
    expect(g1.afm).toBe('094073495');
    expect(g1.supplier).toBe('ΑΛΦΑ ΑΕ');
    expect(g1.lineCount).toBe(2);
    expect(g1.docCount).toBe(2);
    // ΧΩΡΙΣ απόδειξη δεν δηλώνουμε τύπο: «Υγρό άζωτο» χωρίς σειρά, χωρίς μνήμη και χωρίς
    // ταιριασμένη υπηρεσία είναι ΑΤΑΞΙΝΟΜΗΤΗ — όχι σιωπηλά «Προϊόν».
    expect(g1.category).toBeNull();
    expect(g1.lines[0]).toEqual({
      id: 'l1', docId: 'doc1', fileName: 'a.pdf', name: 'ΥΓΡΟ ΑΖΩΤΟ 9.560 KG',
      quantity: 9.56, price: 2, total: 19.12,
    });
    // `softoneIsService` της γραμμής ΕΙΝΑΙ απόδειξη: εκεί δηλώνουμε «Υπηρεσία».
    expect(g2.pattern).toBe('μισθωμα φιαλων');
    expect(g2.category).toBe('service');
  });

  it('ζητά τις εκκρεμείς γραμμές (χωρίς MTRL/EXPN, χωρίς «skipped») και φράζει το πλήθος', async () => {
    await loadItemQueue();
    const arg = db.ocrInvoiceItem.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ softoneMtrl: null, softoneExpn: null });
    expect(arg.where.OR).toEqual([{ softoneMatchedBy: null }, { softoneMatchedBy: { not: 'skipped' } }]);
    expect(arg.take).toBe(2000);
  });

  it('υπολογίζει προτάσεις μόνο για τις πρώτες ομάδες (οι υπόλοιπες lazy)', async () => {
    db.ocrInvoiceItem.findMany.mockResolvedValue(LINES);
    db.ocrDocument.findMany.mockResolvedValue(DOCS);

    const { groups } = await loadItemQueue({ suggestFor: 1 });

    expect(db.softoneItem.findMany).toHaveBeenCalledTimes(1);
    expect(groups[1].suggestions).toEqual([]);
  });
});

describe('suggestForGroup', () => {
  it('ψάχνει με τα 2 μεγαλύτερα tokens (≥4) case-insensitive, με take 200', async () => {
    await suggestForGroup({ afm: '094073495', pattern: 'υγρο αζωτο σε φιαλη', code: '76-71106' });

    const items = db.softoneItem.findMany.mock.calls[0][0];
    expect(items.take).toBe(200);
    expect(items.where.isActive).toBe(true);
    expect(items.where.OR).toEqual([
      { code: { in: ['76-71106'] } },
      { code1: { in: ['76-71106'] } },
      { code2: { in: ['76-71106'] } },
      { name: { contains: 'αζωτο', mode: 'insensitive' } },
      { name: { contains: 'φιαλη', mode: 'insensitive' } },
    ]);
    const expenses = db.softoneExpense.findMany.mock.calls[0][0];
    expect(expenses.take).toBe(200);
    expect(expenses.where.OR).toEqual([
      { code: { in: ['76-71106'] } },
      { name: { contains: 'αζωτο', mode: 'insensitive' } },
      { name: { contains: 'φιαλη', mode: 'insensitive' } },
    ]);
    // Οι χρεοπιστώσεις είναι το τέταρτο μητρώο της ουράς, με το ίδιο φίλτρο.
    const lineItems = db.softoneLineItem.findMany.mock.calls[0][0];
    expect(lineItems.take).toBe(200);
    expect(lineItems.where.OR).toEqual([
      { code: { in: ['76-71106'] } },
      { name: { contains: 'αζωτο', mode: 'insensitive' } },
      { name: { contains: 'φιαλη', mode: 'insensitive' } },
    ]);
  });

  it('προτείνει και ΧΡΕΟΠΙΣΤΩΣΕΙΣ, με το MTRL τους στο `lin`', async () => {
    db.softoneLineItem.findMany.mockResolvedValue([
      { mtrl: 777, code: 'ΧΡ01', name: 'ΥΓΡΟ ΑΖΩΤΟ' },
    ]);
    const s = await suggestForGroup({ afm: '094073495', pattern: 'υγρο αζωτο' });
    expect(s[0]).toMatchObject({ lin: 777, mtrl: null, expn: null, kind: 'lineitem' });
  });

  it('κανόνας μνήμης σε χρεοπίστωση επιστρέφεται ως πρόταση «μνήμη»', async () => {
    db.lineMatchRule.findMany.mockResolvedValue([{ afm: '094073495', mtrl: null, expn: null, lin: 777, isService: false }]);
    db.softoneLineItem.findUnique.mockResolvedValue({ mtrl: 777, code: 'ΧΡ01', name: 'ΕΝΟΙΚΙΑ' });
    const s = await suggestForGroup({ afm: '094073495', pattern: 'ενοικια' });
    expect(s[0]).toMatchObject({ lin: 777, kind: 'lineitem', by: 'memory' });
  });

  it('βαθμολογεί κωδικό = 1 και ομοιότητα ονόματος, είδη + έξοδα μαζί', async () => {
    db.softoneItem.findMany.mockResolvedValue([
      { mtrl: 77, code: '76-71106', code1: null, code2: null, name: 'ΥΓΡΟ ΑΖΩΤΟ ΒΙΟΜΗΧΑΝΙΚΟ', isService: false },
    ]);
    db.softoneExpense.findMany.mockResolvedValue([
      { expn: 12, code: 'ΕΞ12', name: 'ΥΓΡΟ ΑΖΩΤΟ' },
    ]);

    const s = await suggestForGroup({ afm: '094073495', pattern: 'υγρο αζωτο', code: '76-71106' });

    expect(s[0]).toMatchObject({ mtrl: 77, expn: null, kind: 'product', score: 1, by: 'code' });
    expect(s[1]).toMatchObject({ expn: 12, mtrl: null, kind: 'expense', by: 'name' });
    expect(s[1].score).toBe(1);
  });

  it('ο κανόνας μνήμης του εκδότη μπαίνει πρώτος και δεν διπλασιάζεται', async () => {
    db.softoneItem.findMany.mockResolvedValue([
      { mtrl: 77, code: '76-71106', code1: null, code2: null, name: 'ΥΓΡΟ ΑΖΩΤΟ', isService: false },
    ]);
    db.lineMatchRule.findMany.mockResolvedValue([
      { afm: '', mtrl: 99, expn: null, lin: null, isService: false },
      { afm: '094073495', mtrl: 77, expn: null, lin: null, isService: false },
    ]);
    db.softoneItem.findUnique.mockResolvedValue({ mtrl: 77, code: '76-71106', name: 'ΥΓΡΟ ΑΖΩΤΟ', isService: false });

    const s = await suggestForGroup({ afm: '094073495', pattern: 'υγρο αζωτο' });

    expect(db.softoneItem.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { mtrl: 77 } }));
    expect(s[0]).toMatchObject({ mtrl: 77, score: 0.95, by: 'memory' });
    expect(s.filter((x) => x.mtrl === 77)).toHaveLength(1);
  });
});

describe('applyMatchToGroup', () => {
  it('γράφει όλες τις γραμμές της ομάδας, τη μνήμη και ξαναϋπολογίζει τα σύνολα', async () => {
    db.ocrInvoiceItem.findMany.mockResolvedValue(LINES);
    db.ocrDocument.findMany.mockResolvedValue(DOCS);
    db.softoneItem.findUnique.mockResolvedValue({ mtrl: 77, code: '76-71106', name: 'ΥΓΡΟ ΑΖΩΤΟ', isService: false });

    const r = await applyMatchToGroup({
      afm: '094073495', pattern: 'υγρο αζωτο kg', target: { mtrl: 77 }, userId: 'u1',
    });

    expect(r).toMatchObject({ linesUpdated: 2, mtrl: 77, expn: null, code: '76-71106' });
    expect(r.docIds).toEqual(['doc1', 'doc2']);
    const upd = db.ocrInvoiceItem.updateMany.mock.calls[0][0];
    expect(upd.where).toEqual({ id: { in: ['l1', 'l2'] } });
    expect(upd.data).toEqual({
      softoneMtrl: 77, softoneExpn: null, softoneLinMtrl: null, softoneCode: '76-71106', softoneName: 'ΥΓΡΟ ΑΖΩΤΟ',
      softoneIsService: false, softoneMatchedBy: 'manual',
      softoneCostCntr: null, softonePrjc: null, softonePrjcStage: null,
    });
    expect(db.lineMatchRule.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { afm_pattern: { afm: '094073495', pattern: 'υγρο αζωτο kg' } },
      // Ο κανόνας ξαναχρησιμοποιήθηκε → +1 χρήση.
      update: { mtrl: 77, expn: null, lin: null, isService: false, costCntr: null, prjc: null, prjcStage: null, timesUsed: { increment: 1 } },
      create: { afm: '094073495', pattern: 'υγρο αζωτο kg', mtrl: 77, expn: null, lin: null, isService: false, costCntr: null, prjc: null, prjcStage: null, createdById: 'u1' },
    }));
    // refreshDocTallies: ένα update ανά παραστατικό που άγγιξε η ομάδα.
    expect(db.ocrDocument.update).toHaveBeenCalledTimes(2);
  });

  it('αντιστοιχίζει σε ΧΡΕΟΠΙΣΤΩΣΗ και τη γράφει σε δική της στήλη', async () => {
    db.ocrInvoiceItem.findMany.mockResolvedValue(LINES);
    db.ocrDocument.findMany.mockResolvedValue(DOCS);
    db.softoneLineItem.findUnique.mockResolvedValue({ mtrl: 777, code: 'ΧΡ01', name: 'ΕΝΟΙΚΙΑ' });

    const r = await applyMatchToGroup({ afm: '094073495', pattern: 'υγρο αζωτο kg', target: { lin: 777 } });

    expect(r).toMatchObject({ lin: 777, mtrl: null, expn: null, code: 'ΧΡ01' });
    const upd = db.ocrInvoiceItem.updateMany.mock.calls[0][0];
    expect(upd.data).toMatchObject({ softoneLinMtrl: 777, softoneMtrl: null, softoneExpn: null, softoneIsService: false });
    expect(db.lineMatchRule.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ lin: 777 }),
    }));
  });

  it('χρεοπίστωση εκτός μητρώου → 404, καμία εγγραφή', async () => {
    db.softoneLineItem.findUnique.mockResolvedValue(null);
    await expect(applyMatchToGroup({ afm: '', pattern: 'κατι', target: { lin: 999 } })).rejects.toMatchObject({ code: 'lineitem_not_found' });
    expect(db.ocrInvoiceItem.updateMany).not.toHaveBeenCalled();
  });

  it('αντιστοιχίζει σε έξοδο (EXPN) και γράφει γενικό κανόνα όταν λείπει ΑΦΜ', async () => {
    db.ocrInvoiceItem.findMany.mockResolvedValue([
      { ...LINES[2], documentId: 'doc3' },
    ]);
    db.ocrDocument.findMany.mockResolvedValue([
      { id: 'doc3', fileName: 'c.pdf', issuerAfm: null, extractedData: {}, softoneName: null },
    ]);
    db.softoneExpense.findUnique.mockResolvedValue({ expn: 12, code: 'ΕΞ12', name: 'ΜΙΣΘΩΜΑΤΑ' });

    const r = await applyMatchToGroup({ afm: '', pattern: 'μισθωμα φιαλων', target: { expn: 12 }, isService: true });

    expect(r.linesUpdated).toBe(1);
    expect(db.ocrInvoiceItem.updateMany.mock.calls[0][0].data).toMatchObject({
      softoneMtrl: null, softoneExpn: 12, softoneCode: 'ΕΞ12', softoneIsService: true, softoneMatchedBy: 'manual',
    });
    expect(db.lineMatchRule.upsert.mock.calls[0][0].where).toEqual({ afm_pattern: { afm: '', pattern: 'μισθωμα φιαλων' } });
  });

  it('άγνωστος στόχος → QueueError 404, καμία εγγραφή', async () => {
    db.softoneItem.findUnique.mockResolvedValue(null);
    await expect(applyMatchToGroup({ afm: '', pattern: 'x y', target: { mtrl: 1 } }))
      .rejects.toMatchObject({ code: 'item_not_found', status: 404 });
    expect(db.ocrInvoiceItem.updateMany).not.toHaveBeenCalled();
    expect(db.lineMatchRule.upsert).not.toHaveBeenCalled();
  });

  it('ομάδα χωρίς γραμμές: καμία εγγραφή, κανένας κανόνας μνήμης', async () => {
    db.ocrInvoiceItem.findMany.mockResolvedValue(LINES);
    db.ocrDocument.findMany.mockResolvedValue(DOCS);
    db.softoneItem.findUnique.mockResolvedValue({ mtrl: 77, code: '76-71106', name: 'ΥΓΡΟ ΑΖΩΤΟ', isService: false });

    const r = await applyMatchToGroup({ afm: '094073495', pattern: 'ομαδα φαντασμα', target: { mtrl: 77 } });

    expect(r.linesUpdated).toBe(0);
    expect(db.ocrInvoiceItem.updateMany).not.toHaveBeenCalled();
    expect(db.lineMatchRule.upsert).not.toHaveBeenCalled();
  });

  it('χωρίς στόχο → QueueError 400', async () => {
    await expect(applyMatchToGroup({ afm: '', pattern: 'x y', target: {} }))
      .rejects.toBeInstanceOf(QueueError);
  });
});

describe('skipGroup', () => {
  it('σημειώνει τις γραμμές της ομάδας ως «skipped» χωρίς κανόνα μνήμης', async () => {
    db.ocrInvoiceItem.findMany.mockResolvedValue(LINES);
    db.ocrDocument.findMany.mockResolvedValue(DOCS);

    const r = await skipGroup({ afm: '094073495', pattern: 'υγρο αζωτο kg' });

    expect(r.linesUpdated).toBe(2);
    expect(db.ocrInvoiceItem.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['l1', 'l2'] } },
      data: { softoneMatchedBy: 'skipped' },
    });
    expect(db.lineMatchRule.upsert).not.toHaveBeenCalled();
  });
});

describe('countQueues', () => {
  /** Το ερώτημα της ουράς εκδοτών ξεχωρίζει από αυτό της ομαδοποίησης γραμμών με το `select`. */
  const routeDocs = (traderDocs: unknown[]) =>
    db.ocrDocument.findMany.mockImplementation(async (args: { select?: Record<string, unknown> }) => (
      args?.select?.extractedData ? traderDocs : DOCS
    ));

  it('μετράει διακριτά ΑΦΜ (χωρίς τους αγνοημένους) με τον ΙΔΙΟ κανόνα με τη σελίδα', async () => {
    routeDocs([
      doc({ id: 'd1', extractedData: { vatNumber: '094073495' } }),
      doc({ id: 'd2', extractedData: { vatNumber: '111222333' } }),
      doc({ id: 'd3', extractedData: { vatNumber: '999888777' } }),
    ]);
    db.ignoredIssuer.findMany.mockResolvedValue([{ afm: '111222333' }]);
    // Ίδια ομαδοποίηση με τη σελίδα: 3 γραμμές → 2 ομάδες (το badge λέει «2», όχι «3»).
    db.ocrInvoiceItem.findMany.mockResolvedValue(LINES);

    expect(await countQueues()).toEqual({ traders: 2, items: 2 });
    expect(db.ocrInvoiceItem.count).not.toHaveBeenCalled();
  });

  it('έγγραφο ΜΕ καρτέλα σωστού τύπου δεν μετριέται — με λάθος τύπο, μετριέται', async () => {
    db.softoneDocSeries.findMany.mockResolvedValue([
      { sosource: 1653, code: 'ΤΙΜΔ', name: 'Τιμολόγιο Δαπανών', section: null, postObject: null, postLines: null },
    ]);
    routeDocs([
      doc({
        id: 'd1', softoneTrdr: 5001, softoneSeries: 'ΤΙΜΔ', seriesSource: 1653,
        extractedData: { vatNumber: '094073495' },
      }),
    ]);

    // Μόνο καρτέλα προμηθευτή: η σειρά πιστωτών μένει ακάλυπτη ⇒ εκκρεμής εκδότης.
    db.softoneTrader.findMany.mockResolvedValue([
      { trdr: 5001, code: 'Π.0001', name: 'ΑΛΦΑ ΑΕ', afm: '094073495', sodtype: 12 },
    ]);
    expect((await countQueues()).traders).toBe(1);

    // Μόλις υπάρξει και καρτέλα πιστωτή, ο εκδότης φεύγει από την ουρά.
    db.softoneTrader.findMany.mockResolvedValue([
      { trdr: 5001, code: 'Π.0001', name: 'ΑΛΦΑ ΑΕ', afm: '094073495', sodtype: 12 },
      { trdr: 7001, code: '53-00002', name: 'ΑΛΦΑ ΑΕ', afm: '094073495', sodtype: 16 },
    ]);
    expect((await countQueues()).traders).toBe(0);
  });

  it('καμία εκκρεμής γραμμή ⇒ 0 ομάδες χωρίς ερώτημα εγγράφων για τις γραμμές', async () => {
    db.ocrInvoiceItem.findMany.mockResolvedValue([]);

    expect(await countQueues()).toEqual({ traders: 0, items: 0 });
    // Η ομαδοποίηση γραμμών δεν ρώτησε έγγραφα (το ερώτημά της έχει `select: {id, issuerAfm}`).
    const itemQueries = db.ocrDocument.findMany.mock.calls
      .filter((c) => JSON.stringify(c[0]?.select) === JSON.stringify({ id: true, issuerAfm: true }));
    expect(itemQueries).toHaveLength(0);
  });
});

describe('loadTraderCodeSamples', () => {
  it('δείχνει ΥΠΑΡΧΟΝΤΕΣ κωδικούς ανά SODTYPE — δεν παράγει κανέναν', async () => {
    db.softoneTrader.findMany.mockImplementation(async ({ where }: { where: { sodtype: number } }) =>
      where.sodtype === 16 ? [{ code: '53.90.00.0000' }, { code: '53.90.00.0001' }] : [{ code: '0001' }]);

    const samples = await loadTraderCodeSamples();
    expect(samples.creditor).toEqual(['53.90.00.0000', '53.90.00.0001']);
    expect(samples.supplier).toEqual(['0001']);
    // Μόνο ανάγνωση: κανένα upsert, καμία «πρόταση» κωδικού.
    expect(db.softoneTrader.findMany).toHaveBeenCalledTimes(3);
    for (const call of db.softoneTrader.findMany.mock.calls) {
      expect(call[0]).toMatchObject({ select: { code: true }, distinct: ['code'] });
    }
  });

  it('χωρίς καθρέφτη επιστρέφει άδειες λίστες αντί να πέσει', async () => {
    db.softoneTrader.findMany.mockRejectedValue(new Error('db down'));
    await expect(loadTraderCodeSamples()).resolves.toEqual({ supplier: [], creditor: [], debtor: [] });
  });
});
