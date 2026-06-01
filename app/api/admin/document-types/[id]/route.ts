import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { normalizeDocumentTypeInput } from '@/lib/documents/document-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('metadata.manage');
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const norm = normalizeDocumentTypeInput(body);
  if (!norm.ok) return NextResponse.json({ error: norm.error }, { status: 400 });
  const clash = await prisma.documentType.findFirst({ where: { name: norm.value.name, NOT: { id } }, select: { id: true } });
  if (clash) return NextResponse.json({ error: 'Υπάρχει ήδη τύπος με αυτό το όνομα' }, { status: 409 });
  const updated = await prisma.documentType.update({ where: { id }, data: norm.value });
  await logAudit({ action: 'document_type.update', resource: 'document_type', resourceId: id, userId: user.id, userEmail: user.email });
  return NextResponse.json({ data: updated });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('metadata.manage');
  const { id } = await params;
  const usedBy = await prisma.phaseDocumentRequirement.count({ where: { documentTypeId: id } });
  if (usedBy > 0) {
    return NextResponse.json({ error: `Ο τύπος χρησιμοποιείται σε ${usedBy} φάση/εις προγραμμάτων. Απενεργοποίησέ τον αντί να τον διαγράψεις.` }, { status: 409 });
  }
  await prisma.documentType.delete({ where: { id } });
  await logAudit({ action: 'document_type.delete', resource: 'document_type', resourceId: id, userId: user.id, userEmail: user.email });
  return NextResponse.json({ ok: true });
}
