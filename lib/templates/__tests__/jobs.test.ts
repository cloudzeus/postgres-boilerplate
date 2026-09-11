// lib/templates/__tests__/jobs.test.ts — ο worker των εργασιών σάρωσης (spec §12, §13).
// Prisma / Bunny / εξαγωγέας / Mailgun mocked: ελέγχουμε ΤΙ γράφεται και ΠΟΤΕ, όχι τι διαβάζει το μοντέλο.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const db = vi.hoisted(() => ({
  extractionTemplate: { findUnique: vi.fn() },
  templateJob: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  templateJobItem: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
  $queryRaw: vi.fn(),
}));
const bunny = vi.hoisted(() => ({ bunnyUploadPrivate: vi.fn(), bunnyDownload: vi.fn(), bunnyDelete: vi.fn() }));
const extract = vi.hoisted(() => vi.fn());
const mail = vi.hoisted(() => vi.fn());
const raster = vi.hoisted(() => ({
  isPdfBuffer: vi.fn((b: Buffer) => b.subarray(0, 5).toString('latin1') === '%PDF-'),
  sniffImageType: vi.fn(() => null),
  countPdfPages: vi.fn(async () => 2),
  pageOutline: vi.fn(async () => ({ text: '', aspect: 1.41 })),
}));

vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/bunny', () => bunny);
vi.mock('@/lib/mailgun', () => ({ sendTransactionalEmail: mail }));
vi.mock('@/lib/ocr/rasterize', () => raster);
vi.mock('../extract', () => ({ extractTemplateFields: (...a: unknown[]) => extract(...a) }));

import {
  cancelJob, claimJob, createJob, JobError, jobsDisabled, jobSheetInputs, kickJobWorker,
  processItem, processJob, recoverStale, startJobWorker, stopJobWorker,
} from '../jobs';

const PDF = Buffer.from('%PDF-1.4 hello');

const FIELDS = [
  { id: 'f1', templateId: 't1', key: 'total', label: 'Σύνολο', kind: 'SINGLE', valueType: 'CURRENCY', color: '#111', region: { page: 0, bbox: [0.1, 0.1, 0.2, 0.05] }, columns: null, aiHint: null, required: true, order: 0, lastGood: null },
  { id: 'f2', templateId: 't1', key: 'num', label: 'Αριθμός', kind: 'SINGLE', valueType: 'TEXT', color: '#222', region: { page: 0, bbox: [0.4, 0.1, 0.2, 0.05] }, columns: null, aiHint: null, required: false, order: 1, lastGood: null },
];

const TEMPLATE = {
  id: 't1', slug: 'kapaline', name: 'Καπαλινέ', version: 3, mode: 'SEMI_AUTO', notifyEmails: 'logistis@x.gr',
  fields: FIELDS,
  mappings: [{ id: 'm1', templateId: 't1', name: 'default', target: 'INVOICE', isDefault: true, rows: [{ fieldKey: 'total', invoiceKey: 'totalAmount' }] }],
  conditions: [],
};

const value = (v: unknown, over: Record<string, unknown> = {}) =>
  ({ raw: String(v), value: v, confidence: 0.8, source: 'vision', page: 0, bbox: [0, 0, 1, 1], color: '#111', ...over });

const item = (over: Record<string, unknown> = {}) => ({
  id: 'i1', jobId: 'job_1', order: 0, fileName: 'a.pdf', storageKey: 'templates/t1/jobs/job_1/000.pdf',
  mimeType: 'application/pdf', size: 14, status: 'RUNNING', page: null, values: null, matched: null, flags: null,
  model: null, tokensUsed: null, durationMs: null, error: null, startedAt: new Date(), finishedAt: null,
  ...over,
});

const job = (over: Record<string, unknown> = {}) => ({
  id: 'job_1', templateId: 't1', templateVersion: 3, status: 'RUNNING', total: 2, done: 0, failed: 0,
  title: 'Τιμολόγια Μαΐου', reference: 'ΠΑΡ-17', docDate: new Date('2026-05-31T00:00:00Z'),
  description: 'ο φάκελος', notifyEmails: null, createdById: 'u1',
  createdAt: new Date('2026-09-11T09:00:00Z'), startedAt: new Date('2026-09-11T09:00:10Z'), finishedAt: null,
  ...over,
});

