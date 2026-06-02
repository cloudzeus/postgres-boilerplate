import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PUT(req: Request, { params }: { params: Promise<{ id: string; phaseId: string; reqId: string }> }) {
  await requirePermission('programs.update');
  const { id, phaseId, reqId } = await params;
  const body = await req.json().catch(() => ({}));
  const appliesToAll = body.appliesToAll === true;
  const businessTypeIds: string[] = Array.isArray(body.businessTypeIds) ? body.businessTypeIds.filter((x: unknown) => typeof x === 'string') : [];

  // Verify the requirement belongs to the phase belongs to the program.
  const reqRow = await prisma.phaseDocumentRequirement.findFirst({
    where: { id: reqId, phaseId, phase: { programId: id } },
    select: { id: true },
  });
  if (!reqRow) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // Validate ids exist as BusinessType rows (ignore unknown ids).
  const valid = appliesToAll ? [] : (await prisma.businessType.findMany({ where: { id: { in: businessTypeIds } }, select: { id: true } })).map((b) => b.id);

  await prisma.$transaction([
    prisma.phaseDocumentRequirement.update({ where: { id: reqId }, data: { appliesToAll } }),
    prisma.requirementBusinessType.deleteMany({ where: { requirementId: reqId } }),
    ...(valid.length ? [prisma.requirementBusinessType.createMany({ data: valid.map((businessTypeId) => ({ requirementId: reqId, businessTypeId })) })] : []),
  ]);

  return NextResponse.json({ ok: true, appliesToAll, businessTypeIds: valid });
}
