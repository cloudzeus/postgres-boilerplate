// lib/templates/__tests__/jobs-routes.test.ts — τα routes των εργασιών σάρωσης, καλεσμένα ως handlers,
// με mocked rbac / βιβλιοθήκη εργασιών. Ελέγχουμε τι περνά στη βιβλιοθήκη και τι κωδικό παίρνει ο browser.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { rbac, jobs, audit, excel } = vi.hoisted(() => ({
  rbac: { requirePermission: vi.fn() },
  jobs: {
    createJob: vi.fn(), listJobs: vi.fn(), getJob: vi.fn(), cancelJob: vi.fn(),
    activeJobCount: vi.fn(), jobSheetInputs: vi.fn(),
    JobError: class JobError extends Error { constructor(public code: string) { super(code); } },
    JOB_ERROR: {
      not_found: { status: 404, body: { error: 'not_found' } },
      no_files: { status: 400, body: { error: 'no_files' } },
      too_many: { status: 400, body: { error: 'too_many' } },
      not_ready: { status: 422, body: { error: 'not_ready' } },
      too_large: { status: 413, body: { error: 'too_large' } },
      unsupported_type: { status: 415, body: { error: 'unsupported_type' } },
    },
  },
  audit: { logAudit: vi.fn() },
  excel: { sheetsToXlsx: vi.fn(), xlsxResponse: vi.fn() },
}));

// Το route εισάγει το `SAMPLE_MAX_BYTES` από το `sample.ts`, που φορτώνει Prisma: το mock υπάρχει
// ώστε να μη ζητηθεί DATABASE_URL για μια σταθερά.
vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/rbac', () => rbac);
vi.mock('@/lib/audit', () => audit);
vi.mock('@/lib/templates/jobs', () => jobs);
vi.mock('@/lib/templates/excel-server', () => excel);

import { POST as createRoute } from '@/app/api/admin/ocr/templates/[id]/jobs/route';
import { GET as listRoute } from '@/app/api/admin/ocr/templates/jobs/route';
import { GET as detailRoute } from '@/app/api/admin/ocr/templates/jobs/[jobId]/route';
import { POST as cancelRoute } from '@/app/api/admin/ocr/templates/jobs/[jobId]/cancel/route';
import { GET as excelRoute } from '@/app/api/admin/ocr/templates/jobs/[jobId]/excel/route';
import { emptyDocument } from '@/lib/ocr/canonical';

const USER = { id: 'u1', email: 'a@b.gr', role: { key: 'ADMIN' }, permissionKeys: new Set(['ocr.post']) };
const ctx = (id = 't1') => ({ params: Promise.resolve({ id }) });
const jobCtx = (jobId = 'job_1') => ({ params: Promise.resolve({ jobId }) });

const pdf = (name: string) => new File([Buffer.from('%PDF-1.4')], name, { type: 'application/pdf' });

const upload = (files: File[], meta: Record<string, string> = {}) => {
  const fd = new FormData();
  for (const f of files) fd.append('files', f);
  for (const [k, v] of Object.entries(meta)) fd.append(k, v);
  return new Request('http://localhost/x', { method: 'POST', body: fd });
};

beforeEach(() => {
  vi.clearAllMocks();
  rbac.requirePermission.mockResolvedValue(USER);
  jobs.createJob.mockResolvedValue({ jobId: 'job_1' });
  jobs.listJobs.mockResolvedValue([{ id: 'job_1' }]);
  jobs.getJob.mockResolvedValue({ id: 'job_1', items: [] });
  jobs.cancelJob.mockResolvedValue({ status: 'CANCELLED', pending: 3 });
  jobs.activeJobCount.mockResolvedValue(2);
  jobs.jobSheetInputs.mockResolvedValue({ fileName: 'kapaline.xlsx', inputs: [] });
  excel.sheetsToXlsx.mockResolvedValue(new ArrayBuffer(8));
  excel.xlsxResponse.mockImplementation(() => new Response('xlsx', { status: 200 }));
});

