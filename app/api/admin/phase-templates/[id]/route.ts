import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { normalizeNamedCatalogInput } from '@/lib/programs/phase-templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('metadata.manage');
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const norm = normalizeNamedCatalogInput(body);
  if (!norm.ok) return NextResponse.json({ error: norm.error }, { status: 400 });
  const clash = await prisma.phaseTemplate.findFirst({ where: { name: norm.value.name, NOT: { id } }, select: { id: true } });
  if (clash) return NextResponse.json({ error: 'Υπάρχει ήδη πρότυπο με αυτό το όνομα' }, { status: 409 });
  const updated = await prisma.phaseTemplate.update({ where: { id }, data: norm.value });
  return NextResponse.json({ data: updated });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('metadata.manage');
  const { id } = await params;
  const usedBy = await prisma.programPhase.count({ where: { phaseTemplateId: id } });
  if (usedBy > 0) return NextResponse.json({ error: `Το πρότυπο χρησιμοποιείται σε ${usedBy} φάσεις. Απενεργοποίησέ το.` }, { status: 409 });
  await prisma.phaseTemplate.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