/** Ό,τι γράφτηκε στη γραμμή ενός αρχείου, από την τελευταία `templateJobItem.update`. */
const itemUpdate = () => db.templateJobItem.updateMany.mock.calls.at(-1)![0] as { where: Record<string, any>; data: Record<string, any> };

beforeEach(() => {
  vi.clearAllMocks();
  delete (globalThis as Record<string, unknown>).__templateJobWorker;
  db.extractionTemplate.findUnique.mockResolvedValue(TEMPLATE);
  db.templateJob.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: data.id }));
  db.templateJob.findUnique.mockResolvedValue({ template: TEMPLATE });
  db.templateJob.update.mockResolvedValue({});
  db.templateJob.updateMany.mockResolvedValue({ count: 1 });
  db.templateJobItem.findUnique.mockResolvedValue(item());
  db.templateJobItem.update.mockResolvedValue({});
  db.templateJobItem.updateMany.mockResolvedValue({ count: 1 });
  db.templateJobItem.count.mockResolvedValue(0);
  db.templateJob.findMany.mockResolvedValue([]);
  db.$queryRaw.mockResolvedValue([]);
  bunny.bunnyUploadPrivate.mockResolvedValue({ key: 'k' });
  bunny.bunnyDownload.mockResolvedValue(PDF);
  bunny.bunnyDelete.mockResolvedValue(undefined);
  mail.mockResolvedValue({ id: 'm' });
  extract.mockResolvedValue({ values: { total: value(229.4), num: value('17') }, model: 'gpt', tokensUsed: 42, errors: [], pageCount: 2, adaptive: [] });
});

afterEach(() => stopJobWorker());

// ---------------------------------------------------------------- createJob

/** Ένα αρχείο προς ανέβασμα, όπως το δίνει το route: τα bytes ζητούνται όταν έρθει η σειρά του. */
const upload = (fileName: string, buffer: Buffer = PDF, size = buffer.length) =>
  ({ fileName, size, read: async () => buffer });

