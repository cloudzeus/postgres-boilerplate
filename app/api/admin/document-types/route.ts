import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { normalizeDocumentTypeInput } from '@/lib/documents/document-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  await requirePermission('metadata.read');
  const types = await prisma.documentType.findMany({ orderBy: [{ order: 'asc' }, { name: 'asc' }] });
  return NextResponse.json({ data: types });
}

export async function POST(req: Request) {
  const user = await requirePermission('metadata.manage');
  const body = await req.json().catch(() => ({}));
  const norm = normalizeDocumentTypeInput(body);
  if (!norm.ok) return NextResponse.json({ error: norm.error }, { status: 400 });
  const existing = await prisma.documentType.findUnique({ where: { name: norm.value.name } });
  if (existing) return NextResponse.json({ error: 'Υπάρχει ήδη τύπος με αυτό το όνομα' }, { status: 409 });
  const created = await prisma.documentType.create({ data: norm.value });
  await logAudit({ action: 'document_type.create', resource: 'document_type', resourceId: created.id, userId: user.id, userEmail: user.email });
  return NextResponse.json({ data: created }, { status: 201 });
}
