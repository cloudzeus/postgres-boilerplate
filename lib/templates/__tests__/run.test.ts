import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FieldValue, TemplateValueType } from '../schema';

const db = vi.hoisted(() => ({
  ocrDocument: { findUnique: vi.fn(), update: vi.fn() },
  extractionTemplate: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  templateRun: { create: vi.fn(), findMany: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
  ocrInvoiceItem: { deleteMany: vi.fn(), createMany: vi.fn(), findMany: vi.fn() },
  // The runner hands `$transaction` an ARRAY of promises (prisma batch form).
  $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
}));
const extract = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
const notify = vi.hoisted(() => vi.fn());
const matchItems = vi.hoisted(() => vi.fn());
/** Stand-in for the real PostError: the runner branches on `instanceof`, so the class must be shared. */
const PostError = vi.hoisted(
  () =>
    class PostError extends Error {
      constructor(public code: string, message: string) {
        super(message);
        this.name = 'PostError';
      }
    },
);

vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/bunny', () => ({ bunnyDownload: vi.fn(async () => Buffer.from('x')) }));
vi.mock('../extract', () => ({ extractTemplateFields: (...a: unknown[]) => extract(...a) }));
vi.mock('@/lib/ocr/post-softone', () => ({
  PostError,
  postDocumentToSoftone: (...a: unknown[]) => post(...a),
  // The runner turns a PostError code into this Greek text; the real module owns the wording.
  POST_ERROR_TEXT: { no_category: 'Δεν έχει οριστεί κατηγορία εγγράφου', not_completed: 'Το έγγραφο δεν έχει ολοκληρωθεί', not_found: 'Το έγγραφο δεν βρέθηκε', already_posted: 'Έχει ήδη καταχωριστεί στο SoftOne' },
}));
vi.mock('../notify', () => ({ sendRuleNotifications: (...a: unknown[]) => notify(...a) }));
vi.mock('@/lib/ocr/softone-match', () => ({ matchDocItems: (...a: unknown[]) => matchItems(...a) }));

import { findTemplateForVat, finalizeRunEdit, rereadField, runMatchingTemplate, runTemplateOnDocument } from '../run';

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
  extractedData: { invoiceNumber: '7' }, _count: { items: 0 }, ...over,
});

const value = (v: FieldValue['value'], source: FieldValue['source'] = 'vision'): FieldValue =>
  ({ raw: v == null ? null : String(v), value: v, confidence: 1, source, page: 0, bbox: [0, 0, 0.1, 0.1], color: '#0078D4' });

const extractResult = (values: Record<string, FieldValue>, over: Record<string, unknown> = {}) =>
  ({ values, model: 'gpt', tokensUsed: 42, errors: [] as { fieldKey: string; message: string }[], pageCount: 1, ...over });

/** Last `templateRun.create` payload. */
const runData = () => db.templateRun.create.mock.calls.at(-1)![0].data as Record<string, any>;
/** Every `ocrDocument.update` payload. */
const docUpdates = () => db.ocrDocument.update.mock.calls.map((c) => c[0].data as Record<string, any>);

