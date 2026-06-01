import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string; phaseId: string }> }) {
  await requirePermission('programs.update');
  const { id, phaseId } = await params;
  const body = await req.json().catch(() => ({}));
  const documentTypeId = typeof body.documentTypeId === 'string' ? body.documentTypeId : '';
  if (!documentTypeId) return NextResponse.json({ error: 'documentTypeId required' }, { status: 400 });
  // Ensure the phase actually belongs to the program in the URL.
  const phase = await prisma.programPhase.findFirst({ where: { id: phaseId, programId: id }, select: { id: true } });
  if (!phase) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const mandatory = typeof body.mandatory === 'boolean' ? body.mandatory : true;
  const existing = await prisma.phaseDocumentRequirement.findUnique({ where: { phaseId_documentTypeId: { phaseId, documentTypeId } } });
  if (existing) return NextResponse.json({ error: 'Ο τύπος υπάρχει ήδη σε αυτή τη φάση' }, { status: 409 });
  const created = await prisma.phaseDocumentRequirement.create({
    data: { phaseId, documentTypeId, mandatory },
    include: { documentType: { select: { id: true, name: true } } },
  });
  return NextResponse.json({ data: created }, { status: 201 });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ phaseId: string }> }) {
  await requirePermission('programs.update');
  const { phaseId } = await params;
  const body = await req.json().catch(() => ({}));
  const documentTypeId = typeof body.documentTypeId === 'string' ? body.documentTypeId : '';
  if (!documentTypeId || typeof body.mandatory !== 'boolean') return NextResponse.json({ error: 'documentTypeId and mandatory required' }, { status: 400 });
  const updated = await prisma.phaseDocumentRequirement.update({
    where: { phaseId_documentTypeId: { phaseId, documentTypeId } },
    data: { mandatory: body.mandatory },
  });
  return NextResponse.json({ data: updated });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ phaseId: string }> }) {
  await requirePermission('programs.update');
  const { phaseId } = await params;
  const documentTypeId = new URL(req.url).searchParams.get('documentTypeId') ?? '';
  if (!documentTypeId) return NextResponse.json({ error: 'documentTypeId required' }, { status: 400 });
  // Idempotent: deleteMany won't throw P2025 if the row is already gone.
  await prisma.phaseDocumentRequirement.deleteMany({ where: { phaseId, documentTypeId } });
  return NextResponse.json({ ok: true });
}
