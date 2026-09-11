// lib/templates/samples.ts — SERVER. Τα δείγματα εκπαίδευσης ενός προτύπου (spec §11).
//
// Ένα πρότυπο σχεδιάζεται πάνω σε ΕΝΑ αρχείο και μετά καλείται να διαβάσει εκατοντάδες. Τα δείγματα
// είναι η απάντηση στο «πόσο καλά το κάνει»: ανεβαίνουν πολλά αρχεία του ίδιου εντύπου, το πρότυπο
// τα διαβάζει, ο χρήστης επιβεβαιώνει τι ΕΠΡΕΠΕ να διαβάσει, και η συμφωνία των δύο είναι ο βαθμός
// εκπαίδευσης — το κατώφλι που πρέπει να περάσει ένα πρότυπο πριν ενεργοποιηθεί (`trainingGate`).
//
// Τίποτα εδώ δεν μαθαίνει θέσεις (`lastGood`): αυτό συμβαίνει μόνο από πραγματικές εκτελέσεις που
// κάποιος επιβεβαίωσε (run.ts). Η ανάγνωση δείγματος είναι μέτρηση, όχι εκπαίδευση.
import 'server-only';
import { nanoid } from 'nanoid';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { bunnyDelete, bunnyDownload, bunnyUploadPrivate } from '@/lib/bunny';
import { extractTemplateFields } from './extract';
import { toFieldDef } from './serialize';
import { buildFingerprint, toFingerprint, type Fingerprint } from './fingerprint';
import { fingerprintOfSample, sampleExt, samplePageCount, SampleError, SAMPLE_MAX_BYTES, sniffSampleType } from './sample';
import {
  sampleScore, scoreSamples, trainingGate,
  type FieldScore, type GateResult, type TrainingField,
} from './training';
import type { FieldValue } from './schema';

/** Πόσα δείγματα δέχεται ένα αίτημα — ο uploader σπάει τα πολλά σε παρτίδες. */
export const SAMPLES_PER_REQUEST = 20;

/** Η γραμμή όπως τη βλέπει το UI. Το fingerprint ΔΕΝ ταξιδεύει: είναι εσωτερικό του αναγνωριστή. */
export type SampleDto = {
  id: string;
  fileName: string;
  status: string;
  pageCount: number | null;
  score: number | null;
  expected: Record<string, unknown> | null;
  lastResult: Record<string, FieldValue> | null;
  isPrimary: boolean;
  createdAt: string;
};

type SampleRow = {
  id: string; fileName: string; status: string; pageCount: number | null; score: number | null;
  expected: unknown; lastResult: unknown; isPrimary: boolean; createdAt: Date;
};