describe('createJob', () => {
  const files = [upload('a.pdf'), upload('b.pdf')];

  it('uploads under the job folder, writes ordered items and stores the metadata the user typed', async () => {
    const out = await createJob('t1', {
      files, userId: 'u1',
      title: 'Τιμολόγια Μαΐου', reference: 'ΠΑΡ-17', docDate: new Date('2026-05-31T00:00:00Z'),
      description: 'ο φάκελος', notifyEmails: 'a@x.gr',
    });
    expect(out.jobId).toMatch(/^job_/);

    const keys = bunny.bunnyUploadPrivate.mock.calls.map((c) => c[0].key);
    expect(keys).toEqual([`templates/t1/jobs/${out.jobId}/000.pdf`, `templates/t1/jobs/${out.jobId}/001.pdf`]);

    const data = db.templateJob.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      templateId: 't1', templateVersion: 3, status: 'QUEUED', total: 2, createdById: 'u1',
      title: 'Τιμολόγια Μαΐου', reference: 'ΠΑΡ-17', description: 'ο φάκελος', notifyEmails: 'a@x.gr',
    });
    expect(data.docDate).toEqual(new Date('2026-05-31T00:00:00Z'));
    expect(data.items.create.map((i: { order: number; fileName: string; page: number }) => [i.order, i.fileName, i.page]))
      .toEqual([[0, 'a.pdf', 2], [1, 'b.pdf', 2]]);
  });

  it('leaves the metadata null when the user typed none — the display falls back, the row does not lie', async () => {
    await createJob('t1', { files });
    expect(db.templateJob.create.mock.calls[0][0].data).toMatchObject({ title: null, reference: null, docDate: null, description: null, notifyEmails: null });
  });

  it('refuses a template nobody drew regions on, before uploading anything', async () => {
    db.extractionTemplate.findUnique.mockResolvedValue({ ...TEMPLATE, fields: FIELDS.map((f) => ({ ...f, region: null })) });
    await expect(createJob('t1', { files })).rejects.toMatchObject({ code: 'not_ready' });
    expect(bunny.bunnyUploadPrivate).not.toHaveBeenCalled();
  });

  it('refuses an unknown template, an empty list and an over-long one', async () => {
    db.extractionTemplate.findUnique.mockResolvedValue(null);
    await expect(createJob('nope', { files })).rejects.toBeInstanceOf(JobError);
    db.extractionTemplate.findUnique.mockResolvedValue(TEMPLATE);
    await expect(createJob('t1', { files: [] })).rejects.toMatchObject({ code: 'no_files' });
    await expect(createJob('t1', { files: Array.from({ length: 201 }, () => files[0]) })).rejects.toMatchObject({ code: 'too_many' });
  });

  it('cleans up what it already uploaded when a later file blows up — no half job', async () => {
    bunny.bunnyUploadPrivate.mockResolvedValueOnce({ key: 'k' }).mockRejectedValueOnce(new Error('bunny down'));
    await expect(createJob('t1', { files })).rejects.toThrow('bunny down');
    expect(bunny.bunnyDelete).toHaveBeenCalledWith([expect.stringContaining('/000.pdf')]);
    expect(db.templateJob.create).not.toHaveBeenCalled();
  });

  it('refuses bytes it cannot recognise, whatever the file is called', async () => {
    await expect(createJob('t1', { files: [upload('x.pdf', Buffer.from('not a document'))] }))
      .rejects.toMatchObject({ code: 'unsupported_type' });
    expect(db.templateJob.create).not.toHaveBeenCalled();
  });

  it('reads ONE file into memory at a time — a 200-file upload must not be 200 buffers', async () => {
    let live = 0;
    let peak = 0;
    const watched = ['a.pdf', 'b.pdf', 'c.pdf'].map((n) => ({
      fileName: n, size: PDF.length,
      read: async () => { live += 1; peak = Math.max(peak, live); return PDF; },
    }));
    bunny.bunnyUploadPrivate.mockImplementation(async () => { live -= 1; return { key: 'k' }; });
    await createJob('t1', { files: watched });
    expect(peak).toBe(1);
  });

  it('refuses the upload on total size, before a single byte is read', async () => {
    const huge = Array.from({ length: 20 }, (_, i) => upload(`${i}.pdf`, PDF, 20 * 1024 * 1024));
    await expect(createJob('t1', { files: huge })).rejects.toMatchObject({ code: 'too_large_total' });
    expect(bunny.bunnyUploadPrivate).not.toHaveBeenCalled();
  });

  it('refuses a single over-sized file on its declared size alone', async () => {
    await expect(createJob('t1', { files: [upload('big.pdf', PDF, 26 * 1024 * 1024)] })).rejects.toMatchObject({ code: 'too_large' });
    expect(bunny.bunnyUploadPrivate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- claiming

describe('claimJob', () => {
  it('claims with FOR UPDATE SKIP LOCKED so two instances never take the same job', async () => {
    db.$queryRaw.mockResolvedValue([{ id: 'job_9' }]);
    expect(await claimJob()).toBe('job_9');
    const sql = db.$queryRaw.mock.calls[0][0].join('?');
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain("status = 'RUNNING'");
  });

  it('is null when there is nothing queued', async () => {
    expect(await claimJob()).toBeNull();
  });
});

// ---------------------------------------------------------------- processItem

describe('processItem', () => {
  it('reads only the fields with a region, bills the item, and stores values/flags/model', async () => {
    expect(await processItem('i1', TEMPLATE as never)).toBe('DONE');
    expect(extract.mock.calls[0][2].map((f: { key: string }) => f.key)).toEqual(['total', 'num']);
    expect(extract.mock.calls[0][3]).toMatchObject({ ref: { refType: 'TemplateJobItem', refId: 'i1' } });

    const { data } = itemUpdate();
    expect(data.status).toBe('DONE');
    expect(data.values.total).toMatchObject({ value: 229.4 });
    expect(data).toMatchObject({ model: 'gpt', tokensUsed: 42, page: 2, error: null });
    expect(typeof data.durationMs).toBe('number');
    expect(data.finishedAt).toBeInstanceOf(Date);
  });

  it('flags a missing required field exactly as a run would', async () => {
    extract.mockResolvedValue({ values: { total: value(null), num: value('17') }, model: 'g', tokensUsed: 1, errors: [], pageCount: 1, adaptive: [] });
    await processItem('i1', TEMPLATE as never);
    expect(itemUpdate().data.flags.review).toContain('Λείπει υποχρεωτικό πεδίο «Σύνολο»');
    expect(itemUpdate().data.flags.fields).toMatchObject({ total: 'review' });
  });

  it('marks a file FAILED with its reason instead of throwing — the rest of the job continues', async () => {
    bunny.bunnyDownload.mockRejectedValue(new Error('file unavailable'));
    expect(await processItem('i1', TEMPLATE as never)).toBe('FAILED');
    expect(itemUpdate().data).toMatchObject({ status: 'FAILED', error: 'file unavailable' });
  });

  it('never touches OcrDocument — a job reads into a table, it does not run a document', async () => {
    await processItem('i1', TEMPLATE as never);
    expect(Object.keys(db)).not.toContain('ocrDocument');
  });
});

// ---------------------------------------------------------------- processJob

/** Κάνει το `claimItem` να δώσει τα `ids` με τη σειρά και μετά τίποτα. */
const queueItems = (...ids: string[]) => {
  let n = 0;
  db.$queryRaw.mockImplementation(async () => (n < ids.length ? [{ id: ids[n++] }] : []));
};

describe('processJob', () => {
  it('walks every queued file and counts the successes and the failures', async () => {
    queueItems('i1', 'i2');
    db.templateJobItem.findUnique.mockResolvedValueOnce(item({ id: 'i1' })).mockResolvedValueOnce(item({ id: 'i2' }));
    extract.mockResolvedValueOnce({ values: { total: value(1) }, model: 'g', tokensUsed: 1, errors: [], pageCount: 1, adaptive: [] });
    extract.mockRejectedValueOnce(new Error('vision down'));
    db.templateJob.findUnique
      .mockResolvedValueOnce({ template: TEMPLATE })                      // φόρτωση προτύπου
      .mockResolvedValue({ status: 'RUNNING', total: 2, done: 1, failed: 1 });

    await processJob('job_1');

    const counters = db.templateJob.update.mock.calls.map((c) => c[0].data);
    expect(counters).toEqual([{ done: { increment: 1 } }, { failed: { increment: 1 } }]);
    expect(db.templateJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'job_1', finishedAt: null },
      data: expect.objectContaining({ status: 'DONE' }),
    }));
  });

  it('is FAILED only when nothing at all was read', async () => {
    queueItems('i1');
    extract.mockRejectedValue(new Error('vision down'));
    db.templateJob.findUnique
      .mockResolvedValueOnce({ template: TEMPLATE })
      .mockResolvedValue({ status: 'RUNNING', total: 1, done: 0, failed: 1 });
    await processJob('job_1');
    expect(db.templateJob.updateMany.mock.calls.at(-1)![0].data).toMatchObject({ status: 'FAILED' });
  });

  it('stops at the cancellation and leaves the queued files QUEUED', async () => {
    queueItems('i1', 'i2');
    db.templateJob.findUnique
      .mockResolvedValueOnce({ template: TEMPLATE })
      .mockResolvedValueOnce({ status: 'CANCELLED' });

    await processJob('job_1');

    expect(extract).not.toHaveBeenCalled();
    // Καμία «ολοκλήρωση»: την κατάσταση την έγραψε η ακύρωση, όχι ο worker.
    expect(db.templateJob.updateMany).not.toHaveBeenCalled();
  });

  it('a job whose template vanished fails through the terminal guard, so it still mails once', async () => {
    db.templateJob.findUnique.mockResolvedValue(null);
    await processJob('job_1');
    expect(db.templateJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'job_1', finishedAt: null },
      data: expect.objectContaining({ status: 'FAILED' }),
    }));
  });

  it('counts a file only when ITS OWN write landed — a recovered item is not counted twice', async () => {
    queueItems('i1');
    db.templateJobItem.updateMany.mockResolvedValue({ count: 0 });   // την πρόλαβε άλλος worker
    db.templateJob.findUnique
      .mockResolvedValueOnce({ template: TEMPLATE })
      .mockResolvedValue({ status: 'RUNNING', total: 1, done: 1, failed: 0 });

    await processJob('job_1');
    expect(db.templateJob.update).not.toHaveBeenCalled();
    // Και ο όρος που το εγγυάται είναι στη ΒΑΣΗ, όχι στη λογική του worker:
    expect(itemUpdate().where).toMatchObject({ id: 'i1', status: 'RUNNING' });
  });
});

