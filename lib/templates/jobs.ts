// lib/templates/jobs.ts — SERVER. Μαζική σάρωση αρχείων με ένα πρότυπο (spec §12, §13).
//
// Η εργασία ζει ΜΕΣΑ στη διεργασία του server: δεν υπάρχει ουρά, δεν υπάρχει δεύτερο container. Ένα
// `setInterval` ξεκινά από το `instrumentation.ts`, πιάνει ΜΙΑ εργασία τη φορά και τη δουλεύει αρχείο
// προς αρχείο. Αυτό είναι απόφαση, όχι παράλειψη: τα αρχεία διαβάζονται με κλήσεις όρασης που
// κοστίζουν, και μια δεύτερη διεργασία που θα έτρεχε την ίδια εργασία θα τις πλήρωνε δύο φορές.
//
// Γι' αυτό ό,τι πιάνεται, πιάνεται με `FOR UPDATE SKIP LOCKED`: δύο instance πίσω από τον ίδιο
// load balancer βλέπουν την ίδια βάση, και το κλείδωμα είναι το μόνο πράγμα που εγγυάται ότι ένα
// αρχείο το διαβάζει ένας. Και ό,τι μένει RUNNING πάνω από `STALE_MS` επιστρέφει στην ουρά: ένα
// deploy στη μέση μιας ανάγνωσης δεν πρέπει να αφήνει την εργασία μισή για πάντα.
import 'server-only';
import { nanoid } from 'nanoid';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { bunnyDelete, bunnyDownload, bunnyUploadPrivate } from '@/lib/bunny';
import { sendTransactionalEmail } from '@/lib/mailgun';
import { extractTemplateFields } from './extract';
import { applyRules, type RuleDef } from './conditions';
import { applySetFields, extrasFrom, readFlags, type RunFlags } from './run-logic';
import { projectToDocument } from './mapping';
import { emptyDocument } from '@/lib/ocr/canonical';
import { recipients } from './notify';
import { jobCompletionHtml, jobCompletionSubject, type TerminalJobStatus } from './jobs-notify';
import { toConditionDto, toFieldDef, toMappingDto } from './serialize';
import { sampleExt, SAMPLE_MAX_BYTES, samplePageCount, sniffSampleType } from './sample';
import {
  ACTIVE_JOB_STATUSES, finalJobStatus, isActive, jobToSheetInputs, MAX_JOB_FILES, progressOf, STALE_MS,
  type JobItemStatus, type JobProgress, type JobStatus,
} from './jobs-logic';
import type { FieldValue, MappingRowExcel, MappingRowInvoice } from './schema';
import type { SheetInput } from './excel';

/** Κάθε πόσο χτυπά ο worker όταν δεν έχει δουλειά. */
const TICK_MS = 5_000;

export class JobError extends Error {
  constructor(public code: 'not_found' | 'no_files' | 'too_many' | 'not_ready' | 'too_large' | 'unsupported_type') { super(code); }
}

/** Μία HTTP απάντηση ανά αστοχία, ώστε κάθε route εργασιών να λέει το ίδιο για το ίδιο πρόβλημα. */
export const JOB_ERROR: Record<JobError['code'], { status: number; body: { error: string; message?: string } }> = {
  not_found: { status: 404, body: { error: 'not_found' } },
  no_files: { status: 400, body: { error: 'no_files', message: 'Χρειάζεται τουλάχιστον ένα αρχείο' } },
  too_many: { status: 400, body: { error: 'too_many', message: `Έως ${MAX_JOB_FILES} αρχεία ανά εργασία` } },
  not_ready: { status: 422, body: { error: 'not_ready', message: 'Το πρότυπο δεν έχει πεδίο με περιοχή — σχεδίασε πρώτα τις περιοχές' } },
  too_large: { status: 413, body: { error: 'too_large', message: 'Μέγιστο 25 MB ανά αρχείο' } },
  unsupported_type: { status: 415, body: { error: 'unsupported_type', message: 'Δεκτά μόνο PDF, PNG, JPEG, WebP' } },
};

// ─────────────────────────────────────────────────────────── το πρότυπο, όπως το χρειάζεται ο worker

const TEMPLATE_FOR_JOB = { fields: true, mappings: true, conditions: true } as const;

type TemplateForJob = Prisma.ExtractionTemplateGetPayload<{ include: typeof TEMPLATE_FOR_JOB }>;

