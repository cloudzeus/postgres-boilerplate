// lib/templates/__tests__/samples-routes.test.ts — τα routes των δειγμάτων εκπαίδευσης και η
// πύλη ενεργοποίησης. Καλούνται ως handlers, με mocked prisma / rbac / βιβλιοθήκη δειγμάτων.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db, rbac, samples, audit } = vi.hoisted(() => ({
  db: {
    extractionTemplate: { findUnique: vi.fn(), update: vi.fn() },
    templateSample: { findUnique: vi.fn() },
  },
  rbac: { requirePermission: vi.fn() },
  samples: {
    addSample: vi.fn(), listSamples: vi.fn(), readSample: vi.fn(), readAllSamples: vi.fn(),
    refreshTrainingScore: vi.fn(), sampleFromDocument: vi.fn(), verifySample: vi.fn(),
    deleteSample: vi.fn(), toSampleDto: vi.fn((s: unknown) => s), SAMPLES_PER_REQUEST: 20,
  },
  audit: { logAudit: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/rbac', () => rbac);
vi.mock('@/lib/audit', () => audit);
vi.mock('@/lib/templates/samples', () => samples);

import { GET as listRoute, POST as uploadRoute } from '@/app/api/admin/ocr/templates/[id]/samples/route';
import { DELETE as deleteRoute, PATCH as verifyRoute } from '@/app/api/admin/ocr/templates/[id]/samples/[sampleId]/route';
import { POST as fromDocRoute } from '@/app/api/admin/ocr/templates/[id]/samples/from-document/route';
import { PATCH as patchTemplate } from '@/app/api/admin/ocr/templates/[id]/route';
import { SampleError } from '../sample';

const USER = { id: 'u1', email: 'a@b.gr', role: { key: 'ADMIN' }, permissionKeys: new Set(['ocr.post']) };
const ctx = (id = 't1', sampleId = 's1') => ({ params: Promise.resolve({ id, sampleId }) });

const TRAINING = { trainingScore: 1, verifiedSamples: 3, perField: {}, gate: { ok: true } };

const TEMPLATE = {
  id: 't1', slug: 'kapaline', name: 'Καπαλινέ', mode: 'SEMI_AUTO', status: 'DRAFT', version: 1,
  sampleStorageKey: 'templates/t1/sample.pdf', sampleMimeType: 'application/pdf', samplePageCount: 1,
  sampleThumbUrl: null, department: null, vatNumber: null, traderTrdr: null, supplierName: null,
  notifyEmails: null, timesUsed: 0, createdAt: new Date(), updatedAt: new Date(),
  minTrainingScore: 0.9, minTrainingSamples: 3, trainingScore: null, verifiedSamples: 0,
  fields: [{ id: 'f1', templateId: 't1', key: 'total', label: 'Σύνολο', kind: 'SINGLE', valueType: 'CURRENCY', color: '#111', region: { page: 0, bbox: [0, 0, 1, 1] }, columns: null, aiHint: null, required: true, order: 0, lastGood: null }],
  mappings: [{ id: 'm1', name: 'default', target: 'INVOICE', isDefault: true, rows: [] }],
  conditions: [],
  _count: { runs: 0, samples: 0 },
};

const upload = (files: File[]) => {
  const fd = new FormData();
  for (const f of files) fd.append('files', f);
  return new Request('http://localhost/x', { method: 'POST', body: fd });
};
const pdfFile = (name: string) => new File([Buffer.from('%PDF-1.4')], name, { type: 'application/pdf' });
const json = (body: unknown) => new Request('http://localhost/x', { method: 'PATCH', body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  rbac.requirePermission.mockResolvedValue(USER);
  samples.listSamples.mockResolvedValue([{ id: 's1' }]);
  samples.addSample.mockImplementation(async (_id: string, i: { fileName: string }) => ({ id: `s_${i.fileName}`, fileName: i.fileName }));
  samples.refreshTrainingScore.mockResolvedValue(TRAINING);
  samples.verifySample.mockResolvedValue({ sample: { id: 's1', score: 1 }, training: TRAINING });
  samples.deleteSample.mockResolvedValue({ training: TRAINING });
  samples.sampleFromDocument.mockResolvedValue({ id: 's9' });
  db.templateSample.findUnique.mockResolvedValue({ id: 's1', templateId: 't1', isPrimary: false });
  db.extractionTemplate.findUnique.mockResolvedValue(TEMPLATE);
  db.extractionTemplate.update.mockResolvedValue(TEMPLATE);
});

// ---------------------------------------------------------------- upload + list

describe('GET/POST samples', () => {
  it('lists the samples of the template', async () => {
    const res = await listRoute(new Request('http://localhost/x'), ctx());
    expect(await res.json()).toEqual({ samples: [{ id: 's1' }] });
    expect(rbac.requirePermission).toHaveBeenCalledWith('ocr.read');
  });

  it('adds every uploaded file and refreshes the score once', async () => {
    const res = await uploadRoute(upload([pdfFile('a.pdf'), pdfFile('b.pdf')]), ctx());
    const body = await res.json();
    expect(body.samples.map((s: { fileName: string }) => s.fileName)).toEqual(['a.pdf', 'b.pdf']);
    expect(body.training).toEqual(TRAINING);
    expect(samples.refreshTrainingScore).toHaveBeenCalledTimes(1);
    expect(rbac.requirePermission).toHaveBeenCalledWith('ocr.categorize');
  });

  it('keeps the good files when one of them is rejected', async () => {
    samples.addSample.mockRejectedValueOnce(new SampleError('unsupported_type'));
    const res = await uploadRoute(upload([pdfFile('bad.txt'), pdfFile('ok.pdf')]), ctx());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.failed).toEqual([{ fileName: 'bad.txt', error: 'unsupported_type' }]);
    expect(body.samples).toHaveLength(1);
  });

  it('refuses an empty body and more files than one request may carry', async () => {
    expect((await uploadRoute(upload([]), ctx())).status).toBe(400);
    const many = Array.from({ length: 21 }, (_, i) => pdfFile(`${i}.pdf`));
    const res = await uploadRoute(upload(many), ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('too_many');
    expect(samples.addSample).not.toHaveBeenCalled();
  });

  it('gives up entirely when the template does not exist', async () => {
    samples.addSample.mockRejectedValue(new SampleError('not_found'));
    const res = await uploadRoute(upload([pdfFile('a.pdf')]), ctx());
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------- verify + delete

describe('PATCH/DELETE one sample', () => {
  it('stores the confirmation and hands back the refreshed training summary', async () => {
    const res = await verifyRoute(json({ expected: { total: 124 } }), ctx());
    expect(await res.json()).toEqual({ sample: { id: 's1', score: 1 }, training: TRAINING });
    expect(samples.verifySample).toHaveBeenCalledWith('s1', { total: 124 });
  });

  it('refuses a sample that belongs to another template', async () => {
    db.templateSample.findUnique.mockResolvedValue({ id: 's1', templateId: 'OTHER' });
    expect((await verifyRoute(json({ expected: {} }), ctx())).status).toBe(404);
    expect((await deleteRoute(new Request('http://localhost/x', { method: 'DELETE' }), ctx())).status).toBe(404);
    expect(samples.verifySample).not.toHaveBeenCalled();
    expect(samples.deleteSample).not.toHaveBeenCalled();
  });

  it('rejects a body that is not a map of expected values', async () => {
    const res = await verifyRoute(json({ expected: 'ολα σωστα' }), ctx());
    expect(res.status).toBe(400);
  });

  it('answers 409 when the primary sample is the one being deleted', async () => {
    samples.deleteSample.mockRejectedValue(new SampleError('primary'));
    const res = await deleteRoute(new Request('http://localhost/x', { method: 'DELETE' }), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('primary');
  });
});

describe('POST samples/from-document', () => {
  it('copies the document and refreshes the score', async () => {
    const res = await fromDocRoute(new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ documentId: 'doc1' }) }), ctx());
    expect(await res.json()).toEqual({ sample: { id: 's9' }, training: TRAINING });
    expect(samples.sampleFromDocument).toHaveBeenCalledWith('t1', 'doc1', 'u1');
  });

  it('answers 404 for a document that does not exist', async () => {
    samples.sampleFromDocument.mockRejectedValue(new SampleError('not_found'));
    const res = await fromDocRoute(new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ documentId: 'nope' }) }), ctx());
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------- the activation gate

describe('PATCH template — training gate', () => {
  it('refuses ACTIVE while too few samples have been confirmed', async () => {
    const res = await patchTemplate(json({ status: 'ACTIVE' }), ctx());
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'training_gate', reason: 'need_samples' });
    expect(body.message).toContain('3');
    expect(db.extractionTemplate.update).not.toHaveBeenCalled();
  });

  it('refuses ACTIVE when the score is below the threshold', async () => {
    db.extractionTemplate.findUnique.mockResolvedValue({ ...TEMPLATE, verifiedSamples: 4, trainingScore: 0.5 });
    const res = await patchTemplate(json({ status: 'ACTIVE' }), ctx());
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: 'training_gate', reason: 'low_score' });
  });

  it('lets a trained template through', async () => {
    db.extractionTemplate.findUnique.mockResolvedValue({ ...TEMPLATE, verifiedSamples: 3, trainingScore: 0.95 });
    const res = await patchTemplate(json({ status: 'ACTIVE' }), ctx());
    expect(res.status).toBe(200);
    expect(db.extractionTemplate.update).toHaveBeenCalled();
  });

  it('switches the gate off when the template asks for zero samples — in the same request', async () => {
    const res = await patchTemplate(json({ status: 'ACTIVE', minTrainingSamples: 0 }), ctx());
    expect(res.status).toBe(200);
    expect(db.extractionTemplate.update.mock.calls[0][0].data).toMatchObject({ status: 'ACTIVE', minTrainingSamples: 0 });
  });

  it('still refuses a template that is not ready at all, before it ever looks at training', async () => {
    db.extractionTemplate.findUnique.mockResolvedValue({ ...TEMPLATE, sampleStorageKey: null, minTrainingSamples: 0 });
    const res = await patchTemplate(json({ status: 'ACTIVE' }), ctx());
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: 'not_ready' });
  });
});
