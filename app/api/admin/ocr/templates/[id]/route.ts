import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { bunnyDelete } from '@/lib/bunny';
import { TEMPLATE_INCLUDE, toTemplateDto } from '@/lib/templates/serialize';
import { activationMessage, isReady } from '@/lib/templates/readiness';
import { trainingGate } from '@/lib/templates/training';
import { SLUG_RE } from '@/lib/templates/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  await requirePermission('ocr.read');
  const { id } = await params;
  const t = await prisma.extractionTemplate.findUnique({ where: { id }, include: TEMPLATE_INCLUDE });
  if (!t) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(toTemplateDto(t));
}

const PatchBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  slug: z.string().trim().regex(SLUG_RE, 'Slug: μόνο a-z, 0-9, _').optional(),
  department: z.string().trim().max(80).transform((v) => v || null).nullable().optional(),
  mode: z.enum(['AUTO', 'SEMI_AUTO', 'MANUAL']).optional(),
  status: z.enum(['DRAFT', 'ACTIVE']).optional(),
  notifyEmails: z.string().trim().max(500).nullable().optional(),
  vatNumber: z.string().trim().regex(/^\d{9}$/, 'ΑΦΜ 9 ψηφίων').nullable().optional(),
  traderTrdr: z.number().int().positive().nullable().optional(),
  supplierName: z.string().trim().max(200).transform((v) => v || null).nullable().optional(),
  // Κατώφλια εκπαίδευσης (§11). 0 δείγματα = χωρίς έλεγχο, για πρότυπα που δεν εκπαιδεύονται.
  minTrainingScore: z.number().min(0).max(1).optional(),
  minTrainingSamples: z.number().int().min(0).max(100).optional(),
});