/** Τα πεδία με περιοχή, στη σειρά τους — μόνο αυτά μπορεί να διαβάσει ο εξαγωγέας. */
const readableFields = (t: TemplateForJob) =>
  [...t.fields].sort((a, b) => a.order - b.order).map(toFieldDef).filter((f) => f.region);

const allFields = (t: TemplateForJob) => [...t.fields].sort((a, b) => a.order - b.order).map(toFieldDef);

/** Οι γραμμές του mapping που ορίζουν το κανονικό έγγραφο μιας γραμμής Excel. */
function mappingRows(t: TemplateForJob): { invoice: MappingRowInvoice[]; excel: MappingRowExcel[] | null } {
  const dtos = t.mappings.map(toMappingDto);
  const invoice = dtos.filter((m) => m.target === 'INVOICE');
  const excel = dtos.filter((m) => m.target === 'EXCEL');
  const pickedInvoice = invoice.find((m) => m.isDefault) ?? invoice[0];
  const pickedExcel = excel.find((m) => m.isDefault) ?? excel[0];
  const excelRows = (pickedExcel?.rows ?? []) as MappingRowExcel[];
  return { invoice: (pickedInvoice?.rows ?? []) as MappingRowInvoice[], excel: excelRows.length ? excelRows : null };
}

// ─────────────────────────────────────────────────────────── δημιουργία

export type CreateJobInput = {
  files: { buffer: Buffer; fileName: string }[];
  userId?: string | null;
  title?: string | null;
  reference?: string | null;
  docDate?: Date | null;
  description?: string | null;
  notifyEmails?: string | null;
};

/**
 * Ανεβάζει τα αρχεία και γράφει την εργασία. Τα αρχεία πάνε ΠΡΩΤΑ στο Bunny και μετά γράφεται η
 * γραμμή: μια εργασία που δείχνει σε αρχεία που δεν ανέβηκαν θα ξεκινούσε και θα αποτύγχανε αμέσως.
 * Ό,τι ανέβηκε πριν από ένα σφάλμα σβήνεται — καλύτερα τίποτα παρά μισή εργασία.
 */
export async function createJob(templateId: string, input: CreateJobInput): Promise<{ jobId: string }> {
  const t = await prisma.extractionTemplate.findUnique({ where: { id: templateId }, include: TEMPLATE_FOR_JOB });
  if (!t) throw new JobError('not_found');
  if (input.files.length === 0) throw new JobError('no_files');
  if (input.files.length > MAX_JOB_FILES) throw new JobError('too_many');
  // Χωρίς πεδίο με περιοχή ο εξαγωγέας δεν έχει τι να διαβάσει: η εργασία θα έβγαζε 200 άδειες γραμμές.
  if (readableFields(t).length === 0) throw new JobError('not_ready');

  const jobId = `job_${nanoid(16)}`;
  const uploaded: { order: number; fileName: string; storageKey: string; mimeType: string; size: number; page: number }[] = [];
  try {
    for (const [order, f] of input.files.entries()) {
      if (f.buffer.length > SAMPLE_MAX_BYTES) throw new JobError('too_large');
      const mimeType = sniffSampleType(f.buffer);                 // πετά SampleError('unsupported_type')
      const key = `templates/${templateId}/jobs/${jobId}/${String(order).padStart(3, '0')}.${sampleExt(mimeType)}`;
      await bunnyUploadPrivate({ key, body: f.buffer, contentType: mimeType });
      uploaded.push({
        order, fileName: f.fileName.slice(0, 255) || `file-${order}`, storageKey: key, mimeType,
        size: f.buffer.length, page: await samplePageCount(f.buffer, mimeType),
      });
    }
  } catch (e) {
    if (uploaded.length) await bunnyDelete(uploaded.map((u) => u.storageKey)).catch(() => null);
    if (e instanceof JobError) throw e;
    // Ο sniffer πετά `SampleError`, που έχει το ίδιο λεξιλόγιο κωδικών — μεταφράζεται εδώ.
    const code = (e as { code?: string }).code;
    if (code === 'unsupported_type' || code === 'too_large') throw new JobError(code);
    throw e;
  }

  const job = await prisma.templateJob.create({
    data: {
      id: jobId,
      templateId,
      templateVersion: t.version,
      status: 'QUEUED',
      total: uploaded.length,
      createdById: input.userId ?? null,
      title: input.title?.slice(0, 120) || null,
      reference: input.reference?.slice(0, 60) || null,
      docDate: input.docDate ?? null,
      description: input.description?.slice(0, 500) || null,
      // Κενό = «ό,τι λέει το πρότυπο»: η αποθηκευμένη τιμή μένει null και η επιλογή γίνεται στο τέλος,
      // ώστε μια αλλαγή στα emails του προτύπου να πιάνει και τις εργασίες που τρέχουν ήδη.
      notifyEmails: input.notifyEmails?.slice(0, 500) || null,
      items: { create: uploaded.map((u) => ({ ...u, status: 'QUEUED' as const })) },
    },
    select: { id: true },
  });

  kickJobWorker();
  return { jobId: job.id };
}

