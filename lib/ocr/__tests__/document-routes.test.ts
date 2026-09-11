// lib/ocr/__tests__/document-routes.test.ts
// Τα routes που ΓΡΑΦΟΥΝ έγγραφο (upload, re-extract, PATCH) και αυτό που το κατεβάζει. Καλούνται
// απευθείας ως handlers, με mocked prisma / rbac / Bunny / LLM. Ελέγχουμε ότι κάθε γράψιμο περνάει
// από τον ΕΝΑ γραφέα (`saveDocumentJson`) — ποτέ απευθείας στο `extractedData` ή στις γραμμές.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { db, rbac, bunny, ocr, sm, tpl, dt, thumb, writer, ex } = vi.hoisted(() => ({
  db: {
    ocrDocument: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    ocrInvoiceItem: { deleteMany: vi.fn(), createMany: vi.fn(), findMany: vi.fn() },
    templateRun: { findFirst: vi.fn() },
    appSetting: { upsert: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
    purchaseDocType: { findFirst: vi.fn(), findUnique: vi.fn() },
    softoneDocSeries: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
  rbac: { requirePermission: vi.fn() },
  bunny: { bunnyUploadPrivate: vi.fn(), bunnyDownload: vi.fn(), bunnyDelete: vi.fn() },
  ocr: { extractDocument: vi.fn() },
  sm: { buildSoftoneMatch: vi.fn(), matchDocItems: vi.fn(), buildDuplicateCheck: vi.fn() },
  tpl: { runMatchingTemplate: vi.fn() },
  dt: { classifyDocument: vi.fn() },
  thumb: { ensureOcrThumbnail: vi.fn() },
  ex: { loadIssuerExample: vi.fn() },
  writer: { saveDocumentJson: vi.fn(), loadDocumentJson: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/rbac', () => rbac);
vi.mock('@/lib/bunny', () => bunny);
vi.mock('@/lib/ocr/extract', () => ocr);
vi.mock('@/lib/ocr/softone-match', () => sm);
vi.mock('@/lib/templates/run', () => tpl);
vi.mock('@/lib/ocr/doc-type', () => dt);
vi.mock('@/lib/ocr/thumbnail', () => thumb);
vi.mock('@/lib/ocr/example-lookup', () => ex);
vi.mock('@/lib/settings', () => ({ getSetting: vi.fn().mockResolvedValue(null) }));
// Ο γραφέας μένει αληθινός εκτός από τα δύο σημεία που αγγίζουν τη βάση: θέλουμε να δούμε ΤΙ
// έγγραφο του δόθηκε, με το πραγματικό `mergeLegacyPatch` να έχει τρέξει από πάνω.
vi.mock('@/lib/ocr/document', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ocr/document')>()),
  ...writer,
}));

import { POST as upload } from '@/app/api/admin/ocr/route';
import { POST as reextract } from '@/app/api/admin/ocr/[id]/reextract/route';
import { POST as extractOne } from '@/app/api/admin/ocr/[id]/extract/route';
import { PATCH as patchDoc } from '@/app/api/admin/ocr/[id]/route';
import { GET as getDocument } from '@/app/api/admin/ocr/[id]/document/route';
import { fromLegacy, setPath, type DocumentJson } from '../canonical';

const USER = { id: 'u1', email: 'a@b.gr' };
const ctx = (id = 'doc1') => ({ params: Promise.resolve({ id }) });

const LEGACY = {
  companyName: 'ΚΑΠΑΛΙΝΕ ΑΕ', vatNumber: '999863881', invoiceNumber: '17',
  date: '2026-06-22', subtotal: 100, vatAmount: 24, totalAmount: 124,
};
const DOC: DocumentJson = setPath(fromLegacy(LEGACY, [], 'invoice'), 'digital.mark', '400014123456789');

const patch = (body: unknown) =>
  new Request('http://localhost/api/admin/ocr/doc1', { method: 'PATCH', body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  rbac.requirePermission.mockResolvedValue(USER);
  db.ocrDocument.create.mockResolvedValue({ id: 'doc1' });
  db.ocrDocument.update.mockResolvedValue({ id: 'doc1' });
  db.ocrDocument.updateMany.mockResolvedValue({ count: 1 });
  db.ocrDocument.findUnique.mockResolvedValue({
    id: 'doc1', storageKey: 'ocr/x.pdf', mimeType: 'application/pdf', docType: 'INVOICE',
    language: 'el', originalName: 'ΤΙΜΟΛΟΓΙΟ 17.pdf', fileName: 'timologio-17.pdf',
    completedAt: new Date('2026-06-22T09:00:00.000Z'), createdAt: new Date('2026-06-22T08:00:00.000Z'),
    softoneSeries: null, seriesSource: null,
  });
  db.ocrInvoiceItem.findMany.mockResolvedValue([]);
  db.templateRun.findFirst.mockResolvedValue(null);
  db.$transaction.mockResolvedValue([]);
  bunny.bunnyUploadPrivate.mockResolvedValue(undefined);
  bunny.bunnyDownload.mockResolvedValue(Buffer.from('%PDF-1.4'));
  sm.buildSoftoneMatch.mockResolvedValue({});
  sm.matchDocItems.mockResolvedValue(undefined);
  sm.buildDuplicateCheck.mockResolvedValue({});
  tpl.runMatchingTemplate.mockResolvedValue(null);
  dt.classifyDocument.mockResolvedValue(undefined);
  thumb.ensureOcrThumbnail.mockResolvedValue(undefined);
  ex.loadIssuerExample.mockResolvedValue(null);
  writer.saveDocumentJson.mockResolvedValue(undefined);
  writer.loadDocumentJson.mockResolvedValue(DOC);
  ocr.extractDocument.mockResolvedValue({
    document: DOC, data: { ...LEGACY, items: [] },
    rawText: null, model: 'gemini-2.5-flash', tokensUsed: 10, durationMs: 5,
  });
});

/** Κανένα route δεν επιτρέπεται να γράψει μόνο του τα παράγωγα του εγγράφου. */
function expectNoRawDerivedWrites() {
  for (const call of db.ocrDocument.update.mock.calls) {
    expect(Object.keys(call[0].data ?? {})).not.toContain('extractedData');
    expect(Object.keys(call[0].data ?? {})).not.toContain('document');
    expect(Object.keys(call[0].data ?? {})).not.toContain('issuerAfm');
  }
  expect(db.ocrInvoiceItem.createMany).not.toHaveBeenCalled();
}

describe('POST /api/admin/ocr — upload', () => {
  const uploadReq = () => {
    const form = new FormData();
    form.set('file', new File([new Uint8Array([1, 2, 3])], 'ΤΙΜΟΛΟΓΙΟ 17.pdf', { type: 'application/pdf' }));
    form.set('docType', 'invoice');
    form.set('language', 'el');
    return new Request('http://localhost/api/admin/ocr', { method: 'POST', body: form });
  };

  it('γράφει το έγγραφο του pipeline μέσω saveDocumentJson και μετά ολοκληρώνει', async () => {
    const res = await upload(uploadReq());
    expect(res.status).toBe(200);
    expect(writer.saveDocumentJson).toHaveBeenCalledWith('doc1', DOC, { replaceItems: true });
    expectNoRawDerivedWrites();
    const status = db.ocrDocument.update.mock.calls.find((c) => c[0].data?.status === 'COMPLETED');
    expect(status?.[0].data).toMatchObject({ model: 'gemini-2.5-flash', tokensUsed: 10 });
  });

  it('κρατάει τη σειρά των παρενεργειών: έγγραφο → αντιστοίχιση → σειρά → πρότυπο', async () => {
    const order: string[] = [];
    writer.saveDocumentJson.mockImplementation(async () => { order.push('save'); });
    sm.matchDocItems.mockImplementation(async () => { order.push('match'); });
    dt.classifyDocument.mockImplementation(async () => { order.push('classify'); });
    tpl.runMatchingTemplate.mockImplementation(async () => { order.push('template'); return null; });
    await upload(uploadReq());
    expect(order).toEqual(['save', 'match', 'classify', 'template']);
  });

  it('απαντάει με τα flat κλειδιά που περιμένει ο σημερινός client', async () => {
    const body = await (await upload(uploadReq())).json();
    expect(body.data.vatNumber).toBe('999863881');
    expect(body.id).toBe('doc1');
  });

  // «Αυτόματα»: το αποθηκευμένο είδος το λέει το `document.kind` της ανάγνωσης, όχι η φόρμα.
  const autoReq = () => {
    const form = new FormData();
    form.set('file', new File([new Uint8Array([1, 2, 3])], 'έγγραφο.pdf', { type: 'application/pdf' }));
    form.set('docType', 'auto');
    form.set('language', 'el');
    return new Request('http://localhost/api/admin/ocr', { method: 'POST', body: form });
  };
  const savedDocType = () =>
    db.ocrDocument.update.mock.calls.find((c) => c[0].data?.status === 'COMPLETED')?.[0].data.docType;

  it('auto + παραστατικό με παραλήπτη → INVOICE', async () => {
    const invoice = { ...DOC, kind: 'invoice' as const };
    ocr.extractDocument.mockResolvedValue({
      document: invoice, data: LEGACY, rawText: null, model: 'm', tokensUsed: 1, durationMs: 1,
    });
    await upload(autoReq());
    expect(ocr.extractDocument).toHaveBeenCalledWith(expect.objectContaining({ docType: 'auto' }));
    expect(savedDocType()).toBe('INVOICE');
  });

  it('auto + απόδειξη → RECEIPT', async () => {
    await upload(autoReq());                       // το DOC είναι απόδειξη (χωρίς παραλήπτη)
    expect(savedDocType()).toBe('RECEIPT');
  });

  it('auto + ελεύθερο κείμενο → GENERAL_TEXT', async () => {
    const general = fromLegacy({ title: 'Επιστολή', fullText: 'κείμενο' }, [], 'general_text');
    ocr.extractDocument.mockResolvedValue({
      document: general, data: { title: 'Επιστολή', fullText: 'κείμενο' },
      rawText: null, model: 'm', tokensUsed: 1, durationMs: 1,
    });
    await upload(autoReq());
    expect(savedDocType()).toBe('GENERAL_TEXT');
  });

  it('απορρίπτει άγνωστο docType με 400', async () => {
    const form = new FormData();
    form.set('file', new File([new Uint8Array([1])], 'x.pdf', { type: 'application/pdf' }));
    form.set('docType', 'μαγικό');
    const res = await upload(new Request('http://localhost/api/admin/ocr', { method: 'POST', body: form }));
    expect(res.status).toBe(400);
    expect(ocr.extractDocument).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/ocr/[id]/reextract', () => {
  it('χωρίς σώμα, η επανεκτέλεση ζητάει «auto» και ξαναγράφει το είδος', async () => {
    await reextract(new Request('http://localhost/x', { method: 'POST' }), ctx());
    expect(ocr.extractDocument).toHaveBeenCalledWith(expect.objectContaining({ docType: 'auto' }));
    const completed = db.ocrDocument.update.mock.calls.find((c) => c[0].data?.status === 'COMPLETED');
    expect(completed?.[0].data.docType).toBe('RECEIPT');   // το DOC είναι απόδειξη
  });

  it('σέβεται ρητή επιλογή τύπου από τον διάλογο', async () => {
    await reextract(
      new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ docType: 'invoice' }) }),
      ctx(),
    );
    expect(ocr.extractDocument).toHaveBeenCalledWith(expect.objectContaining({ docType: 'invoice' }));
  });

  it('400 σε άγνωστο τύπο — τίποτα δεν διαβάζεται ξανά', async () => {
    const res = await reextract(
      new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ docType: 'ό,τι νά ναι' }) }),
      ctx(),
    );
    expect(res.status).toBe(400);
    expect(ocr.extractDocument).not.toHaveBeenCalled();
  });

  it('δίνει στο μοντέλο το επιβεβαιωμένο παράδειγμα του ίδιου εκδότη (χωρίς δεύτερη κλήση)', async () => {
    db.ocrDocument.findUnique.mockResolvedValue({
      id: 'doc1', storageKey: 'ocr/x.pdf', mimeType: 'application/pdf', docType: 'INVOICE',
      language: 'el', originalName: 'x.pdf', fileName: 'x.pdf', issuerAfm: '999863881',
      softoneSeries: null, seriesSource: null,
    });
    ex.loadIssuerExample.mockResolvedValue({ issuer: { name: 'ΚΑΠΑΛΙΝΕ ΑΕ' } });
    await reextract(new Request('http://localhost/x', { method: 'POST' }), ctx());
    expect(ex.loadIssuerExample).toHaveBeenCalledWith('999863881', { excludeId: 'doc1' });
    expect(ocr.extractDocument).toHaveBeenCalledWith(
      expect.objectContaining({ example: { issuer: { name: 'ΚΑΠΑΛΙΝΕ ΑΕ' } } }),
    );
  });

  it('ξαναγράφει το έγγραφο μέσω saveDocumentJson, χωρίς χειροκίνητο delete/create γραμμών', async () => {
    const res = await reextract(new Request('http://localhost/x', { method: 'POST' }), ctx());
    expect(res.status).toBe(200);
    expect(writer.saveDocumentJson).toHaveBeenCalledWith('doc1', DOC, { replaceItems: true });
    expect(db.ocrInvoiceItem.deleteMany).not.toHaveBeenCalled();
    expectNoRawDerivedWrites();
  });
});

