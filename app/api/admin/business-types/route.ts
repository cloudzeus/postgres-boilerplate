import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  await requirePermission('metadata.read');
  const data = await prisma.businessType.findMany({ orderBy: [{ order: 'asc' }, { name: 'asc' }] });
  return NextResponse.json({ data });
}

export async function POST(req: Request) {
  await requirePermission('metadata.manage');
  const body = await req.json().catch(() => ({}));
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!code || !name) return NextResponse.json({ error: 'code και name υποχρεωτικά' }, { status: 400 });
  const order = Number.isFinite(Number(body.order)) ? Math.trunc(Number(body.order)) : 0;
  const existing = await prisma.businessType.findUnique({ where: { code } });
  if (existing) return NextResponse.json({ error: 'Υπάρχει ήδη μορφή με αυτόν τον κωδικό' }, { status: 409 });
  const created = await prisma.businessType.create({ data: { code, name, order, active: true } });
  return NextResponse.json({ data: created }, { status: 201 });
}
