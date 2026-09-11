// lib/templates/__tests__/samples.test.ts — η βιβλιοθήκη δειγμάτων εκπαίδευσης (spec §11).
// Prisma / Bunny / εξαγωγέας / rasterize είναι mocked: ελέγχουμε ΤΙ γράφεται, όχι τι διαβάζει το μοντέλο.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  extractionTemplate: { findUnique: vi.fn(), update: vi.fn() },
  templateSample: { findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
  ocrDocument: { findUnique: vi.fn() },
}));
const bunny = vi.hoisted(() => ({ bunnyUploadPrivate: vi.fn(), bunnyDownload: vi.fn(), bunnyDelete: vi.fn() }));
const extract = vi.hoisted(() => vi.fn());
const raster = vi.hoisted(() => ({
  isPdfBuffer: vi.fn((b: Buffer) => b.subarray(0, 5).toString('latin1') === '%PDF-'),
  sniffImageType: vi.fn(() => null),
  countPdfPages: vi.fn(async () => 2),
  pageOutline: vi.fn(async () => ({ text: 'ΚΑΠΑΛΙΝΕ ΜΕΤΑΦΟΡΙΚΗ ΝΑΥΛΟΣ ΔΙΑΔΡΟΜΗ', aspect: 1.41 })),
}));

vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/bunny', () => bunny);
vi.mock('@/lib/ocr/rasterize', () => raster);
vi.mock('../extract', () => ({ extractTemplateFields: (...a: unknown[]) => extract(...a) }));

import {
  addSample, adoptPrimarySample, deleteSample, listSamples, primaryFingerprint, readAllSamples, readSample,
  refreshTrainingScore, sampleFromDocument, verifySample,
  MAX_SAMPLES_PER_TEMPLATE, READ_ALL_LIMIT,
} from '../samples';
import { SampleError } from '../sample';

const PDF = Buffer.from('%PDF-1.4 hello');

const FIELDS = [
  { id: 'f1', templateId: 't1', key: 'total', label: 'Σύνολο', kind: 'SINGLE', valueType: 'CURRENCY', color: '#111', region: { page: 0, bbox: [0.1, 0.1, 0.2, 0.05] }, columns: null, aiHint: null, required: true, order: 0, lastGood: null },
  { id: 'f2', templateId: 't1', key: 'num', label: 'Αριθμός', kind: 'SINGLE', valueType: 'TEXT', color: '#222', region: { page: 0, bbox: [0.4, 0.1, 0.2, 0.05] }, columns: null, aiHint: null, required: false, order: 1, lastGood: null },
];

const TEMPLATE = {
  id: 't1', slug: 'kapaline', supplierName: 'ΚΑΠΑΛΙΝΕ ΑΕ', vatNumber: '999863881',
  minTrainingScore: 0.9, minTrainingSamples: 3, trainingScore: null, verifiedSamples: 0,
  sampleStorageKey: 'templates/t1/sample-abc.pdf', sampleMimeType: 'application/pdf', samplePageCount: 2,
  fingerprint: { afm: '999863881', issuer: 'ΚΑΠΑΛΙΝΕ ΑΕ', words: ['ΜΕΤΑΦΟΡΙΚΗ'], aspect: 1.41 },
  fields: FIELDS,
};

const sample = (over: Record<string, unknown> = {}) => ({
  id: 's1', templateId: 't1', fileName: 'a.pdf', storageKey: 'templates/t1/samples/a.pdf',
  mimeType: 'application/pdf', pageCount: 2, status: 'PENDING', expected: null, lastResult: null,
  score: null, fingerprint: null, isPrimary: false, createdById: null,
  createdAt: new Date('2026-09-11T10:00:00Z'), updatedAt: new Date('2026-09-11T10:00:00Z'),
  ...over,
});

const value = (v: unknown, over: Record<string, unknown> = {}) => ({ raw: String(v), value: v, confidence: 0.8, source: 'vision', page: 0, bbox: [0, 0, 1, 1], color: '#111', ...over });

beforeEach(() => {
  vi.clearAllMocks();
  db.extractionTemplate.findUnique.mockResolvedValue(TEMPLATE);
  db.extractionTemplate.update.mockResolvedValue(TEMPLATE);
  db.templateSample.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => sample(data));
  db.templateSample.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => sample(data));
  db.templateSample.findMany.mockResolvedValue([]);
  db.templateSample.count.mockResolvedValue(0);
  db.templateSample.findUnique.mockResolvedValue(sample());
  bunny.bunnyUploadPrivate.mockResolvedValue({ key: 'k' });
  bunny.bunnyDownload.mockResolvedValue(PDF);
  bunny.bunnyDelete.mockResolvedValue(undefined);
  extract.mockResolvedValue({ values: { total: value(124), num: value('17') }, model: 'm', tokensUsed: 10, errors: [], pageCount: 2, adaptive: [] });
});

