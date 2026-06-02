import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { normalizeNamedCatalogInput } from '@/lib/documents/document-categories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  await requirePermission('metadata.read');
  const data = await prisma.documentCategory.findMany({ orderBy: [{ order: 'asc' }, { name: 'asc' }] });
  return NextResponse.json({ data });
}

export async function POST(req: Request) {
  await requirePermission('metadata.manage');
  const body = await req.json().catch(() => ({}));
  const norm = normalizeNamedCatalogInput(body);
  if (!norm.ok) return NextResponse.json({ error: norm.error }, { status: 400 });
  // Creatable: if it already exists, return it (200) so the combo box doesn't error.
  const existing = await prisma.documentCategory.findUnique({ where: { name: norm.value.name } });
  if (existing) return NextResponse.json({ data: existing });
  const created = await prisma.documentCategory.create({ data: norm.value });
  return NextResponse.json({ data: created }, { status: 201 });
}
