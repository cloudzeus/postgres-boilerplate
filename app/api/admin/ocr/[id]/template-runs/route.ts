// GET → runs of the document (newest first, with template summary). POST { templateId? } → run now (permission ocr.categorize).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { findTemplateForVat, runTemplateOnDocument } from '@/lib/templates/run';
import { RUN_INCLUDE, toRunDto } from '@/lib/templates/run-dto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// One vision call per template region — the default 60s ceiling is not enough.
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  await requirePermission('ocr.read');
  const { id } = await params;
  const runs = await prisma.templateRun.findMany({
    where: { documentId: id },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: RUN_INCLUDE,
  });
  return NextResponse.json({ runs: runs.map(toRunDto) });
}

const Body = z.object({ templateId: z.string().min(1).optional() });

export async function POST(req: Request, { params }: Ctx) {
  const u = await requirePermission('ocr.categorize');
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });

  const doc = await prisma.ocrDocument.findUnique({ where: { id }, select: { id: true, status: true, extractedData: true } });
  if (!doc) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (doc.status !== 'COMPLETED') return NextResponse.json({ error: 'not_completed', message: 'Το έγγραφο δεν έχει ολοκληρωθεί' }, { status: 422 });

  const templateId = parsed.data.templateId ?? (await findTemplateForVat((doc.extractedData as { vatNumber?: unknown } | null)?.vatNumber));
  if (!templateId) return NextResponse.json({ error: 'no_template', message: 'Δεν βρέθηκε πρότυπο για το ΑΦΜ του εκδότη — επίλεξε ένα' }, { status: 422 });
  if (!(await prisma.extractionTemplate.findUnique({ where: { id: templateId }, select: { id: true } }))) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const outcome = await runTemplateOnDocument({ documentId: id, templateId, trigger: 'manual' });
  await logAudit({ userId: u.id, userEmail: u.email, action: 'template.run', resource: 'ocrDocument', resourceId: id, metadata: { templateId, status: outcome.status } });
  const run = await prisma.templateRun.findUnique({ where: { id: outcome.runId }, include: RUN_INCLUDE });
  return NextResponse.json({ run: run ? toRunDto(run) : null, outcome });
}
