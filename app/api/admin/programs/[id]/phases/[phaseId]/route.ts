import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; phaseId: string }> }) {
  await requirePermission('programs.update');
  const { id, phaseId } = await params;
  const body = await req.json().catch(() => ({}));
  const data: { name?: string; order?: number } = {};
  if (typeof body.name === 'string') {
    const n = body.name.trim();
    if (!n) return NextResponse.json({ error: 'Το όνομα φάσης είναι υποχρεωτικό' }, { status: 400 });
    data.name = n;
  }
  if (Number.isFinite(Number(body.order))) data.order = Math.trunc(Number(body.order));
  // Scope the update to the program in the URL so the nested route is honest.
  const res = await prisma.programPhase.updateMany({ where: { id: phaseId, programId: id }, data });
  if (res.count === 0) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const updated = await prisma.programPhase.findUnique({ where: { id: phaseId } });
  return NextResponse.json({ data: updated });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; phaseId: string }> }) {
  await requirePermission('programs.update');
  const { id, phaseId } = await params;
  const res = await prisma.programPhase.deleteMany({ where: { id: phaseId, programId: id } });
  if (res.count === 0) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
