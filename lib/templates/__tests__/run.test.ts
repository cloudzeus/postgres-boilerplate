import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FieldValue, TemplateValueType } from '../schema';

const db = vi.hoisted(() => ({
  ocrDocument: { findUnique: vi.fn(), update: vi.fn() },
  extractionTemplate: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  templateRun: { create: vi.fn(), findMany: vi.fn() },
  ocrInvoiceItem: { deleteMany: vi.fn(), createMany: vi.fn() },
  // The runner hands `$transaction` an ARRAY of promises (prisma batch form).
  $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
}));
const extract = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
const notify = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/bunny', () => ({ bunnyDownload: vi.fn(async () => Buffer.from('x')) }));
vi.mock('../extract', () => ({ extractTemplateFields: (...a: unknown[]) => extract(...a) }));
vi.mock('@/lib/ocr/post-softone', () => ({ postDocumentToSoftone: (...a: unknown[]) => post(...a) }));
vi.mock('../notify', () => ({ sendRuleNotifications: (...a: unknown[]) => notify(...a) }));

import { findTemplateForVat, runTemplateOnDocument } from '../run';

// ---------------------------------------------------------------- fixtures

const field = (over: Record<string, unknown>) => ({
  id: `f_${over.key}`, templateId: 't1', key: 'k', label: 'K', kind: 'SINGLE', valueType: 'TEXT' as TemplateValueType,
  color: '#0078D4', region: { page: 0, bbox: [0, 0, 0.1, 0.1] }, columns: null, aiHint: null, required: false, order: 0, ...over,
});

const TOTAL = field({ key: 'total', label: 'Σύνολο', valueType: 'CURRENCY', required: true, order: 0 });
const NOTE = field({ key: 'note', label: 'Σημείωση', valueType: 'TEXT', order: 1 });

const CONDITION = {
  id: 'c1', templateId: 't1', name: 'big', order: 0, isActive: true, logic: 'AND',
  clauses: [{ fieldKey: 'total', op: 'gt', value: '100' }],
  actions: [
    { type: 'FLAG_REVIEW', params: { reason: 'μεγάλο ποσό' } },
    { type: 'NOTIFY', params: { subject: 'S' } },
  ],
};

const MAPPING = { id: 'm1', templateId: 't1', name: 'default', target: 'INVOICE', isDefault: true, rows: [{ fieldKey: 'total', invoiceKey: 'totalAmount' }] };

const template = (over: Record<string, unknown> = {}) => ({
  id: 't1', slug: 'promitheftis', name: 'Προμηθευτής', version: 2, mode: 'MANUAL', notifyEmails: 'a@x.gr',
  fields: [TOTAL, NOTE], mappings: [MAPPING], conditions: [CONDITION], ...over,
});

const doc = (over: Record<string, unknown> = {}) => ({
  id: 'd1', fileName: 'a.pdf', storageKey: 'ocr/a.pdf', mimeType: 'application/pdf',
  extractedData: { invoiceNumber: '7' }, items: [], ...over,
});

const value = (v: FieldValue['value'], source: FieldValue['source'] = 'vision'): FieldValue =>
  ({ raw: v == null ? null : String(v), value: v, confidence: 1, source, page: 0, bbox: [0, 0, 0.1, 0.1], color: '#0078D4' });

const extractResult = (values: Record<string, FieldValue>) => ({ values, model: 'gpt', tokensUsed: 42, errors: [] });

/** Last `templateRun.create` payload. */
const runData = () => db.templateRun.create.mock.calls.at(-1)![0].data as Record<string, any>;
/** Every `ocrDocument.update` payload. */
const docUpdates = () => db.ocrDocument.update.mock.calls.map((c) => c[0].data as Record<string, any>);

