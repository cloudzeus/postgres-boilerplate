import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { normalizeNamedCatalogInput } from '@/lib/programs/phase-templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  await requirePermission('metadata.read');
  const data = await prisma.phaseTemplate.findMany({ orderBy: [{ order: 'asc' }, { name: 'asc' }] });
  return NextResponse.json({ data });
}

export async function POST(req: Request) {
  await requirePermission('metadata.manage');
  const body = await req.json().catch(() => ({}));
  const norm = normalizeNamedCatalogInput(body);
  if (!norm.ok) return NextResponse.json({ error: norm.error }, { status: 400 });
  const existing = await prisma.phaseTemplate.findUnique({ where: { name: norm.value.name } });
  if (existing) return NextResponse.json({ data: existing });
  const created = await prisma.phaseTemplate.create({ data: norm.value });
  return NextResponse.json({ data: created }, { status: 201 });
}