// ---------------------------------------------------------------- το email

describe('the completion email', () => {
  const finish = async (over: Record<string, unknown> = {}) => {
    queueItems();
    db.templateJob.findUnique
      .mockResolvedValueOnce({ template: TEMPLATE })                                      // φόρτωση
      .mockResolvedValueOnce({ status: 'RUNNING' })                                       // πριν το (μηδέν) αρχείο
      .mockResolvedValueOnce({ status: 'RUNNING', total: 2, done: 2, failed: 0 })          // μετρητές
      .mockResolvedValue({ ...job({ finishedAt: new Date('2026-09-11T09:05:00Z'), done: 2, ...over }), template: { name: 'Καπαλινέ', notifyEmails: 'logistis@x.gr' } });
    await processJob('job_1');
  };

  it('goes out once per job — not once per file — with the metadata and the counts', async () => {
    await finish();
    expect(mail).toHaveBeenCalledTimes(1);
    const [to, subject, html] = mail.mock.calls[0];
    expect(to).toBe('logistis@x.gr');
    expect(subject).toBe('Ολοκληρώθηκε η εργασία «Τιμολόγια Μαΐου»');
    expect(html).toContain('ΠΑΡ-17');
    expect(html).toContain('2 από 2');
  });

  it('prefers the job’s own recipients over the template’s', async () => {
    await finish({ notifyEmails: 'boss@x.gr, a@x.gr' });
    expect(mail.mock.calls[0][0]).toBe('boss@x.gr, a@x.gr');
  });

  it('stays silent when nobody is listed anywhere', async () => {
    db.templateJob.findUnique
      .mockResolvedValueOnce({ template: TEMPLATE })
      .mockResolvedValueOnce({ status: 'RUNNING' })
      .mockResolvedValueOnce({ status: 'RUNNING', total: 0, done: 0, failed: 0 })
      .mockResolvedValue({ ...job(), template: { name: 'Καπαλινέ', notifyEmails: null } });
    queueItems();
    await processJob('job_1');
    expect(mail).not.toHaveBeenCalled();
  });

  it('is not sent twice when the terminal transition was already taken', async () => {
    db.templateJob.updateMany.mockResolvedValue({ count: 0 });   // κάποιος άλλος πρόλαβε
    await finish();
    expect(mail).not.toHaveBeenCalled();
  });

  it('a mail that throws does not change what the job concluded', async () => {
    mail.mockRejectedValue(new Error('mailgun down'));
    await expect(finish()).resolves.toBeUndefined();
    expect(db.templateJob.updateMany.mock.calls.at(-1)![0].data).toMatchObject({ status: 'DONE' });
  });

  it('names the job by template and date when the user typed no title', async () => {
    await finish({ title: null });
    expect(mail.mock.calls[0][1]).toBe('Ολοκληρώθηκε η εργασία «Καπαλινέ · 2026-09-11»');
  });
});

