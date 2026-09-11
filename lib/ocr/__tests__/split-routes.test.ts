// lib/ocr/__tests__/split-routes.test.ts
// Τα δύο βήματα του διαχωρισμού ως handlers, με mocked prisma / rbac / Bunny — αλλά με ΑΛΗΘΙΝΟ
// pdf-lib πάνω σε ένα μικρό PDF που φτιάχνουμε εδώ: το μόνο που έχει σημασία είναι ότι τα παιδιά
// έχουν ΟΝΤΩΣ τις σελίδες που υποσχέθηκε η οθόνη.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';

const { db, rbac, bunny, text } = vi.hoisted(() => ({
  db: {
    ocrBatch: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    ocrDocument: { create: vi.fn(), count: vi.fn() },
  },
  rbac: { requirePermission: vi.fn() },
  bunny: { bunnyUploadPrivate: vi.fn(), bunnyDownload: vi.fn() },
  text: { extractPageTexts: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/rbac', () => rbac);
vi.mock('@/lib/bunny', () => bunny);
vi.mock('@/lib/ocr/pdf-text', () => text);

import { POST as splitPreview } from '@/app/api/admin/ocr/split-preview/route';
import { POST as split } from '@/app/api/admin/ocr/split/route';
import { MAX_SPLIT_PAGES } from '../split';

/** Ένα πραγματικό PDF με `n` σελίδες, καθεμιά με τον αριθμό της γραμμένο πάνω. */
async function makePdf(n: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) doc.addPage([300, 400]);
  return Buffer.from(await doc.save());
}

const pagesOf = async (buf: Buffer) => (await PDFDocument.load(new Uint8Array(buf))).getPageCount();

const previewReq = (file: Buffer, name = 'ΤΙΜΟΛΟΓΙΑ ΙΟΥΝΙΟΥ.pdf') => {
  const form = new FormData();
  form.set('file', new File([new Uint8Array(file)], name, { type: 'application/pdf' }));
  form.set('language', 'el');
  return new Request('http://localhost/api/admin/ocr/split-preview', { method: 'POST', body: form });
};

const splitReq = (body: unknown) =>
  new Request('http://localhost/api/admin/ocr/split', { method: 'POST', body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  rbac.requirePermission.mockResolvedValue({ id: 'u1' });
  bunny.bunnyUploadPrivate.mockResolvedValue(undefined);
  db.ocrBatch.create.mockResolvedValue({ id: 'batch1' });
  db.ocrBatch.update.mockResolvedValue({ id: 'batch1' });
  db.ocrDocument.count.mockResolvedValue(0);
  let seq = 0;
  db.ocrDocument.create.mockImplementation(async () => ({ id: `doc${++seq}` }));
  text.extractPageTexts.mockResolvedValue([]);
});

describe('POST /api/admin/ocr/split-preview', () => {
  it('ανεβάζει ΜΙΑ φορά το πρωτότυπο, μετράει σελίδες και προτείνει κοψίματα', async () => {
    text.extractPageTexts.mockResolvedValue([
      'ΑΦΜ: 999863881 Αριθμός: 17 Σελίδα 1 από 2',
      'ΑΦΜ: 999863881 Αριθ. 17 Σελ. 2/2',
      'ΑΦΜ: 094014201 Αριθμός: 5 Σελίδα 1 από 1',
    ]);
    const res = await splitPreview(previewReq(await makePdf(3)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ batchId: 'batch1', pageCount: 3, hasTextLayer: true, suggested: [0, 2] });
    expect(body.pages).toHaveLength(3);
    expect(body.pages[1].thumbUrl).toContain('/api/admin/ocr/batches/batch1/page-image?page=1');
    expect(bunny.bunnyUploadPrivate).toHaveBeenCalledTimes(1);
    expect(bunny.bunnyUploadPrivate.mock.calls[0][0].key).toBe('ocr/batches/batch1/source.pdf');
    expect(db.ocrBatch.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sourcePages: 3, sourceName: 'ΤΙΜΟΛΟΓΙΑ ΙΟΥΝΙΟΥ.pdf' }),
    }));
  });

  it('σαρωμένο PDF (χωρίς κείμενο) → ένα ανά σελίδα, και το λέει', async () => {
    text.extractPageTexts.mockResolvedValue(['', '', '']);
    const body = await (await splitPreview(previewReq(await makePdf(3)))).json();
    expect(body.hasTextLayer).toBe(false);
    expect(body.suggested).toEqual([0, 1, 2]);
  });

  it('πάνω από το όριο σελίδων → άρνηση με ελληνικό μήνυμα, χωρίς φάκελο', async () => {
    const res = await splitPreview(previewReq(await makePdf(MAX_SPLIT_PAGES + 1)));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain(String(MAX_SPLIT_PAGES));
    expect(db.ocrBatch.create).not.toHaveBeenCalled();
    expect(bunny.bunnyUploadPrivate).not.toHaveBeenCalled();
  });

  it('ό,τι δεν είναι PDF απορρίπτεται με 415', async () => {
    const form = new FormData();
    form.set('file', new File([new Uint8Array([1, 2, 3])], 'φωτο.jpg', { type: 'image/jpeg' }));
    const res = await splitPreview(new Request('http://localhost/x', { method: 'POST', body: form }));
    expect(res.status).toBe(415);
    expect(db.ocrBatch.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/ocr/split', () => {
  const batch = (pages: number) => ({
    id: 'batch1', name: 'ΤΙΜΟΛΟΓΙΑ ΙΟΥΝΙΟΥ.pdf', language: 'el',
    sourceKey: 'ocr/batches/batch1/source.pdf', sourceName: 'ΤΙΜΟΛΟΓΙΑ ΙΟΥΝΙΟΥ.pdf', sourcePages: pages,
  });

  it('φτιάχνει ένα PDF ανά τμήμα, με τις ΣΩΣΤΕΣ σελίδες, και γραμμές PENDING', async () => {
    db.ocrBatch.findFirst.mockResolvedValue(batch(5));
    bunny.bunnyDownload.mockResolvedValue(await makePdf(5));

    const res = await split(splitReq({ batchId: 'batch1', cuts: [0, 3] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.documents).toHaveLength(2);
    expect(body.documents.map((d: { fileName: string }) => d.fileName)).toEqual([
      'ΤΙΜΟΛΟΓΙΑ ΙΟΥΝΙΟΥ — 1 (σελ. 1-3).pdf',
      'ΤΙΜΟΛΟΓΙΑ ΙΟΥΝΙΟΥ — 2 (σελ. 4-5).pdf',
    ]);

    const uploaded = bunny.bunnyUploadPrivate.mock.calls.map((c) => c[0].body as Buffer);
    expect(await pagesOf(uploaded[0])).toBe(3);
    expect(await pagesOf(uploaded[1])).toBe(2);

    const rows = db.ocrDocument.create.mock.calls.map((c) => c[0].data);
    expect(rows.every((r) => r.status === 'PENDING' && r.batchId === 'batch1')).toBe(true);
    expect(rows.every((r) => r.mimeType === 'application/pdf')).toBe(true);
  });

  it('χωρίς κοψίματα → ένα παραστατικό με όλες τις σελίδες', async () => {
    db.ocrBatch.findFirst.mockResolvedValue(batch(4));
    bunny.bunnyDownload.mockResolvedValue(await makePdf(4));
    const body = await (await split(splitReq({ batchId: 'batch1', cuts: [] }))).json();
    expect(body.documents).toHaveLength(1);
    expect(await pagesOf(bunny.bunnyUploadPrivate.mock.calls[0][0].body as Buffer)).toBe(4);
  });

  it('κόψιμο εκτός ορίων → 400 και ΚΑΝΕΝΑ αρχείο', async () => {
    db.ocrBatch.findFirst.mockResolvedValue(batch(3));
    bunny.bunnyDownload.mockResolvedValue(await makePdf(3));
    const res = await split(splitReq({ batchId: 'batch1', cuts: [0, 7] }));
    expect(res.status).toBe(400);
    expect(bunny.bunnyUploadPrivate).not.toHaveBeenCalled();
    expect(db.ocrDocument.create).not.toHaveBeenCalled();
  });

  it('cuts που δεν είναι πίνακας → 400', async () => {
    const res = await split(splitReq({ batchId: 'batch1', cuts: 'όλα' }));
    expect(res.status).toBe(400);
  });

  it('φάκελος χωρίς πρωτότυπο → 404', async () => {
    db.ocrBatch.findFirst.mockResolvedValue({ ...batch(3), sourceKey: null });
    const res = await split(splitReq({ batchId: 'batch1', cuts: [0] }));
    expect(res.status).toBe(404);
  });

  it('ο φάκελος αναζητείται ΜΟΝΟ ανάμεσα σε αυτούς που έφτιαξε ο ίδιος χρήστης', async () => {
    db.ocrBatch.findFirst.mockResolvedValue(batch(3));
    bunny.bunnyDownload.mockResolvedValue(await makePdf(3));
    await split(splitReq({ batchId: 'batch1', cuts: [0] }));
    expect(db.ocrBatch.findFirst).toHaveBeenCalledWith({ where: { id: 'batch1', createdById: 'u1' } });
  });

  it('περνάει τον τύπο εγγράφου της φόρμας — δεν είναι πάντα «auto»', async () => {
    db.ocrBatch.findFirst.mockResolvedValue(batch(2));
    bunny.bunnyDownload.mockResolvedValue(await makePdf(2));
    const body = await (await split(splitReq({ batchId: 'batch1', cuts: [0, 1], docType: 'general_text' }))).json();
    expect(body.docType).toBe('general_text');
    const rows = db.ocrDocument.create.mock.calls.map((c) => c[0].data);
    expect(rows.every((r) => r.docType === 'GENERAL_TEXT')).toBe(true);
  });

  it('άγνωστος τύπος εγγράφου → 400, χωρίς κανένα αρχείο', async () => {
    db.ocrBatch.findFirst.mockResolvedValue(batch(2));
    const res = await split(splitReq({ batchId: 'batch1', cuts: [0], docType: 'ό,τι νά ναι' }));
    expect(res.status).toBe(400);
    expect(bunny.bunnyUploadPrivate).not.toHaveBeenCalled();
  });

  it('δεύτερος διαχωρισμός του ίδιου φακέλου → 409 (χωρίς διπλά έγγραφα)', async () => {
    db.ocrBatch.findFirst.mockResolvedValue(batch(3));
    db.ocrDocument.count.mockResolvedValue(2);
    const res = await split(splitReq({ batchId: 'batch1', cuts: [0] }));
    expect(res.status).toBe(409);
    expect(db.ocrDocument.create).not.toHaveBeenCalled();
  });
});
