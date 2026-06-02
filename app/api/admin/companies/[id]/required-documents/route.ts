import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { requirementApplies } from '@/lib/documents/requirement-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('companies.read');
  const { id } = await params;
  const programId = new URL(req.url).searchParams.get('programId') ?? '';
  if (!programId) return NextResponse.json({ error: 'programId required' }, { status: 400 });

  const company = await prisma.company.findUnique({ where: { id }, select: { businessTypeId: true, businessType: { select: { name: true } } } });
  if (!company) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const phases = await prisma.programPhase.findMany({
    where: { programId },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    include: {
      requirements: {
        include: { documentType: { select: { id: true, name: true } }, businessTypes: { select: { businessTypeId: true } } },
      },
    },
  });

  const result = phases.map((ph) => ({
    phaseId: ph.id,
    phaseName: ph.name,
    requirements: ph.requirements
      .filter((r) => requirementApplies({ id: r.id, appliesToAll: r.appliesToAll, businessTypeIds: r.businessTypes.map((b) => b.businessTypeId) }, company.businessTypeId))
      .map((r) => ({ id: r.id, documentTypeId: r.documentTypeId, name: r.documentType.name, mandatory: r.mandatory })),
  })).filter((ph) => ph.requirements.length > 0);

  return NextResponse.json({
    businessTypeId: company.businessTypeId,
    businessTypeName: company.businessType?.name ?? null,
    phases: result,
  });
}
