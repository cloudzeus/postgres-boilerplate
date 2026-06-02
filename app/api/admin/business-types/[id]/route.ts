import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('metadata.manage');
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const data: { code?: string; name?: string; order?: number; active?: boolean } = {};
  if (typeof body.code === 'string' && body.code.trim()) data.code = body.code.trim();
  if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim();
  if (Number.isFinite(Number(body.order))) data.order = Math.trunc(Number(body.order));
  if (typeof body.active === 'boolean') data.active = body.active;
  if (data.code) {
    const clash = await prisma.businessType.findFirst({ where: { code: data.code, NOT: { id } }, select: { id: true } });
    if (clash) return NextResponse.json({ error: 'Υπάρχει ήδη μορφή με αυτόν τον κωδικό' }, { status: 409 });
  }
  const updated = await prisma.businessType.update({ where: { id }, data });
  return NextResponse.json({ data: updated });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('metadata.manage');
  const { id } = await params;
  const usedByCompanies = await prisma.company.count({ where: { businessTypeId: id } });
  const usedByReqs = await prisma.requirementBusinessType.count({ where: { businessTypeId: id } });
  if (usedByCompanies + usedByReqs > 0) {
    return NextResponse.json({ error: `Η μορφή χρησιμοποιείται (${usedByCompanies} εταιρίες, ${usedByReqs} δικαιολογητικά). Απενεργοποίησέ τη αντί να τη διαγράψεις.` }, { status: 409 });
  }
  await prisma.businessType.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