// ─────────────────────────────────────────────────────────── διεκδίκηση (SKIP LOCKED)

/**
 * Πιάνει την παλαιότερη QUEUED εργασία και τη γυρίζει RUNNING, ατομικά. `FOR UPDATE SKIP LOCKED`:
 * δύο instance που χτυπούν ταυτόχρονα ΔΕΝ περιμένουν το ένα το άλλο — το δεύτερο προσπερνά τη
 * γραμμή και πιάνει την επόμενη ή τίποτα.
 */
export async function claimJob(): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "TemplateJob" SET status = 'RUNNING', "startedAt" = COALESCE("startedAt", now())
    WHERE id = (
      SELECT id FROM "TemplateJob" WHERE status = 'QUEUED' ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING id`;
  return rows[0]?.id ?? null;
}

/** Το ίδιο, για ΕΝΑ αρχείο μιας συγκεκριμένης εργασίας. */
async function claimItem(jobId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "TemplateJobItem" SET status = 'RUNNING', "startedAt" = now()
    WHERE id = (
      SELECT id FROM "TemplateJobItem" WHERE "jobId" = ${jobId} AND status = 'QUEUED' ORDER BY "order" LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING id`;
  return rows[0]?.id ?? null;
}

/**
 * Ό,τι κόλλησε επιστρέφει στην ουρά:
 *  · αντικείμενα RUNNING παλαιότερα από `STALE_MS` (η διεργασία που τα κρατούσε δεν υπάρχει πια)·
 *  · εργασίες RUNNING χωρίς κανένα RUNNING αντικείμενο αλλά με QUEUED να περιμένουν.
 * Δεν αγγίζει ΠΟΤΕ CANCELLED: η ακύρωση είναι δήλωση του χρήστη, όχι κατάσταση προς ανάκτηση.
 */
export async function recoverStale(): Promise<{ items: number; jobs: number }> {
  const cutoff = new Date(Date.now() - STALE_MS);
  const items = await prisma.templateJobItem.updateMany({
    where: { status: 'RUNNING', OR: [{ startedAt: null }, { startedAt: { lt: cutoff } }] },
    data: { status: 'QUEUED', startedAt: null },
  });

  const stuck = await prisma.templateJob.findMany({
    where: { status: 'RUNNING', items: { none: { status: 'RUNNING' } }, AND: [{ items: { some: { status: 'QUEUED' } } }] },
    select: { id: true },
  });
  if (stuck.length === 0) return { items: items.count, jobs: 0 };
  const jobs = await prisma.templateJob.updateMany({ where: { id: { in: stuck.map((j) => j.id) }, status: 'RUNNING' }, data: { status: 'QUEUED' } });
  return { items: items.count, jobs: jobs.count };
}

// ─────────────────────────────────────────────────────────── επεξεργασία

/**
 * Διαβάζει ΕΝΑ αρχείο με το πρότυπο και γράφει το αποτέλεσμα στη γραμμή του. Δεν πετά ποτέ: μια
 * αποτυχία είναι η κατάσταση FAILED αυτού του αρχείου και τίποτα άλλο — τα υπόλοιπα συνεχίζουν.
 *
 * Μια εργασία ΔΕΝ αγγίζει `OcrDocument`: δεν προβάλλει τίποτα, δεν αναρτά τίποτα, δεν στέλνει
 * ειδοποιήσεις κανόνων. Είναι ανάγνωση σε πίνακα, όχι ροή εγγράφου (spec §12).
 */