export async function PATCH(req: Request, { params }: Ctx) {
  const u = await requirePermission('ocr.categorize');
  const { id } = await params;
  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  const b = parsed.data;

  const t = await prisma.extractionTemplate.findUnique({ where: { id }, include: TEMPLATE_INCLUDE });
  if (!t) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Το slug είναι το κλειδί του JSON εξόδου — κλειδώνει μόλις υπάρχουν εκτελέσεις.
  if (b.slug !== undefined && b.slug !== t.slug && t._count.runs > 0) {
    return NextResponse.json({ error: 'slug_locked', message: 'Το slug κλειδώνει μόλις το πρότυπο αποκτήσει εκτελέσεις' }, { status: 409 });
  }

  // AUTO mode needs the posting right.
  const mode = b.mode ?? t.mode;
  if (mode === 'AUTO' && u.role.key !== 'SUPER_ADMIN' && !u.permissionKeys.has('ocr.post')) {
    return NextResponse.json({ error: 'forbidden', message: 'Η αυτόματη λειτουργία απαιτεί δικαίωμα ανάρτησης (ocr.post)' }, { status: 403 });
  }
  // ACTIVE needs a sample and a field with a region; a mapping only when the mode posts to SoftOne
  // (spec §14.1-4). Re-checked whenever the status or the MODE moves, because a mode change can
  // itself invalidate readiness (MANUAL → SEMI_AUTO with no mapping).
  const status = b.status ?? t.status;
  const gateInput = {
    // Τα κατώφλια τα παίρνουμε από ΑΥΤΟ το αίτημα όταν τα αλλάζει: «ανέβασε τον πήχη και ενεργοποίησε»
    // σε μία κίνηση κρίνεται με τον νέο πήχη, όχι με τον παλιό.
    minTrainingScore: b.minTrainingScore ?? t.minTrainingScore,
    minTrainingSamples: b.minTrainingSamples ?? t.minTrainingSamples,
    trainingScore: t.trainingScore,
    verifiedSamples: t.verifiedSamples,
  };
  if (status === 'ACTIVE' && (b.status !== undefined || b.mode !== undefined) && !isReady({ ...t, mode })) {
    const check = { ok: false, error: 'not_ready' } as const;
    return NextResponse.json({ error: check.error, message: activationMessage(check, gateInput) }, { status: 422 });
  }
  // Η ΠΥΛΗ ΕΚΠΑΙΔΕΥΣΗΣ (spec §11) κρίνει ΜΟΝΟ μια πραγματική ενεργοποίηση — DRAFT → ACTIVE.
  //
  // Όχι κάθε αποθήκευση ενός ήδη ενεργού προτύπου: το migration έδωσε σε ΚΑΘΕ υπάρχουσα γραμμή
  // `minTrainingSamples = 3` και `verifiedSamples = 0`, και ο σχεδιαστής στέλνει `{mode, notifyEmails}`
  // χωρίς `status` — άρα ένα «άλλαξε τη λειτουργία» σε ενεργό πρότυπο θα γύριζε 422 `need_samples`
  // για κάτι που δεν ζήτησε κανείς. Ο βαθμός είναι μέτρηση, όχι λόγος να κλειδώσει ένα πρότυπο που
  // ήδη δουλεύει· μόνο η ρητή ενεργοποίηση πληρώνει το κατώφλι.
  if (b.status === 'ACTIVE' && t.status !== 'ACTIVE') {
    const gate = trainingGate(gateInput);
    if (!gate.ok) {
      const check = { ok: false, error: 'training_gate', reason: gate.reason } as const;
      return NextResponse.json({ error: check.error, message: activationMessage(check, gateInput), reason: gate.reason }, { status: 422 });
    }
  }

  let updated;
  try {
    updated = await prisma.extractionTemplate.update({
      where: { id },
      data: {
        ...(b.name !== undefined && { name: b.name }),
        ...(b.slug !== undefined && { slug: b.slug }),
        ...(b.department !== undefined && { department: b.department }),
        ...(b.mode !== undefined && { mode: b.mode }),
        ...(b.status !== undefined && { status: b.status }),
        ...(b.notifyEmails !== undefined && { notifyEmails: b.notifyEmails }),
        ...(b.vatNumber !== undefined && { vatNumber: b.vatNumber }),
        ...(b.traderTrdr !== undefined && { traderTrdr: b.traderTrdr }),
        ...(b.supplierName !== undefined && { supplierName: b.supplierName }),
        ...(b.minTrainingScore !== undefined && { minTrainingScore: b.minTrainingScore }),
        ...(b.minTrainingSamples !== undefined && { minTrainingSamples: b.minTrainingSamples }),
        version: { increment: 1 },
      },
      include: TEMPLATE_INCLUDE,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'duplicate_slug', message: 'Υπάρχει ήδη πρότυπο με αυτό το slug' }, { status: 409 });
    }
    throw err;
  }
  await logAudit({ userId: u.id, userEmail: u.email, action: 'template.update', resource: 'extractionTemplate', resourceId: id, metadata: b });
  return NextResponse.json(toTemplateDto(updated));
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const u = await requirePermission('ocr.categorize');
  const { id } = await params;
  const t = await prisma.extractionTemplate.findUnique({ where: { id }, include: { _count: { select: { runs: true, jobs: true } } } });
  if (!t) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  // Spec §13: never delete history. Templates with runs/jobs can only be set to DRAFT.
  if (t._count.runs > 0 || t._count.jobs > 0) {
    return NextResponse.json({ error: 'has_history', message: 'Το πρότυπο έχει ιστορικό εκτελέσεων. Απενεργοποίησέ το (DRAFT) αντί να το διαγράψεις.' }, { status: 409 });
  }
  await prisma.extractionTemplate.delete({ where: { id } });
  if (t.sampleStorageKey) await bunnyDelete([t.sampleStorageKey]).catch(() => null);
  await logAudit({ userId: u.id, userEmail: u.email, action: 'template.delete', resource: 'extractionTemplate', resourceId: id, metadata: { name: t.name } });
  return NextResponse.json({ ok: true });
}
