// lib/ocr/__tests__/document.test.ts
// `lib/ocr/document.ts` — ο ΜΟΝΟΣ γραφέας του κανονικού εγγράφου και των παραγώγων του
// (`extractedData`, `issuerAfm`, γραμμές `OcrInvoiceItem`). Prisma mocked.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { db } = vi.hoisted(() => ({
  db: {
    ocrDocument: { findUnique: vi.fn(), update: vi.fn() },
    ocrInvoiceItem: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({ prisma: db }));

import { Prisma } from '@prisma/client';

import { carryForward, linesToRows, loadDocumentJson, mergeLegacyPatch, saveDocumentJson } from '../document';
import { emptyDocument, fromLegacy, normalizeDocument, reconcileDocument, setPath, type DocumentJson } from '../canonical';

const LEGACY = {
  companyName: 'ΚΑΠΑΛΙΝΕ ΑΕ',
  vatNumber: 'EL 999863881',
  invoiceNumber: '17',
  date: '2026-06-22',
  subtotal: 100,
  vatAmount: 24,
  totalAmount: 124,
};

const ITEMS = [
  { rowIndex: 0, code: 'A1', name: 'Είδος Α', quantity: 2, price: 25, discount: 0, vatRate: 24, total: 50 },
  { rowIndex: 1, code: 'B2', name: 'Είδος Β', quantity: 1, price: 50, discount: 0, vatRate: 24, total: 50 },
];

const docWith = (lines: unknown[]): DocumentJson =>
  fromLegacy(LEGACY, lines as unknown[], 'invoice');

beforeEach(() => {
  vi.clearAllMocks();
  db.ocrDocument.update.mockReturnValue({ __op: 'update' });
  db.ocrInvoiceItem.deleteMany.mockReturnValue({ __op: 'deleteMany' });
  db.ocrInvoiceItem.createMany.mockReturnValue({ __op: 'createMany' });
  db.ocrInvoiceItem.findMany.mockResolvedValue([]);
  db.$transaction.mockResolvedValue([]);
});

describe('loadDocumentJson', () => {
  it('returns the stored canonical document and does not touch the item rows', async () => {
    const stored = setPath(emptyDocument('invoice'), 'digital.mark', '4000141');
    db.ocrDocument.findUnique.mockResolvedValue({ document: stored, extractedData: LEGACY, docType: 'INVOICE' });
    const doc = await loadDocumentJson('d1');
    expect(doc.digital.mark).toBe('4000141');
    expect(db.ocrInvoiceItem.findMany).not.toHaveBeenCalled();
  });

  it('falls back to fromLegacy(extractedData, items) when `document` is null', async () => {
    db.ocrDocument.findUnique.mockResolvedValue({ document: null, extractedData: LEGACY, docType: 'INVOICE' });
    db.ocrInvoiceItem.findMany.mockResolvedValue(ITEMS);
    const doc = await loadDocumentJson('d1');
    expect(doc.issuer.name).toBe('ΚΑΠΑΛΙΝΕ ΑΕ');
    expect(doc.totals.total).toBe(124);
    expect(doc.lines).toHaveLength(2);
    expect(doc.lines[0]).toMatchObject({ code: 'A1', unitPrice: 25, net: 50 });
    expect(db.ocrInvoiceItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { documentId: 'd1' }, orderBy: { rowIndex: 'asc' } }),
    );
  });

  it('maps GENERAL_TEXT onto a general document', async () => {
    db.ocrDocument.findUnique.mockResolvedValue({
      document: null, extractedData: { title: 'Τ', fullText: 'Κ', summary: 'Π' }, docType: 'GENERAL_TEXT',
    });
    const doc = await loadDocumentJson('d1');
    expect(doc.kind).toBe('general');
    expect(doc.custom.title).toBe('Τ');
  });

  it('throws when the document does not exist', async () => {
    db.ocrDocument.findUnique.mockResolvedValue(null);
    await expect(loadDocumentJson('nope')).rejects.toThrow(/document not found/);
  });
});

