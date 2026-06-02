import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { normalizeNamedCatalogInput } from '@/lib/documents/document-categories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('metadata.manage');
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const norm = normalizeNamedCatalogInput(body);
  if (!norm.ok) return NextResponse.json({ error: norm.error }, { status: 400 });
  const clash = await prisma.documentCategory.findFirst({ where: { name: norm.value.name, NOT: { id } }, select: { id: true } });
  if (clash) return NextResponse.json({ error: 'Υπάρχει ήδη κατηγορία με αυτό το όνομα' }, { status: 409 });
  const updated = await prisma.documentCategory.update({ where: { id }, data: norm.value });
  return NextResponse.json({ data: updated });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('metadata.manage');
  const { id } = await params;
  const usedBy = await prisma.documentType.count({ where: { categoryId: id } });
  if (usedBy > 0) return NextResponse.json({ error: `Η κατηγορία χρησιμοποιείται σε ${usedBy} τύπους. Απενεργοποίησέ τη.` }, { status: 409 });
  await prisma.documentCategory.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