beforeEach(() => {
  for (const m of [db.ocrDocument.findUnique, db.ocrDocument.update, db.extractionTemplate.findUnique, db.extractionTemplate.findFirst,
    db.extractionTemplate.update, db.templateRun.create, db.templateRun.findMany, db.templateRun.update,
    db.templateRun.findUnique, db.templateRun.findFirst,
    db.ocrInvoiceItem.deleteMany, db.ocrInvoiceItem.createMany, db.ocrInvoiceItem.findMany, db.$transaction, extract, post, notify, matchItems]) m.mockReset();
  db.$transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
  db.ocrDocument.update.mockResolvedValue({});
  db.extractionTemplate.update.mockResolvedValue({});
  db.templateRun.create.mockResolvedValue({ id: 'r1' });
  db.templateRun.findMany.mockResolvedValue([]);
  db.templateRun.update.mockResolvedValue({});
  db.templateRun.findFirst.mockResolvedValue({ id: 'r1' });
  db.ocrInvoiceItem.deleteMany.mockResolvedValue({ count: 0 });
  db.ocrInvoiceItem.createMany.mockResolvedValue({ count: 0 });
  db.ocrInvoiceItem.findMany.mockResolvedValue([]);
  matchItems.mockResolvedValue({ matched: 0, total: 0 });
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

  it('SEMI_AUTO: REVIEW, projects the mapping onto the document, flags the matched rule and notifies once per rule', async () => {
    load(template({ mode: 'SEMI_AUTO' }));
    extract.mockResolvedValue(extractResult({ total: value(150), note: value('x') }));
    db.templateRun.findMany.mockResolvedValue([{ flags: { notified: ['cX'] } }, { flags: null }]);

    const out = await runTemplateOnDocument({ documentId: 'd1', templateId: 't1', trigger: 'upload' });

    expect(out.status).toBe('REVIEW');
    expect(out.flags.review).toContain('μεγάλο ποσό');
    const saved = docUpdates().find((d) => 'document' in d)!;
    expect(saved.document.totals.total).toBe(150);
    expect(saved.document.type.number).toBe('7');       // untouched paths survive the projection
    // The legacy projection is written from the same document, in the same transaction.
    expect(saved.extractedData.totalAmount).toBe(150);
    expect(saved.extractedData.invoiceNumber).toBe('7');
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

  it('persists the run output envelope (v3) with the projected document', async () => {
    load(template({ mode: 'SEMI_AUTO', conditions: [] }));
    extract.mockResolvedValue(extractResult({ total: value(150), note: value('x') }));

    await runTemplateOnDocument({ documentId: 'd1', templateId: 't1', trigger: 'upload' });

    const output = runData().output;
    expect(output).toMatchObject({ template: 'promitheftis', version: 3, file: 'a.pdf', documentId: 'd1' });
    expect(output.document.totals.total).toBe(150);
    // One instant for both, so the downloaded JSON and the run card cannot claim different times.
    expect(output.extractedAt).toBe((runData().createdAt as Date).toISOString());
  });

  it('MANUAL stores the untouched document in the envelope — the run still has an output', async () => {
    load(template({ mode: 'MANUAL', conditions: [] }), doc({ extractedData: { invoiceNumber: '7', totalAmount: 11 } }));
    extract.mockResolvedValue(extractResult({ total: value(150), note: value('x') }));

    await runTemplateOnDocument({ documentId: 'd1', templateId: 't1', trigger: 'upload' });

    expect(runData().output.document.totals.total).toBe(11);
    expect(docUpdates().some((d) => 'document' in d)).toBe(false);
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
        expect.objectContaining({ rowIndex: 0, code: null, name: 'Α', quantity: null, price: null, discount: null, vatRate: null, total: null, documentId: 'd1' }),
        expect.objectContaining({ rowIndex: 1, code: null, name: 'Β', documentId: 'd1' }),
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

  it('AUTO: a PostError precondition is a BLOCK with a Greek reason, not a FAILED run', async () => {
    load(template({ mode: 'AUTO', conditions: [] }));
    extract.mockResolvedValue(extractResult({ total: value(20), note: value('x') }));
    post.mockRejectedValue(new PostError('no_category', 'Set a category before posting'));

    const out = await runTemplateOnDocument({ documentId: 'd1', templateId: 't1', trigger: 'upload' });

    expect(out.status).toBe('BLOCKED');
    expect(out.error).toBeNull();
    expect(out.flags.blocked).toEqual(['Δεν έχει οριστεί κατηγορία εγγράφου']);
    expect(out.flags.review).toContain('Δεν έχει οριστεί κατηγορία εγγράφου');
    expect(runData().status).toBe('BLOCKED');
  });

  it('AUTO: an already posted document is POSTED, not BLOCKED — and is never sent twice', async () => {
    load(template({ mode: 'AUTO', conditions: [] }));
    extract.mockResolvedValue(extractResult({ total: value(20), note: value('x') }));
    post.mockRejectedValue(new PostError('already_posted', 'Έχει ήδη καταχωριστεί στο SoftOne (90210)'));

    const out = await runTemplateOnDocument({ documentId: 'd1', templateId: 't1', trigger: 'upload' });

    expect(out.status).toBe('POSTED');
    expect(out.error).toBeNull();
    expect(out.flags.blocked).toEqual([]);
    expect(out.flags.review).toContain('Έχει ήδη καταχωριστεί στο SoftOne (90210)');
    expect(runData().status).toBe('POSTED');
  });

  it('SET_FIELD writes the template value as `rule` and the document path into the document', async () => {
    load(template({
      mode: 'SEMI_AUTO',
      conditions: [{
        ...CONDITION,
        actions: [
          { type: 'SET_FIELD', params: { fieldKey: 'note', value: 'από κανόνα' } },
          { type: 'SET_FIELD', params: { invoiceKey: 'customFields.po', value: 'PO-9' } },
        ],
      }],
    }));
    extract.mockResolvedValue(extractResult({ total: value(150), note: value('x') }));

    await runTemplateOnDocument({ documentId: 'd1', templateId: 't1', trigger: 'manual' });

    expect(runData().values.note).toMatchObject({ value: 'από κανόνα', source: 'rule' });
    const projected = docUpdates().find((d) => 'document' in d)!.document;
    // `po` comes from the rule; `note` is a SINGLE field no mapping row claims, so the projection
    // keeps it under its own field key rather than dropping what the template read.
    expect(projected.custom).toEqual({ po: 'PO-9', note: 'από κανόνα' });
    expect(docUpdates().find((d) => 'extractedData' in d)!.extractedData.customFields).toMatchObject({ po: 'PO-9' });
  });

  it('SWITCH_MAPPING picks the named mapping', async () => {
    const credit = { ...MAPPING, id: 'm2', name: 'credit', isDefault: false, rows: [{ fieldKey: 'total', invoiceKey: 'subtotal' }] };
    load(template({
      mode: 'SEMI_AUTO',
      mappings: [MAPPING, credit],
      conditions: [{ ...CONDITION, actions: [{ type: 'SWITCH_MAPPING', params: { mappingName: 'credit' } }] }],
    }));
    extract.mockResolvedValue(extractResult({ total: value(150), note: value('x') }));

    const out = await runTemplateOnDocument({ documentId: 'd1', templateId: 't1', trigger: 'manual' });

    expect(runData().mappingName).toBe('credit');
    expect(docUpdates().find((d) => 'extractedData' in d)!.extractedData.subtotal).toBe(150);
    expect(out.flags.review).toEqual([]);
  });

  it('SWITCH_MAPPING to a mapping that does not exist falls back to the default and says so', async () => {
    load(template({
      mode: 'SEMI_AUTO',
      conditions: [{ ...CONDITION, actions: [{ type: 'SWITCH_MAPPING', params: { mappingName: 'φάντασμα' } }] }],
    }));
    extract.mockResolvedValue(extractResult({ total: value(150), note: value('x') }));

    const out = await runTemplateOnDocument({ documentId: 'd1', templateId: 't1', trigger: 'manual' });

    expect(runData().mappingName).toBe('default');
    expect(out.flags.review).toContain('Ο κανόνας ζήτησε mapping «φάντασμα» που δεν υπάρχει');
  });

  it('a field the reader could not read becomes a review flag, and $pageCount comes from the extraction', async () => {
    load(template({
      mode: 'SEMI_AUTO',
      conditions: [{ ...CONDITION, id: 'c2', clauses: [{ fieldKey: '$pageCount', op: 'gt', value: '2' }], actions: [{ type: 'FLAG_REVIEW', params: { reason: 'πολυσέλιδο' } }] }],
    }));
    extract.mockResolvedValue(extractResult({ total: value(150), note: value(null, 'none') }, { errors: [{ fieldKey: 'note', message: 'boom' }], pageCount: 5 }));

    const out = await runTemplateOnDocument({ documentId: 'd1', templateId: 't1', trigger: 'upload' });

    expect(out.flags.review).toContain('Σφάλμα ανάγνωσης «Σημείωση»: boom');
    expect(out.flags.review).toContain('πολυσέλιδο');
    expect(typeof runData().durationMs).toBe('number');
    expect(runData().durationMs).toBeGreaterThanOrEqual(0);
  });

  it('the run row is written BEFORE the emails, and the notified ids are folded in afterwards', async () => {
    load(template({ mode: 'SEMI_AUTO' }));
    extract.mockResolvedValue(extractResult({ total: value(150), note: value('x') }));
    notify.mockResolvedValue(['c1']);

    await runTemplateOnDocument({ documentId: 'd1', templateId: 't1', trigger: 'upload' });

    expect(db.templateRun.create.mock.invocationCallOrder[0]).toBeLessThan(notify.mock.invocationCallOrder[0]);
    expect(runData().flags).toMatchObject({ notified: [] });
    expect(db.templateRun.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { flags: expect.objectContaining({ notified: ['c1'] }) } });
  });

  it('a failing bookkeeping write does not turn a finished run into a FAILED one', async () => {
    load(template());
    extract.mockResolvedValue(extractResult({ total: value(150), note: value('x') }));
    db.$transaction.mockRejectedValue(new Error('db gone'));

    const out = await runTemplateOnDocument({ documentId: 'd1', templateId: 't1', trigger: 'manual' });

    expect(out.status).toBe('EXTRACTED');
    expect(out.runId).toBe('r1');
    expect(db.templateRun.create).toHaveBeenCalledTimes(1);  // no second, FAILED, run for the same work
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

  it('a FAILED run carries the document\'s previous flags forward — a crash never un-blocks a posting', async () => {
    load(template({ mode: 'AUTO' }), doc({ reviewFlags: { review: ['προς έλεγχο'], blocked: ['χωρίς κατηγορία'], runStatus: 'BLOCKED', runId: 'r0' } }));
    extract.mockRejectedValue(new Error('vision exploded'));

    const out = await runTemplateOnDocument({ documentId: 'd1', templateId: 't1', trigger: 'reextract' });

    expect(out.status).toBe('FAILED');
    expect(out.flags).toMatchObject({ review: ['προς έλεγχο'], blocked: ['χωρίς κατηγορία'] });
    // The banner now says FAILED, but the reasons that blocked the posting are still on the document.
    expect(docUpdates().at(-1)!.reviewFlags).toMatchObject({
      runStatus: 'FAILED', runId: 'r1', review: ['προς έλεγχο'], blocked: ['χωρίς κατηγορία'],
    });
    // …and on the RUN row too, so the card can explain the block from the run it is showing.
    expect(runData().flags).toMatchObject({ review: ['προς έλεγχο'], blocked: ['χωρίς κατηγορία'], fields: {} });
  });

  it('a FAILED run on a document with no previous flags blocks nothing', async () => {
    load(template({ mode: 'AUTO' }));   // doc() has no reviewFlags at all
    extract.mockRejectedValue(new Error('vision exploded'));

    const out = await runTemplateOnDocument({ documentId: 'd1', templateId: 't1', trigger: 'upload' });

    expect(out.flags).toMatchObject({ review: [], blocked: [] });
    expect(docUpdates().at(-1)!.reviewFlags).toMatchObject({ review: [], blocked: [] });
  });
});

describe('flags.fields', () => {
  it('names the field behind a missing required value — review in SEMI_AUTO, blocked in AUTO', async () => {
    load(template({ mode: 'SEMI_AUTO', conditions: [] }));
    extract.mockResolvedValue(extractResult({ total: value(null), note: value('x') }));
    await runTemplateOnDocument({ documentId: 'd1', templateId: 't1', trigger: 'manual' });
    expect(runData().flags.fields).toEqual({ total: 'review' });

    db.templateRun.create.mockClear();
    load(template({ mode: 'AUTO', conditions: [] }));
    extract.mockResolvedValue(extractResult({ total: value(null), note: value('x') }));
    await runTemplateOnDocument({ documentId: 'd1', templateId: 't1', trigger: 'manual' });
    expect(runData().flags.fields).toEqual({ total: 'blocked' });
  });

  it('flags a field whose READ failed for review, and lets a block win over it', async () => {
    load(template({ mode: 'AUTO', conditions: [] }));
    extract.mockResolvedValue(extractResult(
      { total: value(null), note: value(null) },
      { errors: [{ fieldKey: 'note', message: 'κενή περιοχή' }, { fieldKey: 'total', message: 'κενή περιοχή' }] },
    ));

    await runTemplateOnDocument({ documentId: 'd1', templateId: 't1', trigger: 'manual' });

    // `note` is optional → only the read error; `total` is required AND unread → the harsher verdict.
    expect(runData().flags.fields).toEqual({ note: 'review', total: 'blocked' });
  });

  it('is empty when every field was read and a rule flagged the DOCUMENT rather than a field', async () => {
    load(template({ mode: 'SEMI_AUTO' }));
    extract.mockResolvedValue(extractResult({ total: value(150), note: value('x') }));

    await runTemplateOnDocument({ documentId: 'd1', templateId: 't1', trigger: 'manual' });

    expect(runData().flags.review).toContain('μεγάλο ποσό');   // the rule still spoke
    expect(runData().flags.fields).toEqual({});                 // but named no field
  });
});

describe('runMatchingTemplate', () => {
  it('resolves null when no template matches the ΑΦΜ', async () => {
    db.extractionTemplate.findFirst.mockResolvedValue(null);
    await expect(runMatchingTemplate('d1', '123456789', 'upload')).resolves.toBeNull();
    expect(db.templateRun.create).not.toHaveBeenCalled();
  });

  it('resolves null (never throws) when the runner itself rejects', async () => {
    db.extractionTemplate.findFirst.mockResolvedValue({ id: 't1' });
    db.ocrDocument.findUnique.mockResolvedValue(null);        // → runTemplateOnDocument throws 'document not found'
    db.extractionTemplate.findUnique.mockResolvedValue(template());
    await expect(runMatchingTemplate('d1', '123456789', 'upload')).resolves.toBeNull();
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

// ---------------------------------------------------------------- accuracy

const lineTemplate = (over: Record<string, unknown> = {}) => {
  const lines = field({ key: 'lines', label: 'Γραμμές', kind: 'TABLE', columns: [{ key: 'code', label: 'Κωδ', valueType: 'TEXT' }, { key: 'desc', label: 'Περιγραφή', valueType: 'TEXT' }], order: 2 });
  return template({
    mode: 'SEMI_AUTO', conditions: [], fields: [TOTAL, NOTE, lines],
    mappings: [{ ...MAPPING, rows: [{ fieldKey: 'lines.code', invoiceKey: 'items.code' }, { fieldKey: 'lines.desc', invoiceKey: 'items.name' }] }],
    ...over,
  });
};

describe('SoftOne matches survive a rebuild of the lines', () => {
  it('carries the columns of the row with the same rowIndex forward and re-runs the matcher', async () => {
    load(lineTemplate());
    db.ocrInvoiceItem.findMany.mockResolvedValue([
      { rowIndex: 0, code: 'A1', softoneMtrl: 111, softoneCode: 'S-1', softoneName: 'ΕΙΔΟΣ Α', softoneIsService: false, softoneMatchedBy: 'manual' },
      { rowIndex: 1, code: 'B2', softoneMtrl: 222, softoneCode: 'S-2', softoneName: 'ΕΙΔΟΣ Β', softoneIsService: false, softoneMatchedBy: 'code2' },
    ]);
    extract.mockResolvedValue(extractResult({ total: value(20), note: value('x'), lines: value([{ code: 'A1', desc: 'Α' }, { code: 'B2', desc: 'Β' }]) }));

    await runTemplateOnDocument({ documentId: 'd1', templateId: 't1', trigger: 'manual' });

    const data = db.ocrInvoiceItem.createMany.mock.calls.at(-1)![0].data as Record<string, unknown>[];
    expect(data[0]).toMatchObject({ code: 'A1', softoneMtrl: 111, softoneMatchedBy: 'manual', softoneName: 'ΕΙΔΟΣ Α' });
    expect(data[1]).toMatchObject({ code: 'B2', softoneMtrl: 222, softoneMatchedBy: 'code2' });
    // The counters on the document describe the rows we just deleted until this runs.
    expect(matchItems).toHaveBeenCalledWith('d1');
    expect(db.$transaction.mock.invocationCallOrder[0]).toBeLessThan(matchItems.mock.invocationCallOrder[0]);
  });

  it('follows a line that MOVED by its code, and never carries a match onto a different article', async () => {
    load(lineTemplate());
    db.ocrInvoiceItem.findMany.mockResolvedValue([
      { rowIndex: 0, code: 'A1', softoneMtrl: 111, softoneCode: 'S-1', softoneName: 'ΕΙΔΟΣ Α', softoneIsService: false, softoneMatchedBy: 'manual' },
      { rowIndex: 1, code: 'B2', softoneMtrl: 222, softoneCode: 'S-2', softoneName: 'ΕΙΔΟΣ Β', softoneIsService: false, softoneMatchedBy: 'code2' },
    ]);
    // The re-read put a NEW line first; A1 slid down to index 1.
    extract.mockResolvedValue(extractResult({ total: value(20), note: value('x'), lines: value([{ code: 'C3', desc: 'Γ' }, { code: 'A1', desc: 'Α' }]) }));

    await runTemplateOnDocument({ documentId: 'd1', templateId: 't1', trigger: 'manual' });

    const data = db.ocrInvoiceItem.createMany.mock.calls.at(-1)![0].data as Record<string, unknown>[];
    expect(data[0]).toMatchObject({ code: 'C3', softoneMtrl: null, softoneMatchedBy: null });
    expect(data[1]).toMatchObject({ code: 'A1', softoneMtrl: 111, softoneMatchedBy: 'manual' });
  });

  it('does not touch the item rows — or the matcher — when the mapping has no line rows', async () => {
    load(template({ mode: 'SEMI_AUTO', conditions: [] }));
    extract.mockResolvedValue(extractResult({ total: value(20), note: value('x') }));
    await runTemplateOnDocument({ documentId: 'd1', templateId: 't1', trigger: 'manual' });
    expect(db.ocrInvoiceItem.deleteMany).not.toHaveBeenCalled();
    expect(matchItems).not.toHaveBeenCalled();
  });
});

describe('cross-check against the base OCR', () => {
  it('flags a total the template and the OCR disagree on, and still projects the TEMPLATE value', async () => {
    load(template({ mode: 'SEMI_AUTO', conditions: [] }), doc({ extractedData: { totalAmount: 22.94 } }));
    extract.mockResolvedValue(extractResult({ total: value(229.4), note: value('x') }));

    const out = await runTemplateOnDocument({ documentId: 'd1', templateId: 't1', trigger: 'manual' });

    expect(out.flags.review).toContain('Ασυμφωνία «Σύνολο»: πρότυπο 229.4 · OCR 22.94');
    expect(out.flags.blocked).toEqual([]);            // a disagreement asks for eyes, it does not block
    expect(runData().flags.fields).toEqual({ total: 'review' });
    expect(docUpdates().find((d) => 'extractedData' in d)!.extractedData.totalAmount).toBe(229.4);
  });

  it('stores what the base OCR read BEFORE the projection overwrites it — cross-check keys only', async () => {
    load(template({ mode: 'SEMI_AUTO', conditions: [] }),
      doc({ extractedData: { totalAmount: 22.94, invoiceNumber: '7', vendorName: 'ΑΦΟΙ Χ' } }));
    extract.mockResolvedValue(extractResult({ total: value(229.4), note: value('x') }));

    await runTemplateOnDocument({ documentId: 'd1', templateId: 't1', trigger: 'manual' });

    // `vendorName` is not worth cross-checking, so it is not carried; the OCR's own 22.94 is, even
    // though the document now says 229.4. Keyed by canonical path.
    expect(runData().flags.baseOcr).toEqual({ 'totals.total': 22.94, 'totals.net': null, 'totals.vatAmount': null, 'type.number': '7', date: null });
    expect(docUpdates().find((d) => 'extractedData' in d)!.extractedData.totalAmount).toBe(229.4);
  });

  it('says nothing when the two readings agree', async () => {
    load(template({ mode: 'SEMI_AUTO', conditions: [] }), doc({ extractedData: { totalAmount: '229,40' } }));
    extract.mockResolvedValue(extractResult({ total: value(229.4), note: value('x') }));
    const out = await runTemplateOnDocument({ documentId: 'd1', templateId: 't1', trigger: 'manual' });
    expect(out.flags.review).toEqual([]);
  });

  it('keeps the OCR value when the template read nothing at all', async () => {
    load(template({ mode: 'SEMI_AUTO', conditions: [], fields: [field({ key: 'total', label: 'Σύνολο', valueType: 'CURRENCY', order: 0 }), NOTE] }),
      doc({ extractedData: { totalAmount: 22.94 } }));
    extract.mockResolvedValue(extractResult({ total: value(null, 'none'), note: value('x') }));

    const out = await runTemplateOnDocument({ documentId: 'd1', templateId: 't1', trigger: 'manual' });

    expect(docUpdates().find((d) => 'extractedData' in d)!.extractedData.totalAmount).toBe(22.94);
    expect(out.flags.review).toEqual([]);             // one silent reader is not a contradiction
  });
});

describe('table fallback', () => {
  it('keeps the OCR lines when the template table read nothing, and says so', async () => {
    load(lineTemplate(), doc({ extractedData: { items: [{ code: 'A1', name: 'Α' }] }, _count: { items: 1 } }));
    extract.mockResolvedValue(extractResult({ total: value(20), note: value('x'), lines: value([]) }));

    const out = await runTemplateOnDocument({ documentId: 'd1', templateId: 't1', trigger: 'manual' });

    expect(out.flags.review).toContain('Ο πίνακας «Γραμμές» δεν διαβάστηκε — κρατήθηκαν οι γραμμές του OCR');
    expect(docUpdates().find((d) => 'document' in d)!.document.lines).toMatchObject([{ code: 'A1', name: 'Α' }]);
    // Same array reference → the rows are left exactly as the OCR wrote them.
    expect(db.ocrInvoiceItem.deleteMany).not.toHaveBeenCalled();
    expect(matchItems).not.toHaveBeenCalled();
  });

  it('rebuilds normally when the table DID read rows', async () => {
    load(lineTemplate(), doc({ extractedData: { items: [{ code: 'A1', name: 'Α' }] }, _count: { items: 1 } }));
    extract.mockResolvedValue(extractResult({ total: value(20), note: value('x'), lines: value([{ code: 'B2', desc: 'Β' }]) }));

    const out = await runTemplateOnDocument({ documentId: 'd1', templateId: 't1', trigger: 'manual' });

    expect(out.flags.review).toEqual([]);
    expect(db.ocrInvoiceItem.deleteMany).toHaveBeenCalled();
    expect(docUpdates().find((d) => 'document' in d)!.document.lines).toMatchObject([{ code: 'B2', name: 'Β' }]);
  });

  it('an empty table with no OCR lines to keep is just an empty table', async () => {
    load(lineTemplate());
    extract.mockResolvedValue(extractResult({ total: value(20), note: value('x'), lines: value([]) }));
    const out = await runTemplateOnDocument({ documentId: 'd1', templateId: 't1', trigger: 'manual' });
    expect(out.flags.review).toEqual([]);
  });
});

// ------------------------------------------------- editing a run after the fact

/** A TemplateRun row as `RUN_INCLUDE` returns it. */
const runRow = (over: Record<string, unknown> = {}) => ({
  id: 'r1', documentId: 'd1', status: 'REVIEW', mappingName: 'default', templateVersion: 2,
  createdAt: new Date('2026-09-10T10:00:00Z'),
  values: { total: value(20), note: value('x') },
  flags: { review: [], blocked: [], notified: [], fields: {} },
  template: template({ mode: 'SEMI_AUTO', conditions: [] }),
  ...over,
});

/** The document row `rereadField`/`finalizeRunEdit` select. */
const docRow = (over: Record<string, unknown> = {}) => ({ storageKey: 'ocr/a.pdf', mimeType: 'application/pdf', extractedData: {}, ...over });

const loadRun = (run: Record<string, unknown> = runRow(), d: Record<string, unknown> = docRow()) => {
  db.templateRun.findUnique.mockResolvedValue(run);
  db.templateRun.findFirst.mockResolvedValue({ id: run.id });
  db.ocrDocument.findUnique.mockResolvedValue(d);
  db.templateRun.update.mockResolvedValue({ ...run, id: run.id });
  return run;
};

/** Payload of the last `templateRun.update`. */
const runUpdate = () => db.templateRun.update.mock.calls.at(-1)![0].data as Record<string, any>;
/** The field list `extractTemplateFields` was asked to read. */
const readFields = () => extract.mock.calls.at(-1)![2] as Record<string, any>[];

describe('rereadField', () => {
  it('reads only that field, with the region the user drew, and leaves the other values alone', async () => {
    loadRun();
    extract.mockResolvedValue(extractResult({ total: { ...value(229.4), page: 1, bbox: [0.3, 0.4, 0.2, 0.05] } }));

    const out = await rereadField({ documentId: 'd1', runId: 'r1', fieldKey: 'total', region: { page: 1, bbox: [0.3, 0.4, 0.2, 0.05] } });

    expect(out.ok).toBe(true);
    expect(readFields()).toHaveLength(1);
    expect(readFields()[0]).toMatchObject({ key: 'total', region: { page: 1, bbox: [0.3, 0.4, 0.2, 0.05] } });
    // The cost lands on the DOCUMENT, not the template.
    expect(extract.mock.calls.at(-1)![3]).toMatchObject({ ref: { refType: 'OcrDocument', refId: 'd1' } });
    // Only that key moved; the box it was read from is stored with it.
    expect(runUpdate().values.total).toMatchObject({ value: 229.4, page: 1, bbox: [0.3, 0.4, 0.2, 0.05] });
    expect(runUpdate().values.note).toMatchObject({ value: 'x' });
    expect(out.ok && out.overridden).toBe(true);
  });

  it('without an override, re-reads the box THIS RUN used — not the template\'s', async () => {
    loadRun(runRow({ values: { total: { ...value(20), page: 2, bbox: [0.1, 0.9, 0.2, 0.05] }, note: value('x') } }));
    extract.mockResolvedValue(extractResult({ total: value(20) }));

    const out = await rereadField({ documentId: 'd1', runId: 'r1', fieldKey: 'total' });

    expect(readFields()[0].region).toEqual({ page: 2, bbox: [0.1, 0.9, 0.2, 0.05] });
    expect(out.ok && out.overridden).toBe(false);
  });

  it('falls back to the template region when the run has no box for the field', async () => {
    loadRun(runRow({ values: { note: value('x') } }));
    extract.mockResolvedValue(extractResult({ total: value(20) }));
    await rereadField({ documentId: 'd1', runId: 'r1', fieldKey: 'total' });
    expect(readFields()[0].region).toEqual({ page: 0, bbox: [0, 0, 0.1, 0.1] });
  });

  it('recomputes the flags of the re-read field and re-projects onto the document', async () => {
    loadRun(
      runRow({
        template: template({ mode: 'SEMI_AUTO', conditions: [] }),
        values: { total: value(null, 'none'), note: value('x') },
        flags: { review: ['Λείπει υποχρεωτικό πεδίο «Σύνολο»', 'μεγάλο ποσό'], blocked: [], notified: ['c1'], fields: { total: 'review' } },
      }),
      docRow({ extractedData: { invoiceNumber: '7' } }),
    );
    extract.mockResolvedValue(extractResult({ total: value(150) }));

    await rereadField({ documentId: 'd1', runId: 'r1', fieldKey: 'total' });

    // The value arrived → the missing-required flag goes, the rule's prose and the notified ids stay.
    expect(runUpdate().flags).toMatchObject({ review: ['μεγάλο ποσό'], blocked: [], notified: ['c1'], fields: {} });
    const projected = docUpdates().find((d) => 'extractedData' in d)!.extractedData;
    expect(projected.totalAmount).toBe(150);
    expect(projected.invoiceNumber).toBe('7');
    expect(docUpdates().at(-1)!.reviewFlags).toMatchObject({ runId: 'r1', runStatus: 'REVIEW', review: ['μεγάλο ποσό'] });
  });

  it('flags a re-read value that now contradicts the base OCR', async () => {
    // The run's own snapshot is what the cross-check compares against — `extractedData` is by now
    // this run's projection, and comparing with it would find the template agreeing with itself.
    loadRun(
      runRow({ flags: { review: [], blocked: [], notified: [], fields: {}, baseOcr: { totalAmount: 22.94 } } }),
      docRow({ extractedData: { totalAmount: 20 } }),
    );
    extract.mockResolvedValue(extractResult({ total: value(229.4) }));

    await rereadField({ documentId: 'd1', runId: 'r1', fieldKey: 'total' });

    expect(runUpdate().flags.review).toContain('Ασυμφωνία «Σύνολο»: πρότυπο 229.4 · OCR 22.94');
    expect(runUpdate().flags.fields).toEqual({ total: 'review' });
  });

  it('keeps a genuine mismatch across a re-read of ANOTHER field — the snapshot outlives the projection', async () => {
    const stale = 'Ασυμφωνία «Σύνολο»: πρότυπο 229.4 · OCR 22.94';
    loadRun(
      runRow({
        values: { total: value(229.4), note: value('x') },
        flags: { review: [stale], blocked: [], notified: [], fields: { total: 'review' }, baseOcr: { totalAmount: 22.94 } },
      }),
      // The document already carries the projected 229.4 — the naive comparison would see two
      // readers in perfect agreement and drop the flag.
      docRow({ extractedData: { totalAmount: 229.4 } }),
    );
    extract.mockResolvedValue(extractResult({ note: value('y') }));

    await rereadField({ documentId: 'd1', runId: 'r1', fieldKey: 'note' });

    expect(runUpdate().flags.review).toEqual([stale]);
    expect(runUpdate().flags.fields).toEqual({ total: 'review' });
  });

  it('keeps a correction that landed on ANOTHER field while the model was reading', async () => {
    loadRun();
    // The row this re-read snapshotted is not the row it commits against: a PATCH corrected «note»
    // (and left its own review flag) in between. Only «total» may carry over from the snapshot.
    db.templateRun.findUnique.mockResolvedValueOnce(runRow()).mockResolvedValue(runRow({
      values: { total: value(20), note: value('διορθωμένο') },
      flags: { review: ['χειροκίνητη διόρθωση'], blocked: [], notified: [], fields: {} },
    }));
    extract.mockResolvedValue(extractResult({ total: value(229.4) }));

    await rereadField({ documentId: 'd1', runId: 'r1', fieldKey: 'total' });

    expect(runUpdate().values.total).toMatchObject({ value: 229.4 });
    expect(runUpdate().values.note).toMatchObject({ value: 'διορθωμένο' });
    // The flags are rebuilt from the FRESH row too, or the correction's own verdict would go with it.
    expect(runUpdate().flags.review).toEqual(['χειροκίνητη διόρθωση']);
  });

  it('refuses a run that stopped being the latest WHILE the model was reading', async () => {
    loadRun();
    // Latest when we check on entry; a re-run of the template landed by the time the read came back.
    db.templateRun.findFirst.mockResolvedValueOnce({ id: 'r1' }).mockResolvedValue({ id: 'r2' });
    extract.mockResolvedValue(extractResult({ total: value(229.4) }));

    await expect(rereadField({ documentId: 'd1', runId: 'r1', fieldKey: 'total' })).resolves.toEqual({ ok: false, error: 'not_latest' });

    // The read happened, but nothing was committed over the newer run's work.
    expect(extract).toHaveBeenCalled();
    expect(db.templateRun.update).not.toHaveBeenCalled();
    expect(docUpdates()).toEqual([]);
  });

  it('refuses a run that has already been posted, before spending a model call', async () => {
    loadRun(runRow({ status: 'POSTED' }));
    await expect(rereadField({ documentId: 'd1', runId: 'r1', fieldKey: 'total' })).resolves.toEqual({ ok: false, error: 'posted' });
    expect(extract).not.toHaveBeenCalled();
    expect(db.templateRun.update).not.toHaveBeenCalled();
  });

  it('reports a region on a page the document does not have as bad_page, not as a failed read', async () => {
    loadRun();
    extract.mockResolvedValue(extractResult({ total: value(null, 'none') }, { errors: [{ fieldKey: 'total', message: 'page out of range' }] }));

    await expect(rereadField({ documentId: 'd1', runId: 'r1', fieldKey: 'total', region: { page: 9, bbox: [0, 0, 0.1, 0.1] } }))
      .resolves.toEqual({ ok: false, error: 'bad_page' });
    expect(db.templateRun.update).not.toHaveBeenCalled();
  });

  it('refuses a run that is not the document\'s latest, an unknown field, and a field with no region', async () => {
    loadRun();
    db.templateRun.findFirst.mockResolvedValue({ id: 'r2' });
    await expect(rereadField({ documentId: 'd1', runId: 'r1', fieldKey: 'total' })).resolves.toEqual({ ok: false, error: 'not_latest' });
    expect(extract).not.toHaveBeenCalled();

    loadRun();
    await expect(rereadField({ documentId: 'd1', runId: 'r1', fieldKey: 'φάντασμα' })).resolves.toEqual({ ok: false, error: 'unknown_field' });

    loadRun(runRow({ template: template({ mode: 'SEMI_AUTO', conditions: [], fields: [field({ key: 'total', label: 'Σύνολο', required: true, region: null })] }), values: {} }));
    await expect(rereadField({ documentId: 'd1', runId: 'r1', fieldKey: 'total' })).resolves.toEqual({ ok: false, error: 'no_region' });

    db.templateRun.findUnique.mockResolvedValue(null);
    await expect(rereadField({ documentId: 'd1', runId: 'r1', fieldKey: 'total' })).resolves.toEqual({ ok: false, error: 'not_found' });

    loadRun(runRow({ documentId: 'other' }));
    await expect(rereadField({ documentId: 'd1', runId: 'r1', fieldKey: 'total' })).resolves.toEqual({ ok: false, error: 'not_found' });
    expect(db.templateRun.update).not.toHaveBeenCalled();
  });

  it('a failed read changes nothing — the previous value stands', async () => {
    loadRun();
    extract.mockResolvedValue(extractResult({ total: value(null, 'none') }, { errors: [{ fieldKey: 'total', message: 'κενή περιοχή' }] }));

    await expect(rereadField({ documentId: 'd1', runId: 'r1', fieldKey: 'total' })).resolves.toEqual({ ok: false, error: 'read_failed' });
    expect(db.templateRun.update).not.toHaveBeenCalled();
    expect(docUpdates()).toEqual([]);
  });
});

describe('finalizeRunEdit', () => {
  it('MANUAL never rewrites the document, but still stores the values and moves the banner', async () => {
    const run = runRow({ template: template({ mode: 'MANUAL', conditions: [] }), status: 'EXTRACTED' });
    db.templateRun.update.mockResolvedValue(run);
    db.ocrDocument.findUnique.mockResolvedValue({ extractedData: { totalAmount: 1 } });

    await finalizeRunEdit({ run: run as never, values: { total: value(99), note: value('x') } });

    expect(runUpdate().values.total).toMatchObject({ value: 99 });
    expect(docUpdates().some((d) => 'extractedData' in d)).toBe(false);
    expect(docUpdates().at(-1)!.reviewFlags).toMatchObject({ runStatus: 'EXTRACTED', runId: 'r1', templateSlug: 'promitheftis' });
  });

  it('loads the canonical document itself and projects the correction onto it', async () => {
    const run = runRow();
    db.templateRun.update.mockResolvedValue(run);
    db.ocrDocument.findUnique.mockResolvedValue({ fileName: 'a.pdf', extractedData: { invoiceNumber: '7' } });

    await finalizeRunEdit({ run: run as never, values: { total: value(50), note: value('x') } });

    const saved = docUpdates().find((d) => 'document' in d)!;
    expect(saved.document.totals.total).toBe(50);
    expect(saved.document.type.number).toBe('7');            // untouched by the mapping, kept
    expect(saved.extractedData).toMatchObject({ totalAmount: 50, invoiceNumber: '7' });
  });

  it('rewrites the run output envelope from the corrected document', async () => {
    const run = runRow();
    db.templateRun.update.mockResolvedValue(run);
    db.ocrDocument.findUnique.mockResolvedValue({ fileName: 'a.pdf', extractedData: { invoiceNumber: '7' } });

    await finalizeRunEdit({ run: run as never, values: { total: value(50), note: value('x') } });

    const out = runUpdate().output;
    expect(out).toMatchObject({ template: 'promitheftis', version: 3, file: 'a.pdf', documentId: 'd1', extractedAt: '2026-09-10T10:00:00.000Z' });
    expect(out.document.totals.total).toBe(50);
  });
});
