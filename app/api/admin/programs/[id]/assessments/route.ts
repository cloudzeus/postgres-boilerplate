// app/api/admin/programs/[id]/assessments/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('programs.read');
  const { id } = await params;
  const list = await prisma.companyAssessment.findMany({
    where: { programId: id },
    orderBy: { createdAt: 'desc' },
    include: { company: { select: { id: true, name: true } } },
  });
  return NextResponse.json(list);
}