export async function processItem(itemId: string, template?: TemplateForJob): Promise<'DONE' | 'FAILED'> {
  const started = Date.now();
  const item = await prisma.templateJobItem.findUnique({ where: { id: itemId } });
  if (!item) return 'FAILED';
  const t = template ?? (await prisma.templateJob.findUnique({ where: { id: item.jobId }, select: { template: { include: TEMPLATE_FOR_JOB } } }))?.template;
  if (!t) {
    await finishItem(itemId, 'FAILED', { error: 'template not found', durationMs: Date.now() - started });
    return 'FAILED';
  }

  try {
    const fields = readableFields(t);
    const buffer = await bunnyDownload(item.storageKey);
    const ex = await extractTemplateFields(buffer, item.mimeType, fields, { ref: { refType: 'TemplateJobItem', refId: item.id } });

    // Οι κανόνες χρειάζονται `$total`/`$itemsCount`: σε μια εκτέλεση τα δίνει το βασικό OCR, εδώ δεν
    // υπάρχει βασικό OCR — άρα τα δίνει η ΙΔΙΑ η ανάγνωση, προβαλλόμενη σε ένα άδειο τιμολόγιο.
    const rows = mappingRows(t);
    const provisional = projectToDocument(ex.values, rows.invoice, emptyDocument('invoice'), allFields(t));
    const rules: RuleDef[] = [...t.conditions].sort((a, b) => a.order - b.order).map(toConditionDto);
    const applied = applyRules(rules, {
      values: ex.values,
      valueTypes: Object.fromEntries(allFields(t).map((f) => [f.key, f.valueType])),
      extras: extrasFrom(provisional, provisional.lines.length, ex.pageCount),
    });
    const values = applySetFields(ex.values, allFields(t), applied.setFields);
    const flags: RunFlags = readFlags({
      fields: allFields(t), values, mode: t.mode, errors: ex.errors, adaptive: ex.adaptive ?? [], rules: applied.flags,
    });

    await finishItem(itemId, 'DONE', {
      values: values as unknown as Prisma.InputJsonValue,
      matched: applied.matched as unknown as Prisma.InputJsonValue,
      flags: flags as unknown as Prisma.InputJsonValue,
      model: ex.model,
      tokensUsed: ex.tokensUsed,
      page: ex.pageCount,
      durationMs: Date.now() - started,
      error: null,
    });
    return 'DONE';
  } catch (e) {
    const error = String((e as Error)?.message ?? e).slice(0, 2000);
    console.error('[templates] job item failed', itemId, error);
    await finishItem(itemId, 'FAILED', { error, durationMs: Date.now() - started }).catch(() => null);
    return 'FAILED';
  }
}

async function finishItem(id: string, status: 'DONE' | 'FAILED', data: Prisma.TemplateJobItemUncheckedUpdateInput): Promise<void> {
  await prisma.templateJobItem.update({ where: { id }, data: { ...data, status, finishedAt: new Date() } });
}

/**
 * Δουλεύει μια εργασία μέχρι να μη μείνει αρχείο. Πριν από ΚΑΘΕ αρχείο ξαναρωτά την κατάστασή της:
 * μια ακύρωση που έφτασε στο μεταξύ σταματά εδώ, και τα QUEUED αρχεία ΜΕΝΟΥΝ QUEUED — η ακύρωση
 * είναι «μη διαβάσεις άλλα», όχι «σβήσε ό,τι έγινε» (spec §13).
 */
export async function processJob(jobId: string): Promise<void> {
  const job = await prisma.templateJob.findUnique({ where: { id: jobId }, select: { template: { include: TEMPLATE_FOR_JOB } } });
  const t = job?.template;
  if (!t) {
    await prisma.templateJob.update({ where: { id: jobId }, data: { status: 'FAILED', finishedAt: new Date() } }).catch(() => null);
    return;
  }

  for (;;) {
    const current = await prisma.templateJob.findUnique({ where: { id: jobId }, select: { status: true } });
    if (!current || !isActive(current.status)) return;              // ακυρώθηκε ή τελείωσε αλλού

    const itemId = await claimItem(jobId);
    if (itemId == null) break;

    const outcome = await processItem(itemId, t);
    await prisma.templateJob.update({
      where: { id: jobId },
      data: outcome === 'DONE' ? { done: { increment: 1 } } : { failed: { increment: 1 } },
    }).catch((e) => console.error('[templates] job counter not updated', jobId, (e as Error).message));
  }

  const counts = await prisma.templateJob.findUnique({ where: { id: jobId }, select: { status: true, total: true, done: true, failed: true } });
  if (!counts || !isActive(counts.status)) return;
  await finishJob(jobId, finalJobStatus(counts));
}