describe('POST templates/[id]/jobs', () => {
  it('hands the files and the metadata the user typed to the library, and answers 201', async () => {
    const res = await createRoute(upload([pdf('a.pdf'), pdf('b.pdf')], {
      title: 'Τιμολόγια Μαΐου', reference: 'ΠΑΡ-17', docDate: '2026-05-31',
      description: 'ο φάκελος', notifyEmails: 'a@x.gr',
    }), ctx());

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ jobId: 'job_1' });
    const [templateId, input] = jobs.createJob.mock.calls[0];
    expect(templateId).toBe('t1');
    expect(input.files.map((f: { fileName: string }) => f.fileName)).toEqual(['a.pdf', 'b.pdf']);
    expect(input).toMatchObject({ userId: 'u1', title: 'Τιμολόγια Μαΐου', reference: 'ΠΑΡ-17', description: 'ο φάκελος', notifyEmails: 'a@x.gr' });
    // Η ημερομηνία του χρήστη διαβάζεται ως ΗΜΕΡΑ, στην UTC — όχι στη ζώνη του server.
    expect(input.docDate.toISOString()).toBe('2026-05-31T00:00:00.000Z');
  });

  it('lets every metadata field be left empty', async () => {
    await createRoute(upload([pdf('a.pdf')]), ctx());
    expect(jobs.createJob.mock.calls[0][1]).toMatchObject({ title: null, reference: null, docDate: null, description: null, notifyEmails: null });
  });

  it('refuses an upload with no files and one with too many', async () => {
    expect((await createRoute(upload([]), ctx())).status).toBe(400);
    const many = Array.from({ length: 201 }, (_, i) => pdf(`f${i}.pdf`));
    expect((await createRoute(upload(many), ctx())).status).toBe(400);
    expect(jobs.createJob).not.toHaveBeenCalled();
  });

  it('refuses a malformed date instead of silently dropping it', async () => {
    const res = await createRoute(upload([pdf('a.pdf')], { docDate: '31/05/2026' }), ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_body');
  });

  it('turns a JobError into the one status code that error always has', async () => {
    jobs.createJob.mockRejectedValue(new jobs.JobError('not_ready'));
    const res = await createRoute(upload([pdf('a.pdf')]), ctx());
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('not_ready');
  });

  it('does not leak an unexpected failure as a 500 with a stack in it', async () => {
    jobs.createJob.mockRejectedValue(new Error('bunny exploded'));
    const res = await createRoute(upload([pdf('a.pdf')]), ctx());
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('bunny');
  });
});

describe('GET templates/jobs', () => {
  it('passes the filters through', async () => {
    await listRoute(new Request('http://localhost/x?templateId=t1&status=active&limit=20'));
    expect(jobs.listJobs).toHaveBeenCalledWith({ templateId: 't1', status: 'active', limit: 20 });
  });

  it('answers only the count when the sidebar asks for it', async () => {
    const res = await listRoute(new Request('http://localhost/x?count=1'));
    expect(await res.json()).toEqual({ active: 2 });
    expect(jobs.listJobs).not.toHaveBeenCalled();
  });
});

describe('GET templates/jobs/[jobId]', () => {
  it('answers 404 for a job that does not exist', async () => {
    jobs.getJob.mockResolvedValue(null);
    expect((await detailRoute(new Request('http://localhost/x'), jobCtx('nope'))).status).toBe(404);
  });

  it('returns the job otherwise', async () => {
    const res = await detailRoute(new Request('http://localhost/x'), jobCtx());
    expect(await res.json()).toEqual({ job: { id: 'job_1', items: [] } });
  });
});

describe('POST templates/jobs/[jobId]/cancel', () => {
  it('reports what will never run, and writes an audit entry', async () => {
    const res = await cancelRoute(new Request('http://localhost/x', { method: 'POST' }), jobCtx());
    expect(await res.json()).toEqual({ status: 'CANCELLED', pending: 3 });
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'template.job.cancel', resourceId: 'job_1' }));
  });

  it('answers 404 for a job that does not exist', async () => {
    jobs.cancelJob.mockRejectedValue(new jobs.JobError('not_found'));
    expect((await cancelRoute(new Request('http://localhost/x', { method: 'POST' }), jobCtx('nope'))).status).toBe(404);
  });
});

describe('GET templates/jobs/[jobId]/excel', () => {
  it('builds the workbook from the job’s sheet inputs', async () => {
    jobs.jobSheetInputs.mockResolvedValue({
      fileName: 'kapaline.xlsx',
      inputs: [{ templateSlug: 'k', templateName: 'K', file: 'a.pdf', fields: [], excelRows: null, values: {}, document: emptyDocument('invoice') }],
    });
    const res = await excelRoute(new Request('http://localhost/x'), jobCtx());
    expect(res.status).toBe(200);
    expect(excel.xlsxResponse).toHaveBeenCalledWith(expect.anything(), 'kapaline.xlsx');
  });

  it('answers 404 — not an empty workbook — while nothing has been read', async () => {
    const res = await excelRoute(new Request('http://localhost/x'), jobCtx());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('empty');
    expect(excel.sheetsToXlsx).not.toHaveBeenCalled();
  });

  it('answers 404 for a job that does not exist', async () => {
    jobs.jobSheetInputs.mockResolvedValue(null);
    expect((await excelRoute(new Request('http://localhost/x'), jobCtx('nope'))).status).toBe(404);
  });
});
