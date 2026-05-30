import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  await requirePermission('ocr.read');
  const templates = await prisma.supplierTemplate.findMany({ orderBy: { updatedAt: 'desc' } });
  return NextResponse.json(templates);
}

export async function DELETE(req: Request) {
  await requirePermission('ocr.delete');
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await prisma.supplierTemplate.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