/**
 * Κλείνει την εργασία και στέλνει ΕΝΑ email. Το `finishedAt: null` στο `where` είναι το κλειδί:
 * είναι η ίδια η ενημέρωση που κερδίζει τη μετάβαση, οπότε δύο instance που τελειώνουν ταυτόχρονα
 * την ίδια εργασία στέλνουν ένα email, όχι δύο. Ένα email που δεν φεύγει δεν αλλάζει την εργασία.
 */
async function finishJob(jobId: string, status: TerminalJobStatus): Promise<void> {
  const updated = await prisma.templateJob.updateMany({
    where: { id: jobId, finishedAt: null },
    data: { status, finishedAt: new Date() },
  });
  if (updated.count === 0) return;
  await notifyJobFinished(jobId, status).catch((e) => console.error('[templates] job mail failed', jobId, (e as Error).message));
}

const APP_URL = () => process.env.APP_URL ?? '';

async function notifyJobFinished(jobId: string, status: TerminalJobStatus): Promise<void> {
  const job = await prisma.templateJob.findUnique({
    where: { id: jobId },
    include: { template: { select: { name: true, notifyEmails: true } } },
  });
  if (!job) return;
  const to = recipients(job.notifyEmails ?? job.template.notifyEmails);
  if (to.length === 0) return;                                     // κανείς να ειδοποιηθεί — σιωπή

  const title = job.title || `${job.template.name} · ${job.createdAt.toISOString().slice(0, 10)}`;
  const appUrl = APP_URL();
  const html = jobCompletionHtml({
    status,
    title,
    templateName: job.template.name,
    reference: job.reference,
    docDate: job.docDate,
    description: job.description,
    total: job.total,
    done: job.done,
    failed: job.failed,
    durationMs: job.startedAt && job.finishedAt ? job.finishedAt.getTime() - job.startedAt.getTime() : null,
    link: appUrl ? `${appUrl}/admin/ocr/templates/jobs/${job.id}` : '',
  });
  await sendTransactionalEmail(to.join(', '), jobCompletionSubject({ status, title }), html);
}

// ─────────────────────────────────────────────────────────── ακύρωση

/**
 * «Σταμάτα εδώ». Ό,τι διαβάστηκε μένει διαβασμένο και εξάγεται κανονικά· ό,τι δεν ξεκίνησε δεν θα
 * ξεκινήσει (spec §13). Το αρχείο που τρέχει ΑΥΤΗ τη στιγμή το αφήνουμε να τελειώσει — η κλήση
 * όρασης έχει ήδη πληρωθεί, και το να πεταχτεί το αποτέλεσμά της δεν ωφελεί κανέναν.
 */
export async function cancelJob(jobId: string): Promise<{ status: string; pending: number }> {
  const job = await prisma.templateJob.findUnique({ where: { id: jobId }, select: { status: true } });
  if (!job) throw new JobError('not_found');
  if (!isActive(job.status)) {
    const pending = await prisma.templateJobItem.count({ where: { jobId, status: 'QUEUED' } });
    return { status: job.status, pending };
  }
  const pending = await prisma.templateJobItem.count({ where: { jobId, status: 'QUEUED' } });
  await finishJob(jobId, 'CANCELLED');
  // `finishJob` δεν αγγίζει το status όταν η εργασία έχει ήδη `finishedAt` — τότε κέρδισε ο worker.
  const after = await prisma.templateJob.findUnique({ where: { id: jobId }, select: { status: true } });
  return { status: after?.status ?? 'CANCELLED', pending };
}

// ─────────────────────────────────────────────────────────── ανάγνωση για το UI

/** Ο τίτλος που βλέπει ο χρήστης: ό,τι έγραψε, αλλιώς «<πρότυπο> · <ημερομηνία>». */
export function jobTitle(j: { title: string | null; createdAt: Date; docDate: Date | null }, templateName: string): string {
  return j.title || `${templateName} · ${(j.docDate ?? j.createdAt).toISOString().slice(0, 10)}`;
}