describe('linesToRows', () => {
  it('maps unitPrice → price and net → total', () => {
    expect(linesToRows(docWith(ITEMS).lines)).toEqual([
      { rowIndex: 0, code: 'A1', name: 'Είδος Α', quantity: 2, price: 25, discount: 0, vatRate: 24, total: 50 },
      { rowIndex: 1, code: 'B2', name: 'Είδος Β', quantity: 1, price: 50, discount: 0, vatRate: 24, total: 50 },
    ]);
  });
});

describe('carryForward', () => {
  const rows = linesToRows(docWith(ITEMS).lines);
  const old = [
    { rowIndex: 0, code: 'A1', name: 'Είδος Α', softoneMtrl: 11, softoneExpn: null, softoneCode: 'K1', softoneName: 'ΕΙΔΟΣ', softoneIsService: false, softoneMatchedBy: 'manual' },
    { rowIndex: 1, code: 'B2', name: 'Είδος Β', softoneMtrl: null, softoneExpn: 77, softoneCode: null, softoneName: null, softoneIsService: null, softoneMatchedBy: 'memory' },
  ];

  it('carries the SoftOne match (item AND expense) when code+name are unchanged', () => {
    const carried = carryForward(rows, old);
    expect(carried[0]).toMatchObject({ softoneMtrl: 11, softoneCode: 'K1', softoneMatchedBy: 'manual' });
    expect(carried[1]).toMatchObject({ softoneExpn: 77, softoneMatchedBy: 'memory' });
  });

  it('follows a row that moved, by code', () => {
    const moved = [rows[1], { ...rows[0], rowIndex: 1 }].map((r, i) => ({ ...r, rowIndex: i }));
    const carried = carryForward(moved, old);
    expect(carried[0].softoneExpn).toBe(77);
    expect(carried[1].softoneMtrl).toBe(11);
  });

  it('drops the match when the line became a different article', () => {
    const changed = [{ ...rows[0], code: 'Z9', name: 'Άλλο' }];
    expect(carryForward(changed, old)[0]).toEqual({
      softoneMtrl: null, softoneExpn: null, softoneCode: null, softoneName: null,
      softoneIsService: null, softoneMatchedBy: null,
    });
  });

  it('drops the match when a code-less line changed description', () => {
    const carried = carryForward(
      [{ ...rows[0], code: null, name: 'Εντελώς άλλο' }],
      [{ ...old[0], code: null }],
    );
    expect(carried[0].softoneMtrl).toBeNull();
  });
});

describe('saveDocumentJson', () => {
  it('writes document, extractedData and issuerAfm in ONE transaction', async () => {
    const doc = docWith(ITEMS);
    await saveDocumentJson('d1', doc);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    const data = db.ocrDocument.update.mock.calls[0][0];
    expect(data.where).toEqual({ id: 'd1' });
    expect(data.data.document).toEqual(normalizeDocument(doc));
    expect(data.data.issuerAfm).toBe('999863881');                 // κανονικοποιημένο ΑΦΜ
    expect(data.data.extractedData).toMatchObject({
      companyName: 'ΚΑΠΑΛΙΝΕ ΑΕ', vatNumber: '999863881', invoiceNumber: '17', totalAmount: 124,
    });
    expect(db.ocrInvoiceItem.deleteMany).not.toHaveBeenCalled();
  });

  it('replaces the item rows, carrying the SoftOne match forward', async () => {
    db.ocrInvoiceItem.findMany.mockResolvedValue([
      { rowIndex: 0, code: 'A1', name: 'Είδος Α', softoneMtrl: 11, softoneExpn: null, softoneCode: 'K1', softoneName: 'ΕΙΔΟΣ', softoneIsService: false, softoneMatchedBy: 'manual' },
    ]);
    await saveDocumentJson('d1', docWith(ITEMS), { replaceItems: true });
    expect(db.ocrInvoiceItem.deleteMany).toHaveBeenCalledWith({ where: { documentId: 'd1' } });
    const created = db.ocrInvoiceItem.createMany.mock.calls[0][0].data;
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({ documentId: 'd1', rowIndex: 0, code: 'A1', price: 25, total: 50, softoneMtrl: 11 });
    expect(created[1]).toMatchObject({ documentId: 'd1', rowIndex: 1, code: 'B2', softoneMtrl: null });
    // Ένα transaction: το έγγραφο και οι γραμμές του δεν αποκλίνουν ποτέ.
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.$transaction.mock.calls[0][0]).toHaveLength(3);
  });

  it('does not create rows when the document has no lines but replaceItems is set', async () => {
    await saveDocumentJson('d1', docWith([]), { replaceItems: true });
    expect(db.ocrInvoiceItem.deleteMany).toHaveBeenCalled();
    expect(db.ocrInvoiceItem.createMany).not.toHaveBeenCalled();
  });

  it('clears issuerAfm when the document has no issuer ΑΦΜ', async () => {
    await saveDocumentJson('d1', emptyDocument('invoice'));
    expect(db.ocrDocument.update.mock.calls[0][0].data.issuerAfm).toBeNull();
  });
});