beforeEach(() => {
  for (const m of [db.ocrDocument.findUnique, db.ocrDocument.update, db.extractionTemplate.findUnique, db.extractionTemplate.findFirst,
    db.extractionTemplate.update, db.templateRun.create, db.templateRun.findMany, db.ocrInvoiceItem.deleteMany,
    db.ocrInvoiceItem.createMany, db.$transaction, extract, post, notify]) m.mockReset();
  db.$transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
  db.ocrDocument.update.mockResolvedValue({});
  db.extractionTemplate.update.mockResolvedValue({});
  db.templateRun.create.mockResolvedValue({ id: 'r1' });
  db.templateRun.findMany.mockResolvedValue([]);
  db.ocrInvoiceItem.deleteMany.mockResolvedValue({ count: 0 });
  db.ocrInvoiceItem.createMany.mockResolvedValue({ count: 0 });
  post.mockResolvedValue({ ref: 'OCR-1' });
  notify.mockResolvedValue([]);
});

const load = (t: Record<string, unknown>, d: Record<string, unknown> = doc()) => {
  db.ocrDocument.findUnique.mockResolvedValue(d);
  db.extractionTemplate.findUnique.mockResolvedValue(t);
};

// ---------------------------------------------------------------- tests

describe('runTemplateOnDocument', () => {
  it('MANUAL: stores an EXTRACTED run without touching extractedData, writes reviewFlags and bumps timesUsed', async () => {
    load(template());
    extract.mockResolvedValue(extractResult({ total: value(150), note: value('x') }));

    const out = await runTemplateOnDocument({ documentId: 'd1', templateId: 't1', trigger: 'manual' });

    expect(out.status).toBe('EXTRACTED');
    expect(runData().status).toBe('EXTRACTED');
    expect(runData().trigger).toBe('manual');
    expect(runData().mappingName).toBe('');
    expect(runData().model).toBe('gpt');
    expect(runData().tokensUsed).toBe(42);
    // No projection in MANUAL mode → the document's extractedData is never rewritten.
    expect(docUpdates().some((d) => 'extractedData' in d)).toBe(false);
    expect(docUpdates().at(-1)!.reviewFlags).toMatchObject({ templateSlug: 'promitheftis', templateName: 'Προμηθευτής', runStatus: 'EXTRACTED', runId: 'r1' });
    expect(db.extractionTemplate.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { timesUsed: { increment: 1 } } });
  });

  it('SEMI_AUTO: REVIEW, projects the mapping onto extractedData, flags the matched rule and notifies once per rule', async () => {
    load(template({ mode: 'SEMI_AUTO' }));
    extract.mockResolvedValue(extractResult({ total: value(150), note: value('x') }));
    db.templateRun.findMany.mockResolvedValue([{ flags: { notified: ['cX'] } }, { flags: null }]);

    const out = await runTemplateOnDocument({ documentId: 'd1', templateId: 't1', trigger: 'upload' });

    expect(out.status).toBe('REVIEW');
    expect(out.flags.review).toContain('μεγάλο ποσό');
    const projected = docUpdates().find((d) => 'extractedData' in d)!.extractedData;
    expect(projected.totalAmount).toBe(150);
    expect(projected.invoiceNumber).toBe('7'); // untouched keys survive the merge
    // No line mapping → items are not rebuilt.
    expect(db.ocrInvoiceItem.deleteMany).not.toHaveBeenCalled();
    // NOTIFY throttling looks at every previous run of the document.
    expect(db.templateRun.findMany).toHaveBeenCalledWith({ where: { documentId: 'd1' }, select: { flags: true } });
    expect(notify.mock.calls[0][0]).toMatchObject({
      docId: 'd1', templateName: 'Προμηθευτής', defaultEmails: 'a@x.gr',
      notifications: [{ conditionId: 'c1', subject: 'S' }],
      alreadyNotified: ['cX'],
    });
    expect(runData().flags).toMatchObject({ review: ['μεγάλο ποσό'], notified: [] });
  });

  it('AUTO: a missing required field blocks the run and nothing is posted', async () => {
    load(template({ mode: 'AUTO' }));
    extract.mockResolvedValue(extractResult({ total: value(null, 'none'), note: value('x') }));

    const out = await runTemplateOnDocument({ documentId: 'd1', templateId: 't1', trigger: 'upload' });

    expect(out.status).toBe('BLOCKED');
    expect(post).not.toHaveBeenCalled();
    expect(out.flags.blocked).toEqual(['Λείπει υποχρεωτικό πεδίο «Σύνολο»']);
    expect(out.flags.review).toContain('Λείπει υποχρεωτικό πεδίο «Σύνολο»');
  });

  it('AUTO: posts through the shared poster and rebuilds the invoice items the projection produced', async () => {
    const lines = field({ key: 'lines', label: 'Γραμμές', kind: 'TABLE', columns: [{ key: 'desc', label: 'Περιγραφή', valueType: 'TEXT' }], order: 2 });
    load(template({
      mode: 'AUTO',
      conditions: [],
      fields: [TOTAL, NOTE, lines],
      mappings: [{ ...MAPPING, rows: [{ fieldKey: 'total', invoiceKey: 'totalAmount' }, { fieldKey: 'lines.desc', invoiceKey: 'items.name' }] }],
    }));
    extract.mockResolvedValue(extractResult({ total: value(20), note: value('x'), lines: value([{ desc: 'Α' }, { desc: 'Β' }]) }));

    const out = await runTemplateOnDocument({ documentId: 'd1', templateId: 't1', trigger: 'upload' });

    expect(out.status).toBe('POSTED');
    expect(post).toHaveBeenCalledWith('d1');
    expect(runData().mappingName).toBe('default');
    expect(db.ocrInvoiceItem.deleteMany).toHaveBeenCalledWith({ where: { documentId: 'd1' } });
    expect(db.ocrInvoiceItem.createMany).toHaveBeenCalledWith({
      data: [
        { rowIndex: 0, code: null, name: 'Α', quantity: null, price: null, discount: null, vatRate: null, total: null, documentId: 'd1' },
        { rowIndex: 1, code: null, name: 'Β', quantity: null, price: null, discount: null, vatRate: null, total: null, documentId: 'd1' },
      ],
    });
    // The document is written before the posting call, so the poster sees the mapped data.
    expect(db.$transaction.mock.invocationCallOrder[0]).toBeLessThan(post.mock.invocationCallOrder[0]);
  });

  it('AUTO: a failing post yields a FAILED run with the reason, not an exception', async () => {
    load(template({ mode: 'AUTO', conditions: [] }));
    extract.mockResolvedValue(extractResult({ total: value(20), note: value('x') }));
    post.mockRejectedValue(new Error('SoftOne down'));

    const out = await runTemplateOnDocument({ documentId: 'd1', templateId: 't1', trigger: 'upload' });

    expect(out.status).toBe('FAILED');
    expect(out.error).toBe('Ανάρτηση: SoftOne down');
    expect(runData().status).toBe('FAILED');
    expect(runData().error).toBe('Ανάρτηση: SoftOne down');
  });

  it('a failing extraction is non-fatal: FAILED run with the error and reviewFlags, resolves', async () => {
    load(template({ mode: 'AUTO' }));
    extract.mockRejectedValue(new Error('vision exploded'));

    const out = await runTemplateOnDocument({ documentId: 'd1', templateId: 't1', trigger: 'reextract' });

    expect(out.status).toBe('FAILED');
    expect(out.error).toBe('vision exploded');
    expect(runData()).toMatchObject({ status: 'FAILED', trigger: 'reextract', error: 'vision exploded', mappingName: '' });
    expect(docUpdates().at(-1)!.reviewFlags).toMatchObject({ runStatus: 'FAILED', runId: 'r1' });
    expect(post).not.toHaveBeenCalled();
  });
});

describe('findTemplateForVat', () => {
  it('queries the ACTIVE template for a 9-digit ΑΦΜ and ignores anything else', async () => {
    db.extractionTemplate.findFirst.mockResolvedValue({ id: 't9' });
    await expect(findTemplateForVat('EL 123456789')).resolves.toBe('t9');
    expect(db.extractionTemplate.findFirst).toHaveBeenCalledWith({
      where: { vatNumber: '123456789', status: 'ACTIVE' },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });

    db.extractionTemplate.findFirst.mockClear();
    await expect(findTemplateForVat('12345')).resolves.toBeNull();
    await expect(findTemplateForVat(null)).resolves.toBeNull();
    expect(db.extractionTemplate.findFirst).not.toHaveBeenCalled();

    db.extractionTemplate.findFirst.mockResolvedValue(null);
    await expect(findTemplateForVat('123456789')).resolves.toBeNull();
  });
});