export type JobListRow = {
  id: string; title: string; reference: string | null; description: string | null;
  templateId: string; templateName: string; templateSlug: string;
  status: JobStatus; total: number; done: number; failed: number; progress: JobProgress;
  /** Η ημερομηνία που δηλώνει η εργασία (`docDate`), αλλιώς πότε δημιουργήθηκε. */
  date: string; createdAt: string; startedAt: string | null; finishedAt: string | null;
};

const JOB_LIST_SELECT = {
  id: true, title: true, reference: true, description: true, status: true, total: true, done: true, failed: true,
  docDate: true, createdAt: true, startedAt: true, finishedAt: true,
  template: { select: { id: true, name: true, slug: true } },
} as const;

type JobListDbRow = Prisma.TemplateJobGetPayload<{ select: typeof JOB_LIST_SELECT }>;

function toJobListRow(j: JobListDbRow): JobListRow {
  return {
    id: j.id,
    title: jobTitle(j, j.template.name),
    reference: j.reference,
    description: j.description,
    templateId: j.template.id, templateName: j.template.name, templateSlug: j.template.slug,
    status: j.status as JobStatus,
    total: j.total, done: j.done, failed: j.failed,
    progress: progressOf(j),
    date: (j.docDate ?? j.createdAt).toISOString(),
    createdAt: j.createdAt.toISOString(),
    startedAt: j.startedAt?.toISOString() ?? null,
    finishedAt: j.finishedAt?.toISOString() ?? null,
  };
}

/** Οι τελευταίες εργασίες, νεότερη πρώτα. `status: 'active'` = ό,τι τρέχει ή περιμένει. */
export async function listJobs(filter: { templateId?: string; status?: string; limit?: number } = {}): Promise<JobListRow[]> {
  const status = filter.status === 'active'
    ? { in: [...ACTIVE_JOB_STATUSES] }
    : filter.status
      ? { equals: filter.status as JobStatus }
      : undefined;
  const rows = await prisma.templateJob.findMany({
    where: { ...(filter.templateId && { templateId: filter.templateId }), ...(status && { status }) },
    orderBy: { createdAt: 'desc' },
    take: Math.min(200, Math.max(1, filter.limit ?? 100)),
    select: JOB_LIST_SELECT,
  });
  return rows.map(toJobListRow);
}

/** Πόσες εργασίες τρέχουν ή περιμένουν — το σήμα στο πλαϊνό μενού. */
export async function activeJobCount(): Promise<number> {
  return prisma.templateJob.count({ where: { status: { in: [...ACTIVE_JOB_STATUSES] } } });
}

export type JobItemRow = {
  id: string; order: number; fileName: string; status: JobItemStatus; page: number | null;
  values: Record<string, FieldValue> | null; flags: RunFlags | null;
  model: string | null; tokensUsed: number | null; durationMs: number | null; error: string | null;
};

export type JobDetail = JobListRow & {
  /** Τα πεδία του προτύπου, για τις στήλες του πίνακα — με τα χρώματα που έχουν και στον σχεδιαστή. */
  fields: { key: string; label: string; kind: string; color: string }[];
  items: JobItemRow[];
};

export async function getJob(jobId: string): Promise<JobDetail | null> {
  const j = await prisma.templateJob.findUnique({
    where: { id: jobId },
    select: {
      ...JOB_LIST_SELECT,
      template: { select: { id: true, name: true, slug: true, fields: { orderBy: { order: 'asc' }, select: { key: true, label: true, kind: true, color: true } } } },
      items: {
        orderBy: { order: 'asc' },
        select: { id: true, order: true, fileName: true, status: true, page: true, values: true, flags: true, model: true, tokensUsed: true, durationMs: true, error: true },
      },
    },
  });
  if (!j) return null;
  return {
    ...toJobListRow(j as unknown as JobListDbRow),
    fields: j.template.fields,
    items: j.items.map((i) => ({
      id: i.id, order: i.order, fileName: i.fileName, status: i.status as JobItemStatus, page: i.page,
      values: (i.values as Record<string, FieldValue> | null) ?? null,
      flags: (i.flags as RunFlags | null) ?? null,
      model: i.model, tokensUsed: i.tokensUsed, durationMs: i.durationMs, error: i.error,
    })),
  };
}

// ─────────────────────────────────────────────────────────── Excel

