// POST multipart → νέα εργασία μαζικής σάρωσης με αυτό το πρότυπο (spec §12).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { createJob, JobError, JOB_ERROR } from '@/lib/templates/jobs';
import { MAX_JOB_FILES, MAX_JOB_TOTAL_BYTES } from '@/lib/templates/jobs-logic';
import { SAMPLE_MAX_BYTES } from '@/lib/templates/sample';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Μόνο το ΑΝΕΒΑΣΜΑ γίνεται εδώ (bytes → Bunny, μία μέτρηση σελίδων ανά αρχείο). Η ανάγνωση γίνεται
// στον worker, όχι στο αίτημα — γι' αυτό αυτό το route δεν περιμένει ποτέ κλήση όρασης.
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

/** Τα μεταδεδομένα που πληκτρολογεί ο χρήστης στον διάλογο ανεβάσματος. */
const Meta = z.object({
  title: z.string().trim().max(120).optional(),
  reference: z.string().trim().max(60).optional(),
  // `YYYY-MM-DD` από το <input type="date"> — ημερομηνία ΑΝΑΦΟΡΑΣ, όχι στιγμή δημιουργίας.
  //
  // Το regex από μόνο του δέχεται «2026-99-99», που γίνεται Invalid Date και σκάει στο
  // `templateJob.create` — ΜΕΤΑ το ανέβασμα, αφήνοντας τα αρχεία ορφανά στο Bunny. Άρα η
  // ημερομηνία γίνεται Date εδώ, και ό,τι δεν είναι αληθινή ημερομηνία γυρίζει 400 πριν από όλα.
  docDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/)
    .transform((v) => new Date(`${v}T00:00:00.000Z`))
    .refine((d) => !Number.isNaN(d.getTime()), 'Μη έγκυρη ημερομηνία')
    .optional(),
  description: z.string().trim().max(500).optional(),
  notifyEmails: z.string().trim().max(500).optional(),
});

export async function POST(req: Request, { params }: Ctx) {
  const u = await requirePermission('ocr.categorize');
  const { id } = await params;

  // Το σώμα ενός multipart αιτήματος περνά ΟΛΟΚΛΗΡΟ από τη μνήμη μέσα στο `formData()`: το πρώτο
  // φράγμα είναι το Content-Length, πριν διαβαστεί οτιδήποτε.
  if (Number(req.headers.get('content-length') ?? 0) > MAX_JOB_TOTAL_BYTES) {
    return NextResponse.json(JOB_ERROR.too_large_total.body, { status: 413 });
  }

  const form = await req.formData().catch(() => null);
  const files = (form?.getAll('files') ?? []).filter((f): f is File => f instanceof File);
  if (files.length === 0) return NextResponse.json(JOB_ERROR.no_files.body, { status: 400 });
  if (files.length > MAX_JOB_FILES) return NextResponse.json(JOB_ERROR.too_many.body, { status: 400 });

  const meta = Meta.safeParse(Object.fromEntries(
    ['title', 'reference', 'docDate', 'description', 'notifyEmails']
      .map((k) => [k, form?.get(k)])
      .filter(([, v]) => typeof v === 'string' && v !== ''),
  ));
  if (!meta.success) return NextResponse.json({ error: 'invalid_body', issues: meta.error.issues }, { status: 400 });

  // Το μέγεθος ελέγχεται ΠΡΙΝ διαβαστούν τα bytes: ένα αίτημα με 200 τεράστια αρχεία δεν πρέπει να
  // περάσει καν από τη μνήμη για να απορριφθεί.
  const tooBig = files.find((f) => f.size > SAMPLE_MAX_BYTES);
  if (tooBig) return NextResponse.json({ ...JOB_ERROR.too_large.body, fileName: tooBig.name }, { status: 413 });
  if (files.reduce((sum, f) => sum + f.size, 0) > MAX_JOB_TOTAL_BYTES) {
    return NextResponse.json(JOB_ERROR.too_large_total.body, { status: 413 });
  }

  try {
    const out = await createJob(id, {
      // Τεμπέλικα: τα bytes κάθε αρχείου διαβάζονται όταν έρθει η σειρά του να ανέβει, ένα τη φορά.
      files: files.map((f) => ({ fileName: f.name, size: f.size, read: async () => Buffer.from(await f.arrayBuffer()) })),
      userId: u.id,
      title: meta.data.title ?? null,
      reference: meta.data.reference ?? null,
      docDate: meta.data.docDate ?? null,
      description: meta.data.description ?? null,
      notifyEmails: meta.data.notifyEmails ?? null,
    });
    await logAudit({
      userId: u.id, userEmail: u.email, action: 'template.job.create', resource: 'templateJob', resourceId: out.jobId,
      metadata: { templateId: id, files: files.length, title: meta.data.title ?? null, reference: meta.data.reference ?? null },
    });
    return NextResponse.json(out, { status: 201 });
  } catch (e) {
    if (e instanceof JobError) return NextResponse.json(JOB_ERROR[e.code].body, { status: JOB_ERROR[e.code].status });
    console.error('[templates] job create failed', id, (e as Error).message);
    return NextResponse.json({ error: 'upload_failed', message: 'Το ανέβασμα απέτυχε' }, { status: 502 });
  }
}