// Η διαδρομή που διαβάζει ένα έγγραφο που ΥΠΑΡΧΕΙ ήδη ως αρχείο: τα παιδιά ενός διαχωρισμένου PDF.
describe('POST /api/admin/ocr/[id]/extract', () => {
  const pending = {
    id: 'doc1', storageKey: 'ocr/batches/b1/1.pdf', mimeType: 'application/pdf', docType: 'INVOICE',
    language: 'el', originalName: 'στοίβα.pdf', fileName: 'στοίβα — 1 (σελ. 1-2).pdf',
    status: 'PENDING', issuerAfm: null, softoneSeries: null, seriesSource: null,
  };

  it('διαβάζει ένα PENDING έγγραφο με την ΙΔΙΑ διαδρομή του ανεβάσματος', async () => {
    db.ocrDocument.findUnique.mockResolvedValue(pending);
    const res = await extractOne(new Request('http://localhost/x', { method: 'POST' }), ctx());
    expect(res.status).toBe(200);
    expect(ocr.extractDocument).toHaveBeenCalledWith(expect.objectContaining({ docType: 'auto' }));
    expect(writer.saveDocumentJson).toHaveBeenCalledWith('doc1', DOC, { replaceItems: true });
    const completed = db.ocrDocument.update.mock.calls.find((c) => c[0].data?.status === 'COMPLETED');
    expect(completed?.[0].data.docType).toBe('RECEIPT');
    expectNoRawDerivedWrites();
  });

  it('δεσμεύει το έγγραφο με ΜΙΑ εγγραφή — μόνο από PENDING/FAILED', async () => {
    db.ocrDocument.findUnique.mockResolvedValue(pending);
    await extractOne(new Request('http://localhost/x', { method: 'POST' }), ctx());
    expect(db.ocrDocument.updateMany).toHaveBeenCalledWith({
      where: { id: 'doc1', status: { in: ['PENDING', 'FAILED'] } },
      data: { status: 'PROCESSING', errorMessage: null },
    });
  });

  it('ένα ήδη διαβασμένο έγγραφο δεν ξαναδιαβάζεται από εδώ (409)', async () => {
    db.ocrDocument.findUnique.mockResolvedValue({ ...pending, status: 'COMPLETED' });
    db.ocrDocument.updateMany.mockResolvedValue({ count: 0 });
    const res = await extractOne(new Request('http://localhost/x', { method: 'POST' }), ctx());
    expect(res.status).toBe(409);
    expect(ocr.extractDocument).not.toHaveBeenCalled();
  });

  it('δεύτερο ταυτόχρονο αίτημα χάνει τη δέσμευση και ΔΕΝ πληρώνει δεύτερη ανάγνωση', async () => {
    db.ocrDocument.findUnique.mockResolvedValue(pending);      // η ανάγνωση κατάστασης λέει «PENDING»
    db.ocrDocument.updateMany.mockResolvedValue({ count: 0 }); // …αλλά το πρόλαβε άλλο αίτημα
    const res = await extractOne(new Request('http://localhost/x', { method: 'POST' }), ctx());
    expect(res.status).toBe(409);
    expect(ocr.extractDocument).not.toHaveBeenCalled();
  });

  it('αποτυχία ανάγνωσης → FAILED με το μήνυμα, όχι σιωπή', async () => {
    db.ocrDocument.findUnique.mockResolvedValue(pending);
    ocr.extractDocument.mockRejectedValue(new Error('το μοντέλο δεν απάντησε'));
    const res = await extractOne(new Request('http://localhost/x', { method: 'POST' }), ctx());
    expect(res.status).toBe(422);
    const failed = db.ocrDocument.update.mock.calls.find((c) => c[0].data?.status === 'FAILED');
    expect(failed?.[0].data.errorMessage).toContain('το μοντέλο δεν απάντησε');
  });
});