/** Τα φύλλα μιας εργασίας — ίδιος εξαγωγέας με τις εκτελέσεις. */
export async function jobSheetInputs(jobId: string): Promise<{ fileName: string; inputs: SheetInput[] } | null> {
  const job = await prisma.templateJob.findUnique({
    where: { id: jobId },
    include: {
      template: { include: TEMPLATE_FOR_JOB },
      items: { orderBy: { order: 'asc' }, select: { fileName: true, status: true, values: true } },
    },
  });
  if (!job) return null;
  const rows = mappingRows(job.template);
  const inputs = jobToSheetInputs({
    templateSlug: job.template.slug,
    templateName: job.template.name,
    fields: allFields(job.template),
    invoiceRows: rows.invoice,
    excelRows: rows.excel,
    items: job.items as { fileName: string; status: string; values: unknown }[],
  });
  const stamp = (job.docDate ?? job.createdAt).toISOString().slice(0, 10);
  return { fileName: `${job.template.slug}-${stamp}-${job.id.slice(-6)}.xlsx`, inputs };
}

// ─────────────────────────────────────────────────────────── ο worker

type WorkerHandle = { timer: ReturnType<typeof setInterval>; running: boolean };
const globalForWorker = globalThis as unknown as { __templateJobWorker?: WorkerHandle };

/** Ο worker είναι εκτός λειτουργίας σε edge runtime, σε tests, και όποτε το ζητά το `JOBS_DISABLED`. */
export function jobsDisabled(): boolean {
  if (process.env.JOBS_DISABLED === '1') return true;
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return true;
  // `NEXT_RUNTIME` λείπει όταν ο κώδικας τρέχει εκτός Next (scripts) — εκεί ο worker δεν έχει νόημα.
  return (process.env.NEXT_RUNTIME ?? '') !== 'nodejs';
}

/**
 * ΕΝΑ χτύπημα: ανακτά ό,τι κόλλησε, πιάνει μία εργασία και τη δουλεύει. Τυλιγμένο ολόκληρο σε
 * try/catch — τρέχει από `setInterval`, όπου μια εξαίρεση που ξεφεύγει ΡΙΧΝΕΙ τη διεργασία του server.
 * Ένα χτύπημα δεν ξεκινά όσο το προηγούμενο δουλεύει ακόμη (`running`).
 */
async function tick(handle: WorkerHandle): Promise<void> {
  if (handle.running) return;
  handle.running = true;
  try {
    await recoverStale();
    const jobId = await claimJob();
    if (jobId) await processJob(jobId);
  } catch (e) {
    console.error('[templates] job worker tick failed', (e as Error).message);
  } finally {
    handle.running = false;
  }
}

/**
 * Ξεκινά τον worker μία φορά ανά διεργασία. Ο δείκτης ζει στο `globalThis`, γιατί το hot reload του
 * Next ξαναφορτώνει το module και ένα δεύτερο `setInterval` θα δούλευε την ίδια βάση παράλληλα.
 */
export function startJobWorker(): boolean {
  if (jobsDisabled()) return false;
  if (globalForWorker.__templateJobWorker) return false;
  const handle: WorkerHandle = { timer: null as unknown as ReturnType<typeof setInterval>, running: false };
  handle.timer = setInterval(() => { void tick(handle); }, TICK_MS);
  // Ο χρονομετρητής δεν κρατά τη διεργασία ζωντανή από μόνος του: ένα script που τελείωσε πρέπει να
  // μπορεί να βγει, ακόμη κι αν κάποιος φόρτωσε αυτό το module.
  handle.timer.unref?.();
  globalForWorker.__templateJobWorker = handle;
  console.log('[templates] job worker started');
  return true;
}

export function stopJobWorker(): void {
  const handle = globalForWorker.__templateJobWorker;
  if (!handle) return;
  clearInterval(handle.timer);
  globalForWorker.__templateJobWorker = undefined;
}

/**
 * «Κοίτα τώρα» — καλείται μόλις δημιουργηθεί εργασία, ώστε να μην περιμένει τον επόμενο κύκλο.
 * Δεν περιμένει το αποτέλεσμα: το route που ανέβασε τα αρχεία πρέπει να απαντήσει αμέσως.
 */
export function kickJobWorker(): void {
  const handle = globalForWorker.__templateJobWorker;
  if (!handle) return;
  void tick(handle);
}
