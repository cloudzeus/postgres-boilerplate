import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { bunnyDelete } from '@/lib/bunny';
import { TEMPLATE_INCLUDE, toTemplateDto } from '@/lib/templates/serialize';
import { activationMessage, canActivate } from '@/lib/templates/readiness';
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
  // ACTIVE needs a sample and a field with a region; a mapping only when the mode posts to SoftOne (spec §14.1-4).
  // Only on an actual transition: a plain {name}/{notifyEmails} PATCH must not be blocked because an
  // already-ACTIVE template drifted out of readiness (e.g. its only mapping was deleted elsewhere).
  // …and the template must have been trained enough to be trusted (spec §11). The thresholds are
  // taken from THIS request when it changes them, so raising the bar and activating in one PATCH is
  // judged by the new bar rather than the old one.
  const status = b.status ?? t.status;
  if (status === 'ACTIVE' && (b.status !== undefined || b.mode !== undefined)) {
    const gateInput = {
      minTrainingScore: b.minTrainingScore ?? t.minTrainingScore,
      minTrainingSamples: b.minTrainingSamples ?? t.minTrainingSamples,
      trainingScore: t.trainingScore,
      verifiedSamples: t.verifiedSamples,
    };
    const check = canActivate({ ...t, ...gateInput, mode });
    if (!check.ok) {
      return NextResponse.json(
        { error: check.error, message: activationMessage(check, gateInput), ...(check.error === 'training_gate' && { reason: check.reason }) },
        { status: 422 },
      );
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