// ---------------------------------------------------------------- add

describe('addSample', () => {
  it('uploads under the template samples prefix and stores a PENDING row with a fingerprint', async () => {
    await addSample('t1', { buffer: PDF, fileName: 'ΤΙΜ 17.pdf', userId: 'u1' });

    const up = bunny.bunnyUploadPrivate.mock.calls[0][0] as { key: string; contentType: string };
    expect(up.key).toMatch(/^templates\/t1\/samples\/[\w-]+\.pdf$/);
    expect(up.contentType).toBe('application/pdf');

    const data = db.templateSample.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ templateId: 't1', fileName: 'ΤΙΜ 17.pdf', status: 'PENDING', pageCount: 2, isPrimary: false, createdById: 'u1' });
    // Χτισμένο από το κείμενο της σελίδας + τον εκδότη του προτύπου — χωρίς κλήση μοντέλου.
    expect(data.fingerprint).toMatchObject({ afm: '999863881', aspect: 1.41 });
    expect((data.fingerprint as { words: string[] }).words).toContain('ΜΕΤΑΦΟΡΙΚΗ');
  });

  it('refuses an unknown template, oversize bytes and unrecognised bytes', async () => {
    db.extractionTemplate.findUnique.mockResolvedValueOnce(null);
    await expect(addSample('nope', { buffer: PDF, fileName: 'a.pdf' })).rejects.toMatchObject({ code: 'not_found' });

    const big = Buffer.alloc(26 * 1024 * 1024);
    PDF.copy(big);
    await expect(addSample('t1', { buffer: big, fileName: 'a.pdf' })).rejects.toMatchObject({ code: 'too_large' });

    await expect(addSample('t1', { buffer: Buffer.from('not a document'), fileName: 'a.txt' })).rejects.toBeInstanceOf(SampleError);
    expect(bunny.bunnyUploadPrivate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- read

describe('readSample', () => {
  it('reads with the template fields and stores the result as READ', async () => {
    await readSample('s1');

    const [buf, mime, fields] = extract.mock.calls[0];
    expect(buf).toBe(PDF);
    expect(mime).toBe('application/pdf');
    expect(fields.map((f: { key: string }) => f.key)).toEqual(['total', 'num']);

    const data = db.templateSample.update.mock.calls[0][0].data;
    expect(data.status).toBe('READ');
    expect(data.lastResult).toMatchObject({ total: { value: 124 }, num: { value: '17' } });
  });

  it('keeps a VERIFIED sample verified and rescores it against what the user confirmed', async () => {
    db.templateSample.findUnique.mockResolvedValue(sample({ status: 'VERIFIED', expected: { total: 124, num: '18' } }));
    await readSample('s1');
    const data = db.templateSample.update.mock.calls[0][0].data;
    expect(data.status).toBe('VERIFIED');
    expect(data.score).toBe(0.5);   // total ✓, num ✗
  });

  it('reads every sample of a template in turn and reports the failures', async () => {
    db.templateSample.findMany.mockResolvedValue([{ id: 's1', status: 'PENDING' }, { id: 's2', status: 'PENDING' }]);
    db.templateSample.findUnique.mockResolvedValueOnce(sample({ id: 's1' })).mockResolvedValueOnce(sample({ id: 's2' }));
    extract.mockRejectedValueOnce(new Error('vision down'));
    const r = await readAllSamples('t1');
    expect(r).toEqual({ read: 1, failed: 1, remaining: 0 });
  });

  it('reads at most READ_ALL_LIMIT samples per call, unread ones first, and says how many are left', async () => {
    // 60 δείγματα, τα 5 τελευταία αδιάβαστα: μία κλήση δεν φτάνει, και η επόμενη πρέπει να προχωρά.
    const rows = [
      ...Array.from({ length: 55 }, (_, i) => ({ id: `r${i}`, status: 'READ' })),
      ...Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, status: 'PENDING' })),
    ];
    db.templateSample.findMany.mockResolvedValue(rows);
    const r = await readAllSamples('t1');
    expect(r).toEqual({ read: READ_ALL_LIMIT, failed: 0, remaining: rows.length - READ_ALL_LIMIT });
    // Τα PENDING πήγαν πρώτα — κανένα δεν έμεινε πίσω από 55 ήδη διαβασμένα.
    const asked = db.templateSample.findUnique.mock.calls.map((c) => c[0].where.id);
    expect(asked.slice(0, 5)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4']);
  });

  it('refuses a new sample once the template is full', async () => {
    db.templateSample.count.mockResolvedValue(MAX_SAMPLES_PER_TEMPLATE);
    await expect(addSample('t1', { buffer: PDF, fileName: 'a.pdf' })).rejects.toMatchObject({ code: 'too_many' });
    expect(bunny.bunnyUploadPrivate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- verify + score

describe('verifySample', () => {
  it('stores the confirmation, scores it and refreshes the template training score', async () => {
    db.templateSample.findUnique.mockResolvedValue(sample({ status: 'READ', lastResult: { total: value(124), num: value('17') } }));
    db.templateSample.findMany.mockResolvedValue([
      { status: 'VERIFIED', expected: { total: 124, num: '17' }, lastResult: { total: value(124), num: value('17') } },
    ]);

    const r = await verifySample('s1', { total: 124, num: '17' });

    const data = db.templateSample.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: 'VERIFIED', score: 1 });
    expect(data.expected).toEqual({ total: 124, num: '17' });

    // Το πρότυπο μαθαίνει τον βαθμό του από ΟΛΑ τα επιβεβαιωμένα δείγματα.
    expect(db.extractionTemplate.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 't1' }, data: { trainingScore: 1, verifiedSamples: 1 },
    }));
    expect(r.training.gate).toEqual({ ok: false, reason: 'need_samples' });  // 1 < minTrainingSamples 3
  });

  it('scores 0,5 when the reader disagrees with the user on one of two fields', async () => {
    db.templateSample.findUnique.mockResolvedValue(sample({ status: 'READ', lastResult: { total: value(124), num: value('17') } }));
    await verifySample('s1', { total: 130, num: '17' });
    expect(db.templateSample.update.mock.calls[0][0].data.score).toBe(0.5);
  });
});

describe('refreshTrainingScore', () => {
  it('averages only the REQUIRED fields over the VERIFIED samples', async () => {
    db.templateSample.findMany.mockResolvedValue([
      { status: 'VERIFIED', expected: { total: 124, num: 'X' }, lastResult: { total: value(124), num: value('17') } },
      { status: 'VERIFIED', expected: { total: 200, num: 'Y' }, lastResult: { total: value(124), num: value('17') } },
      { status: 'READ', expected: null, lastResult: { total: value(1) } },
    ]);
    const r = await refreshTrainingScore('t1');
    expect(r.verifiedSamples).toBe(2);
    expect(r.trainingScore).toBe(0.5);                 // «total» 1/2· «num» δεν είναι required
    expect(r.perField.num).toEqual({ ok: 0, total: 2, score: 0 });
  });
});

// ---------------------------------------------------------------- delete

describe('deleteSample', () => {
  it('removes the stored file and the row, then refreshes the score', async () => {
    await deleteSample('s1');
    expect(bunny.bunnyDelete).toHaveBeenCalledWith(['templates/t1/samples/a.pdf']);
    expect(db.templateSample.delete).toHaveBeenCalledWith({ where: { id: 's1' } });
    expect(db.extractionTemplate.update).toHaveBeenCalled();
  });

  it('refuses to delete the sample the regions were drawn on', async () => {
    db.templateSample.findUnique.mockResolvedValue(sample({ isPrimary: true }));
    await expect(deleteSample('s1')).rejects.toMatchObject({ code: 'primary' });
    expect(bunny.bunnyDelete).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- from a document

describe('sampleFromDocument', () => {
  it('copies the document file into a sample and fingerprints it from the OCR it already has', async () => {
    db.ocrDocument.findUnique.mockResolvedValue({
      id: 'doc1', fileName: 'ΤΙΜ 18.pdf', storageKey: 'ocr/doc1.pdf', mimeType: 'application/pdf',
      rawText: 'ΚΑΠΑΛΙΝΕ ΜΕΤΑΦΟΡΙΚΗ ΝΑΥΛΟΣ', issuerAfm: '999863881',
      document: { issuer: { name: 'ΚΑΠΑΛΙΝΕ ΑΕ', vat: '999863881' } },
    });
    await sampleFromDocument('t1', 'doc1', 'u1');

    expect(bunny.bunnyDownload).toHaveBeenCalledWith('ocr/doc1.pdf');
    const data = db.templateSample.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ templateId: 't1', fileName: 'ΤΙΜ 18.pdf', status: 'PENDING' });
    expect(data.fingerprint).toMatchObject({ afm: '999863881', issuer: 'ΚΑΠΑΛΙΝΕ ΑΕ' });
  });

  it('refuses a document that does not exist', async () => {
    db.ocrDocument.findUnique.mockResolvedValue(null);
    await expect(sampleFromDocument('t1', 'nope')).rejects.toMatchObject({ code: 'not_found' });
  });
});

// ---------------------------------------------------------------- list + fingerprint

describe('listSamples / primaryFingerprint', () => {
  it('lists the rows the training table needs, newest last', async () => {
    db.templateSample.findMany.mockResolvedValue([sample({ id: 's1' }), sample({ id: 's2', isPrimary: true })]);
    const rows = await listSamples('t1');
    expect(rows.map((r) => r.id)).toEqual(['s1', 's2']);
    expect(rows[1]).toMatchObject({ isPrimary: true, status: 'PENDING' });
    // Το fingerprint είναι εσωτερικό — δεν ταξιδεύει στο UI.
    expect(rows[0]).not.toHaveProperty('fingerprint');
  });

  it('hands back the template fingerprint, or null when there is none', async () => {
    expect(await primaryFingerprint('t1')).toMatchObject({ issuer: 'ΚΑΠΑΛΙΝΕ ΑΕ' });
    db.extractionTemplate.findUnique.mockResolvedValueOnce({ fingerprint: null });
    expect(await primaryFingerprint('t1')).toBeNull();
  });
});

// ---------------------------------------------------------------- το κύριο δείγμα ως δείγμα εκπαίδευσης

describe('adoptPrimarySample', () => {
  it('γράφει γραμμή που δείχνει στο ΙΔΙΟ αρχείο — δεν ξαναανεβάζει τίποτα', async () => {
    db.templateSample.findFirst.mockResolvedValue(null);
    const row = await adoptPrimarySample('t1', 'u1');

    expect(bunny.bunnyUploadPrivate).not.toHaveBeenCalled();
    const data = db.templateSample.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      templateId: 't1', storageKey: 'templates/t1/sample-abc.pdf', mimeType: 'application/pdf',
      pageCount: 2, status: 'PENDING', isPrimary: true, createdById: 'u1',
    });
    // Το αποτύπωμα του προτύπου είναι ήδη αυτού του αρχείου — καμία νέα ανάγνωση.
    expect(data.fingerprint).toMatchObject({ issuer: 'ΚΑΠΑΛΙΝΕ ΑΕ' });
    expect(bunny.bunnyDownload).not.toHaveBeenCalled();
    expect(row.isPrimary).toBe(true);
  });

  it('είναι ιδεμποτεντική: δεύτερο πάτημα δεν φτιάχνει δεύτερη γραμμή', async () => {
    db.templateSample.findFirst.mockResolvedValue(sample({ id: 'sp', isPrimary: true }));
    const row = await adoptPrimarySample('t1');
    expect(db.templateSample.create).not.toHaveBeenCalled();
    expect(row.id).toBe('sp');
  });

  it('χτίζει το αποτύπωμα από τα bytes όταν το πρότυπο δεν έχει', async () => {
    db.templateSample.findFirst.mockResolvedValue(null);
    db.extractionTemplate.findUnique.mockResolvedValue({ ...TEMPLATE, fingerprint: null });
    await adoptPrimarySample('t1');
    expect(bunny.bunnyDownload).toHaveBeenCalledWith('templates/t1/sample-abc.pdf');
    expect(db.templateSample.create.mock.calls[0][0].data.fingerprint).toMatchObject({ words: expect.any(Array) });
  });

  it('αρνείται όταν δεν υπάρχει κύριο δείγμα', async () => {
    db.templateSample.findFirst.mockResolvedValue(null);
    db.extractionTemplate.findUnique.mockResolvedValue({ ...TEMPLATE, sampleStorageKey: null });
    await expect(adoptPrimarySample('t1')).rejects.toMatchObject({ code: 'no_sample' } satisfies Partial<SampleError>);
  });

  it('σέβεται το ταβάνι δειγμάτων', async () => {
    db.templateSample.findFirst.mockResolvedValue(null);
    db.templateSample.count.mockResolvedValue(MAX_SAMPLES_PER_TEMPLATE);
    await expect(adoptPrimarySample('t1')).rejects.toMatchObject({ code: 'too_many' } satisfies Partial<SampleError>);
  });
});
