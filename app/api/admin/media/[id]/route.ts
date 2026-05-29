import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { deleteMediaFile } from '@/lib/media';
import { logAudit } from '@/lib/audit';

const PatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  folderId: z.string().cuid().nullable().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission('media.upload');
  const body = await req.json();
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const file = await prisma.mediaFile.update({ where: { id }, data: parsed.data });
  await logAudit({ userId: actor.id, userEmail: actor.email, action: 'media.update', resource: 'media', resourceId: file.id });
  return NextResponse.json({ file });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission('media.delete');
  const ok = await deleteMediaFile(id);
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await logAudit({ userId: actor.id, userEmail: actor.email, action: 'media.delete', resource: 'media', resourceId: id });
  return NextResponse.json({ ok: true });
}