export function toSampleDto(s: SampleRow): SampleDto {
  return {
    id: s.id, fileName: s.fileName, status: s.status, pageCount: s.pageCount, score: s.score,
    expected: isRecord(s.expected) ? s.expected : null,
    lastResult: isRecord(s.lastResult) ? (s.lastResult as Record<string, FieldValue>) : null,
    isPrimary: s.isPrimary, createdAt: s.createdAt.toISOString(),
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

const SAMPLE_SELECT = {
  id: true, fileName: true, status: true, pageCount: true, score: true,
  expected: true, lastResult: true, isPrimary: true, createdAt: true,
} as const;

/** Ο βαθμός του προτύπου όπως τον υπολογίζει το `scoreSamples`, μαζί με την ετυμηγορία της πύλης. */
export type TrainingSummary = {
  trainingScore: number | null;
  verifiedSamples: number;
  perField: Record<string, FieldScore>;
  gate: GateResult;
};

// ─────────────────────────────────────────────────────────────── φόρτωση προτύπου

type TemplateForTraining = {
  id: string; supplierName: string | null; vatNumber: string | null;
  minTrainingScore: number; minTrainingSamples: number;
  fields: Parameters<typeof toFieldDef>[0][];
};

async function loadTemplate(templateId: string): Promise<TemplateForTraining> {
  const t = await prisma.extractionTemplate.findUnique({ where: { id: templateId }, include: { fields: true } });
  if (!t) throw new SampleError('not_found');
  return t as unknown as TemplateForTraining;
}

/** Τα πεδία με περιοχή, στη σειρά τους — μόνο αυτά μπορεί να διαβάσει ο εξαγωγέας. */
const readableFields = (t: TemplateForTraining) =>
  [...t.fields].sort((a, b) => a.order - b.order).map(toFieldDef).filter((f) => f.region);

/** Τα πεδία που βαθμολογούνται — ΟΛΑ, ακόμη και όσα δεν έχουν περιοχή (ένα τέτοιο απλώς σκοράρει 0). */
const scorableFields = (t: TemplateForTraining): TrainingField[] =>
  [...t.fields].sort((a, b) => a.order - b.order).map((f) => ({ key: f.key, valueType: f.valueType, required: f.required }));

// ─────────────────────────────────────────────────────────────── προσθήκη

export async function listSamples(templateId: string): Promise<SampleDto[]> {
  const rows = await prisma.templateSample.findMany({
    where: { templateId }, orderBy: { createdAt: 'asc' }, select: SAMPLE_SELECT,
  });
  return rows.map(toSampleDto);
}

/**
 * Ανεβάζει ΕΝΑ αρχείο ως δείγμα. Ο τύπος κρίνεται από τα bytes, όχι από ό,τι δηλώνει ο browser, και
 * το αποτύπωμα διάταξης χτίζεται εδώ — μία φορά, όσο το αρχείο είναι ακόμη στη μνήμη.
 */
export async function addSample(
  templateId: string,
  input: { buffer: Buffer; fileName: string; userId?: string | null },
): Promise<SampleDto> {
  const t = await loadTemplate(templateId);
  if (input.buffer.length > SAMPLE_MAX_BYTES) throw new SampleError('too_large');
  const mimeType = sniffSampleType(input.buffer);
  return storeSampleRow(t, input.buffer, mimeType, input.fileName, input.userId ?? null);
}

async function storeSampleRow(
  t: TemplateForTraining, buffer: Buffer, mimeType: string, fileName: string, userId: string | null,
  fingerprint?: Fingerprint | null,
): Promise<SampleDto> {
  const pageCount = await samplePageCount(buffer, mimeType);
  const key = `templates/${t.id}/samples/${nanoid(12)}.${sampleExt(mimeType)}`;
  await bunnyUploadPrivate({ key, body: buffer, contentType: mimeType });

  const fp = fingerprint !== undefined
    ? fingerprint
    : await fingerprintOfSample(buffer, mimeType, { issuerName: t.supplierName, afm: t.vatNumber })
      .catch((e) => { console.warn('[templates] sample fingerprint failed', t.id, (e as Error).message); return null; });

  const row = await prisma.templateSample.create({
    data: {
      templateId: t.id,
      fileName: fileName.slice(0, 255) || 'sample',
      storageKey: key,
      mimeType,
      pageCount,
      status: 'PENDING',
      isPrimary: false,
      createdById: userId,
      fingerprint: (fp ?? null) as unknown as Prisma.InputJsonValue,
    },
    select: SAMPLE_SELECT,
  });
  return toSampleDto(row);
}

/**
 * Το αρχείο ενός ήδη σαρωμένου εγγράφου γίνεται δείγμα του προτύπου — η αφορμή είναι το «Άγνωστο
 * έντυπο» της καρτέλας εκτέλεσης (§14.7): ο χρήστης διάλεξε πρότυπο με το χέρι, άρα ξέρει κάτι που
 * ο αναγνωριστής δεν ήξερε, και αυτό το κάτι αξίζει να μπει στην εκπαίδευση.
 *
 * Το αποτύπωμα χτίζεται από το OCR που ΥΠΑΡΧΕΙ ήδη (εκδότης + rawText) — καμία νέα κλήση.
 */
export async function sampleFromDocument(templateId: string, documentId: string, userId?: string | null): Promise<SampleDto> {
  const t = await loadTemplate(templateId);
  const doc = await prisma.ocrDocument.findUnique({
    where: { id: documentId },
    select: { fileName: true, storageKey: true, mimeType: true, rawText: true, issuerAfm: true, document: true },
  });
  if (!doc) throw new SampleError('not_found');

  const buffer = await bunnyDownload(doc.storageKey);
  if (buffer.length > SAMPLE_MAX_BYTES) throw new SampleError('too_large');
  const mimeType = sniffSampleType(buffer);

  const issuer = isRecord(doc.document) && isRecord(doc.document.issuer) ? doc.document.issuer : {};
  const fp = buildFingerprint({
    issuerName: typeof issuer.name === 'string' ? issuer.name : t.supplierName,
    afm: doc.issuerAfm ?? issuer.vat ?? t.vatNumber,
    text: doc.rawText,
    // Το σχήμα της σελίδας το ξέρει μόνο το ίδιο το αρχείο· αν δεν διαβάζεται, το κομμάτι απλώς λείπει.
    aspect: null,
  });
  return storeSampleRow(t, buffer, mimeType, doc.fileName, userId ?? null, fp);
}

// ─────────────────────────────────────────────────────────────── ανάγνωση

export type ReadSampleResult = { sample: SampleDto; model: string | null; tokensUsed: number; errors: { fieldKey: string; message: string }[] };

/**
 * Βάζει το πρότυπο να διαβάσει ΕΝΑ δείγμα και κρατά ό,τι διάβασε (`lastResult`).
 *
 * Ένα δείγμα που ο χρήστης έχει ήδη επιβεβαιώσει ΜΕΝΕΙ επιβεβαιωμένο: η επιβεβαίωση είναι δική του
 * δήλωση για το έγγραφο, δεν την ακυρώνει μια νέα ανάγνωση. Αυτό που αλλάζει είναι ο βαθμός — ο
 * λόγος που ξαναδιαβάζει κανείς μετά από αλλαγή περιοχών είναι ακριβώς να δει τον βαθμό να ανεβαίνει.
 */
export async function readSample(sampleId: string): Promise<ReadSampleResult> {
  const s = await prisma.templateSample.findUnique({ where: { id: sampleId } });
  if (!s) throw new SampleError('not_found');
  const t = await loadTemplate(s.templateId);
  const fields = readableFields(t);

  const buffer = await bunnyDownload(s.storageKey);
  const ex = await extractTemplateFields(buffer, s.mimeType, fields, { ref: { refType: 'TemplateSample', refId: s.id } });

  const verified = s.status === 'VERIFIED';
  const score = verified
    ? sampleScore(scorableFields(t), { status: s.status, expected: s.expected, lastResult: ex.values })
    : null;

  const row = await prisma.templateSample.update({
    where: { id: s.id },
    data: {
      lastResult: ex.values as unknown as Prisma.InputJsonValue,
      status: verified ? 'VERIFIED' : 'READ',
      score,
    },
    select: SAMPLE_SELECT,
  });
  // Ένα επιβεβαιωμένο δείγμα που ξαναδιαβάστηκε μετακινεί τον βαθμό του προτύπου.
  if (verified) await refreshTrainingScore(s.templateId).catch((e) => console.error('[templates] score refresh failed', s.templateId, (e as Error).message));
  return { sample: toSampleDto(row), model: ex.model, tokensUsed: ex.tokensUsed, errors: ex.errors };
}

/**
 * Διαβάζει ΟΛΑ τα δείγματα, το ένα μετά το άλλο. Σειριακά επίτηδες: κάθε δείγμα είναι δεκάδες
 * κλήσεις όρασης και μια παράλληλη ριπή είναι ο πιο σίγουρος τρόπος να φάμε rate limit.
 * Μια αποτυχία δεν σταματά τα υπόλοιπα — ο χρήστης θέλει τα 9 από τα 10.
 */
export async function readAllSamples(templateId: string): Promise<{ read: number; failed: number }> {
  const rows = await prisma.templateSample.findMany({ where: { templateId }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  let read = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      await readSample(r.id);
      read += 1;
    } catch (e) {
      failed += 1;
      console.error('[templates] sample read failed', r.id, (e as Error).message);
    }
  }
  return { read, failed };
}

// ─────────────────────────────────────────────────────────────── επιβεβαίωση + βαθμός

/**
 * «Αυτές είναι οι σωστές τιμές». Ο βαθμός του δείγματος είναι το ποσοστό των πεδίων που ο
 * αναγνώστης βρήκε ίδια — και ο βαθμός του προτύπου ξαναϋπολογίζεται αμέσως, γιατί από αυτόν
 * κρέμεται το αν επιτρέπεται η ενεργοποίηση.
 */
export async function verifySample(sampleId: string, expected: Record<string, unknown>): Promise<{ sample: SampleDto; training: TrainingSummary }> {
  const s = await prisma.templateSample.findUnique({ where: { id: sampleId } });
  if (!s) throw new SampleError('not_found');
  const t = await loadTemplate(s.templateId);

  const score = sampleScore(scorableFields(t), { status: 'VERIFIED', expected, lastResult: s.lastResult });
  const row = await prisma.templateSample.update({
    where: { id: s.id },
    data: { status: 'VERIFIED', expected: expected as unknown as Prisma.InputJsonValue, score },
    select: SAMPLE_SELECT,
  });
  const training = await refreshTrainingScore(s.templateId);
  return { sample: toSampleDto(row), training };
}

/** Ξαναμετρά τον βαθμό εκπαίδευσης του προτύπου από τα επιβεβαιωμένα δείγματά του. */
export async function refreshTrainingScore(templateId: string): Promise<TrainingSummary> {
  const t = await loadTemplate(templateId);
  const samples = await prisma.templateSample.findMany({
    where: { templateId }, select: { status: true, expected: true, lastResult: true },
  });
  const fields = scorableFields(t);
  const { perField, overall, verified } = scoreSamples(fields, samples);
  // Χωρίς κανένα επιβεβαιωμένο δείγμα ΔΕΝ υπάρχει βαθμός — το 0 θα ήταν ισχυρισμός («το πρότυπο
  // διαβάζει λάθος») εκεί που η αλήθεια είναι «κανείς δεν έχει κοιτάξει ακόμη».
  const trainingScore = verified > 0 ? overall : null;
  await prisma.extractionTemplate.update({ where: { id: templateId }, data: { trainingScore, verifiedSamples: verified } });
  return {
    trainingScore,
    verifiedSamples: verified,
    perField,
    gate: trainingGate({ minTrainingScore: t.minTrainingScore, minTrainingSamples: t.minTrainingSamples, trainingScore, verifiedSamples: verified }),
  };
}

// ─────────────────────────────────────────────────────────────── διαγραφή + αποτύπωμα

/**
 * Σβήνει ένα δείγμα μαζί με το αρχείο του. Το κύριο δείγμα (αυτό πάνω στο οποίο σχεδιάστηκαν οι
 * περιοχές) ΔΕΝ σβήνεται από εδώ: το αρχείο του είναι το δείγμα του ίδιου του προτύπου και η
 * διαγραφή του θα άφηνε τον σχεδιαστή χωρίς καμβά. Αντικαθίσταται ανεβάζοντας νέο δείγμα.
 */
export async function deleteSample(sampleId: string): Promise<{ training: TrainingSummary }> {
  const s = await prisma.templateSample.findUnique({ where: { id: sampleId } });
  if (!s) throw new SampleError('not_found');
  if (s.isPrimary) throw new SampleError('primary');
  await bunnyDelete([s.storageKey]).catch((e) => console.warn('[templates] sample file not deleted', s.storageKey, (e as Error).message));
  await prisma.templateSample.delete({ where: { id: s.id } });
  return { training: await refreshTrainingScore(s.templateId) };
}

/** Το αποτύπωμα διάταξης του κύριου δείγματος, όπως το κρατά το πρότυπο (§14.7). */
export async function primaryFingerprint(templateId: string): Promise<Fingerprint | null> {
  const t = await prisma.extractionTemplate.findUnique({ where: { id: templateId }, select: { fingerprint: true } });
  return toFingerprint(t?.fingerprint);
}