// ---------------------------------------------------------------- cancel

describe('cancelJob', () => {
  it('marks the job CANCELLED and reports what will never run', async () => {
    db.templateJob.findUnique
      .mockResolvedValueOnce({ status: 'RUNNING' })
      .mockResolvedValue({ ...job({ status: 'CANCELLED' }), template: { name: 'Καπαλινέ', notifyEmails: null }, status: 'CANCELLED' });
    db.templateJobItem.count.mockResolvedValue(7);

    expect(await cancelJob('job_1')).toEqual({ status: 'CANCELLED', pending: 7 });
    expect(db.templateJob.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 'job_1', finishedAt: null }, data: expect.objectContaining({ status: 'CANCELLED' }),
    });
  });

  it('notifies for a cancelled job too', async () => {
    db.templateJob.findUnique
      .mockResolvedValueOnce({ status: 'RUNNING' })
      .mockResolvedValue({ ...job(), template: { name: 'Καπαλινέ', notifyEmails: 'logistis@x.gr' }, status: 'CANCELLED' });
    await cancelJob('job_1');
    expect(mail).toHaveBeenCalledTimes(1);
    expect(mail.mock.calls[0][1]).toContain('Ακυρώθηκε');
  });

  it('is a no-op on a job that already finished', async () => {
    db.templateJob.findUnique.mockResolvedValue({ status: 'DONE' });
    db.templateJobItem.count.mockResolvedValue(0);
    expect(await cancelJob('job_1')).toEqual({ status: 'DONE', pending: 0 });
    expect(db.templateJob.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a job that does not exist', async () => {
    db.templateJob.findUnique.mockResolvedValue(null);
    await expect(cancelJob('nope')).rejects.toMatchObject({ code: 'not_found' });
  });
});

// ---------------------------------------------------------------- recovery