describe('PATCH /api/admin/ocr/[id]', () => {
  it('δέχεται κανονικό έγγραφο και το αποθηκεύει', async () => {
    const next = setPath(DOC, 'totals.total', 200);
    const res = await patchDoc(patch({ document: next }), ctx());
    expect(res.status).toBe(200);
    const [, saved] = writer.saveDocumentJson.mock.calls[0];
    expect((saved as DocumentJson).totals.total).toBe(200);
    expectNoRawDerivedWrites();
  });

  it('422 όταν το έγγραφο δεν περνάει το σχήμα — και ΤΙΠΟΤΑ δεν γράφεται', async () => {
    const res = await patchDoc(patch({ document: { kind: 'σκουπίδι' } }), ctx());
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: 'invalid_document' });
    expect(writer.saveDocumentJson).not.toHaveBeenCalled();
    expect(db.ocrDocument.update).not.toHaveBeenCalled();
  });

  it('ένα παλιό {extractedData} επικαλύπτεται χωρίς να σβήνει τη ΜΑΡΚ', async () => {
    const res = await patchDoc(patch({ extractedData: { ...LEGACY, totalAmount: 200 } }), ctx());
    expect(res.status).toBe(200);
    const [, saved] = writer.saveDocumentJson.mock.calls[0];
    expect((saved as DocumentJson).totals.total).toBe(200);
    expect((saved as DocumentJson).digital.mark).toBe('400014123456789');
  });

  it('ένα παλιό {items} ξαναχτίζει τις γραμμές μέσω του γραφέα', async () => {
    await patchDoc(patch({ items: [{ code: 'X', name: 'Νέο', quantity: 1, price: 10, total: 10, vatRate: 24 }] }), ctx());
    const [, saved, opts] = writer.saveDocumentJson.mock.calls[0];
    expect((saved as DocumentJson).lines).toHaveLength(1);
    expect(opts).toEqual({ replaceItems: true });
    expect(db.ocrInvoiceItem.createMany).not.toHaveBeenCalled();
  });

  it('σκέτο {extractedData} ΔΕΝ ξαναγράφει τις γραμμές ούτε ξανατρέχει αντιστοίχιση', async () => {
    await patchDoc(patch({ extractedData: { ...LEGACY, totalAmount: 200 } }), ctx());
    const [, , opts] = writer.saveDocumentJson.mock.calls[0];
    expect(opts).toEqual({ replaceItems: false });
    expect(sm.matchDocItems).not.toHaveBeenCalled();
  });

  it('όταν οι γραμμές ΟΝΤΩΣ αλλάζουν, ξανατρέχει η αντιστοίχιση ειδών', async () => {
    await patchDoc(patch({ items: [{ code: 'X', name: 'Νέο', quantity: 1, price: 10, total: 10, vatRate: 24 }] }), ctx());
    expect(sm.matchDocItems).toHaveBeenCalledWith('doc1');
  });

  it('ένα κανονικό {document} ξαναγράφει τις γραμμές και αντιστοιχίζει', async () => {
    await patchDoc(patch({ document: setPath(DOC, 'totals.total', 200) }), ctx());
    const [, , opts] = writer.saveDocumentJson.mock.calls[0];
    expect(opts).toEqual({ replaceItems: true });
    expect(sm.matchDocItems).toHaveBeenCalledWith('doc1');
  });

  it('μια ανθρώπινη διόρθωση της ανάγνωσης σφραγίζει το έγγραφο ως επιβεβαιωμένο', async () => {
    await patchDoc(patch({ extractedData: { ...LEGACY, totalAmount: 200 } }), ctx());
    const [call] = db.ocrDocument.update.mock.calls;
    expect(call[0].data.verifiedAt).toBeInstanceOf(Date);
    expect(call[0].data.verifiedById).toBe('u1');
  });

  it('αλλαγή κατηγορίας / σημείωσης ΔΕΝ είναι επιβεβαίωση της ανάγνωσης', async () => {
    await patchDoc(patch({ category: 'EXPENSE', notes: 'κάτι' }), ctx());
    const [call] = db.ocrDocument.update.mock.calls;
    expect(call[0].data).not.toHaveProperty('verifiedAt');
  });

  it('μια αποθήκευση μόνο κατηγορίας δεν αγγίζει καθόλου το έγγραφο', async () => {
    await patchDoc(patch({ category: 'EXPENSE' }), ctx());
    expect(writer.saveDocumentJson).not.toHaveBeenCalled();
    expect(writer.loadDocumentJson).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/ocr/[id]/document', () => {
  it('επιστρέφει τον φάκελο v3', async () => {
    db.templateRun.findFirst.mockResolvedValue({ template: { slug: 'kapaline' } });
    const res = await getDocument(new Request('http://localhost/x'), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      version: 3, template: 'kapaline', documentId: 'doc1', file: 'ΤΙΜΟΛΟΓΙΟ 17.pdf',
      extractedAt: '2026-06-22T09:00:00.000Z',
    });
    expect(body.document.issuer.vat).toBe('999863881');
  });

  it('template = null όταν δεν υπάρχει επιτυχημένη εκτέλεση προτύπου', async () => {
    const body = await (await getDocument(new Request('http://localhost/x'), ctx())).json();
    expect(body.template).toBeNull();
  });

  it('?download=1 κατεβάζει αρχείο με το όνομα του εγγράφου', async () => {
    const res = await getDocument(new Request('http://localhost/x?download=1'), ctx());
    const cd = res.headers.get('Content-Disposition') ?? '';
    expect(cd).toMatch(/^attachment;/);
    expect(cd).toContain(encodeURIComponent('ΤΙΜΟΛΟΓΙΟ 17.pdf.json'));
  });

  it('404 για έγγραφο που δεν υπάρχει', async () => {
    db.ocrDocument.findUnique.mockResolvedValue(null);
    expect((await getDocument(new Request('http://localhost/x'), ctx())).status).toBe(404);
  });
});