describe('mergeLegacyPatch', () => {
  const existing = (() => {
    let d = fromLegacy(LEGACY, ITEMS, 'invoice');
    d = setPath(d, 'digital.mark', '400014123456789');
    d = setPath(d, 'handwritten.glAccount', '64.00.03');
    d = setPath(d, 'payment.method', 'Επί πιστώσει');
    d = setPath(d, 'custom.keep_me', 'ναι');
    return d;
  })();

  it('overlays the legacy keys without wiping the canonical-only blocks', () => {
    const merged = mergeLegacyPatch(existing, { totalAmount: 200, companyName: 'ΝΕΑ ΕΠΩΝΥΜΙΑ' });
    expect(merged.totals.total).toBe(200);
    expect(merged.issuer.name).toBe('ΝΕΑ ΕΠΩΝΥΜΙΑ');
    expect(merged.digital.mark).toBe('400014123456789');
    expect(merged.handwritten.glAccount).toBe('64.00.03');
    expect(merged.payment.method).toBe('Επί πιστώσει');
    expect(merged.custom.keep_me).toBe('ναι');
    expect(merged.lines).toHaveLength(2);                          // χωρίς items[] οι γραμμές μένουν
  });

  it('coerces Greek-formatted numbers and normalizes the dates the legacy client sends', () => {
    const merged = mergeLegacyPatch(existing, { subtotal: '1.234,56', date: '30/06/2026' });
    expect(merged.totals.net).toBe(1234.56);
    expect(merged.date).toBe('2026-06-30');
  });

  it('rebuilds the lines only when items[] is part of the patch', () => {
    const merged = mergeLegacyPatch(existing, { items: [{ code: 'X', name: 'Νέο', quantity: 1, price: 10, total: 10, vatRate: 24 }] });
    expect(merged.lines).toHaveLength(1);
    expect(merged.lines[0]).toMatchObject({ code: 'X', unitPrice: 10, net: 10, vatAmount: 2.4 });
  });

  it('merges customFields into custom and bankAccounts into payment.ibans', () => {
    const merged = mergeLegacyPatch(existing, {
      customFields: { poso: '5' }, bankAccounts: [{ bank: 'Alpha', iban: 'GR7' }],
    });
    expect(merged.custom).toMatchObject({ keep_me: 'ναι', poso: '5' });
    expect(merged.payment.ibans).toEqual([{ bank: 'Alpha', iban: 'GR7' }]);
  });

  it('re-derives the kind when a recipient appears', () => {
    const receipt = fromLegacy({ companyName: 'Κ' }, [], 'receipt');
    expect(receipt.kind).toBe('receipt');
    expect(mergeLegacyPatch(receipt, { customerName: 'ΠΕΛΑΤΗΣ' }).kind).toBe('invoice');
  });

  it('keeps a general document general', () => {
    const general = fromLegacy({ title: 'Τ' }, [], 'general_text');
    expect(mergeLegacyPatch(general, { summary: 'Νέα περίληψη' }).kind).toBe('general');
  });

  it('the docType of the SAME patch decides the kind, in both directions', () => {
    // Ο χρήστης αλλάζει τον τύπο σε «γενικό κείμενο»: το έγγραφο δεν επιτρέπεται να μείνει τιμολόγιο
    // μέχρι την επόμενη εξαγωγή.
    expect(mergeLegacyPatch(existing, { title: 'Τ' }, null, 'general_text').kind).toBe('general');
    const general = fromLegacy({ title: 'Τ' }, [], 'general_text');
    expect(mergeLegacyPatch(general, { companyName: 'Κ' }, null, 'receipt').kind).toBe('receipt');
    expect(mergeLegacyPatch(general, { companyName: 'Κ', customerName: 'Π' }, null, 'invoice').kind).toBe('invoice');
    // Χωρίς `docType` στο PATCH τίποτα δεν αλλάζει στη σημερινή συμπεριφορά.
    expect(mergeLegacyPatch(general, { summary: 'x' }, null, null).kind).toBe('general');
  });

  it('returns the document (normalized) when there is nothing to patch', () => {
    const merged = mergeLegacyPatch(existing, null);
    expect(merged.totals.total).toBe(124);
    expect(merged.digital.mark).toBe('400014123456789');
    expect(merged.issuer.vat).toBe('999863881');                   // normalizeDocument τρέχει πάντα
  });
});

