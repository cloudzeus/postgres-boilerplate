import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyDelete } from '@/lib/bunny';

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; docId: string }> }) {
  await requirePermission('companies.update');
  const { docId } = await ctx.params;
  const doc = await prisma.companyDocument.findUnique({ where: { id: docId }, select: { storageKey: true } });
  if (!doc) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (doc.storageKey) {
    try { await bunnyDelete([doc.storageKey]); } catch {}
  }
  await prisma.companyDocument.delete({ where: { id: docId } });
  return NextResponse.json({ ok: true });
}
