import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { bunnyDelete } from '@/lib/bunny';
import { TEMPLATE_INCLUDE, toTemplateDto } from '@/lib/templates/serialize';

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
  mode: z.enum(['AUTO', 'SEMI_AUTO', 'MANUAL']).optional(),
  status: z.enum(['DRAFT', 'ACTIVE']).optional(),
  notifyEmails: z.string().trim().max(500).nullable().optional(),
  traderTrdr: z.number().int().positive().nullable().optional(),
  supplierName: z.string().trim().max(200).nullable().optional(),
});

export async function PATCH(req: Request, { params }: Ctx) {
  const u = await requirePermission('ocr.categorize');
  const { id } = await params;
  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  const b = parsed.data;

  const t = await prisma.extractionTemplate.findUnique({ where: { id }, include: TEMPLATE_INCLUDE });
  if (!t) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // AUTO mode needs the posting right; ACTIVE needs a sample, ≥1 field with a region and ≥1 mapping.
  const mode = b.mode ?? t.mode;
  if (mode === 'AUTO' && u.role.key !== 'SUPER_ADMIN' && !u.permissionKeys.has('ocr.post')) {
    return NextResponse.json({ error: 'forbidden', message: 'Η αυτόματη λειτουργία απαιτεί δικαίωμα ανάρτησης (ocr.post)' }, { status: 403 });
  }
  if (b.status === 'ACTIVE') {
    const hasRegion = t.fields.some((f) => f.region != null);
    if (!hasRegion || t.mappings.length === 0 || !t.sampleStorageKey) {
      return NextResponse.json({ error: 'not_ready', message: 'Για ενεργοποίηση χρειάζονται δείγμα, ένα πεδίο με περιοχή και ένα mapping' }, { status: 422 });
    }
  }

  let updated;
  try {
    updated = await prisma.extractionTemplate.update({
      where: { id },
      data: {
        ...(b.name !== undefined && { name: b.name }),
        ...(b.mode !== undefined && { mode: b.mode }),
        ...(b.status !== undefined && { status: b.status }),
        ...(b.notifyEmails !== undefined && { notifyEmails: b.notifyEmails }),
        ...(b.traderTrdr !== undefined && { traderTrdr: b.traderTrdr }),
        ...(b.supplierName !== undefined && { supplierName: b.supplierName }),
        version: { increment: 1 },
      },
      include: TEMPLATE_INCLUDE,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'duplicate', message: 'Υπάρχει ήδη πρότυπο με αυτό το όνομα για τον προμηθευτή' }, { status: 409 });
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