describe('recoverStale', () => {
  it('returns abandoned RUNNING items to the queue and re-queues the jobs they stranded', async () => {
    db.templateJobItem.updateMany.mockResolvedValue({ count: 3 });
    db.templateJob.findMany.mockResolvedValueOnce([{ id: 'job_1' }]).mockResolvedValueOnce([]);
    db.templateJob.updateMany.mockResolvedValue({ count: 1 });

    expect(await recoverStale()).toEqual({ items: 3, jobs: 1, finished: 0 });
    const where = db.templateJobItem.updateMany.mock.calls[0][0].where;
    expect(where.status).toBe('RUNNING');
    expect(where.OR[0]).toEqual({ startedAt: null });
    // ΜΟΝΟ αρχεία εργασιών που κινούνται ακόμη: ένα αρχείο ακυρωμένης εργασίας δεν ξαναμπαίνει στην ουρά.
    expect(where.job).toEqual({ status: { in: ['QUEUED', 'RUNNING'] } });
    expect(db.templateJobItem.updateMany.mock.calls[0][0].data).toEqual({ status: 'QUEUED', startedAt: null });
  });

  it('closes a job stranded between its last file and its own completion', async () => {
    db.templateJob.findMany
      .mockResolvedValueOnce([])                                                   // καμία προς επανουρά
      .mockResolvedValueOnce([{ id: 'job_1', total: 2, done: 2, failed: 0 }]);     // κρεμασμένη RUNNING

    expect(await recoverStale()).toMatchObject({ finished: 1 });
    const where = db.templateJob.findMany.mock.calls[1][0].where;
    expect(where.status).toBe('RUNNING');
    expect(where.items).toEqual({ none: { status: { in: ['RUNNING', 'QUEUED'] } } });
    expect(db.templateJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'job_1', finishedAt: null },
      data: expect.objectContaining({ status: 'DONE' }),
    }));
  });

  it('never resurrects a cancelled job', async () => {
    await recoverStale();
    expect(db.templateJob.findMany.mock.calls[0][0].where.status).toBe('RUNNING');
  });
});

// ---------------------------------------------------------------- Excel

describe('jobSheetInputs', () => {
  it('exports the DONE files through the same builder a folder export uses', async () => {
    db.templateJob.findUnique.mockResolvedValue({
      ...job(),
      template: TEMPLATE,
      items: [
        { fileName: 'a.pdf', status: 'DONE', values: { total: value(229.4), num: value('17') } },
        { fileName: 'b.pdf', status: 'FAILED', values: null },
      ],
    });
    const out = await jobSheetInputs('job_1');
    expect(out!.inputs).toHaveLength(1);
    expect(out!.inputs[0].document.totals.total).toBe(229.4);
    // Το όνομα αρχείου χρησιμοποιεί την ΗΜΕΡΟΜΗΝΙΑ ΤΟΥ ΧΡΗΣΤΗ όταν υπάρχει.
    expect(out!.fileName).toBe('kapaline-2026-05-31-job_1.xlsx');
  });

  it('is null for a job that does not exist', async () => {
    db.templateJob.findUnique.mockResolvedValue(null);
    expect(await jobSheetInputs('nope')).toBeNull();
  });
});

// ---------------------------------------------------------------- ο worker

describe('the worker', () => {
  it('is off in tests, off under JOBS_DISABLED and off outside the node runtime', () => {
    expect(jobsDisabled()).toBe(true);                       // VITEST
    expect(startJobWorker()).toBe(false);
    expect((globalThis as Record<string, unknown>).__templateJobWorker).toBeUndefined();
  });

  it('starts once per process and stops cleanly', () => {
    const prev = { VITEST: process.env.VITEST, NODE_ENV: process.env.NODE_ENV, NEXT_RUNTIME: process.env.NEXT_RUNTIME };
    delete process.env.VITEST;
    vi.stubEnv('NODE_ENV', 'production');
    process.env.NEXT_RUNTIME = 'nodejs';
    try {
      expect(jobsDisabled()).toBe(false);
      expect(startJobWorker()).toBe(true);
      expect(startJobWorker()).toBe(false);                  // idempotent
      stopJobWorker();
      expect((globalThis as Record<string, unknown>).__templateJobWorker).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
      if (prev.VITEST) process.env.VITEST = prev.VITEST;
      if (prev.NEXT_RUNTIME) process.env.NEXT_RUNTIME = prev.NEXT_RUNTIME; else delete process.env.NEXT_RUNTIME;
    }
  });

  it('kicking a worker that was never started does nothing at all', () => {
    expect(() => kickJobWorker()).not.toThrow();
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
});
