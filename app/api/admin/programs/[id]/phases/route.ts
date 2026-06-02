import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('programs.read');
  const { id } = await params;
  const phases = await prisma.programPhase.findMany({
    where: { programId: id },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    include: {
      requirements: {
        include: {
          documentType: { select: { id: true, name: true } },
          businessTypes: { select: { businessTypeId: true } },
        },
      },
    },
  });
  return NextResponse.json({ data: phases });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('programs.update');
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'Το όνομα φάσης είναι υποχρεωτικό' }, { status: 400 });
  const phaseTemplateId = typeof body.phaseTemplateId === 'string' && body.phaseTemplateId.trim() ? body.phaseTemplateId.trim() : null;
  const program = await prisma.program.findUnique({ where: { id }, select: { id: true } });
  if (!program) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const count = await prisma.programPhase.count({ where: { programId: id } });
  const phase = await prisma.programPhase.create({ data: { programId: id, name, order: count, phaseTemplateId } });
  return NextResponse.json({ data: phase }, { status: 201 });
}