describe('γραμμές της βάσης (Prisma Decimal)', () => {
  it('loadDocumentJson διαβάζει τα Decimal των γραμμών ως αριθμούς, όχι null', async () => {
    const dec = (v: string) => new Prisma.Decimal(v);
    db.ocrDocument.findUnique.mockResolvedValue({ document: null, extractedData: LEGACY, docType: 'INVOICE' });
    db.ocrInvoiceItem.findMany.mockResolvedValue([
      { code: 'A1', name: 'Είδος Α', quantity: dec('2'), price: dec('25.5'), discount: dec('0'), vatRate: dec('24'), total: dec('51') },
    ]);
    const doc = await loadDocumentJson('d1');
    expect(doc.lines[0]).toMatchObject({ quantity: 2, unitPrice: 25.5, vatRate: 24, net: 51 });
    // Και άρα τα σύνολα δεν «συμφωνούν» με ένα φανταστικό μηδέν.
    expect(reconcileDocument({ ...doc, totals: { ...doc.totals, net: null } }).document.totals.net).toBe(51);
  });

  it('πέφτει πίσω στα items[] του extractedData όταν δεν υπάρχουν γραμμές στη βάση', async () => {
    db.ocrDocument.findUnique.mockResolvedValue({
      document: null,
      extractedData: { ...LEGACY, items: [{ code: 'Z9', name: 'Παλιό', quantity: 1, price: 10, total: 10, vatRate: 24 }] },
      docType: 'INVOICE',
    });
    db.ocrInvoiceItem.findMany.mockResolvedValue([]);
    const doc = await loadDocumentJson('d1');
    expect(doc.lines.map((l) => l.code)).toEqual(['Z9']);
  });
});

describe('mergeLegacyPatch — κλειδιά που μολύνουν prototype', () => {
  it('αγνοεί __proto__ / constructor / prototype αντί να σκάσει', () => {
    const base = fromLegacy(LEGACY, [], 'invoice');
    const hostile = JSON.parse('{"__proto__":{"admin":true},"constructor":1,"prototype":2,"toString":"x","totalAmount":9}');
    const merged = mergeLegacyPatch(base, hostile);
    expect(merged.totals.total).toBe(9);
    expect(merged.custom).not.toHaveProperty('constructor');
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
  });
});
