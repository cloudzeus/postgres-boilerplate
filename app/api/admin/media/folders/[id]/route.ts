import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyDelete } from '@/lib/bunny';
import { logAudit } from '@/lib/audit';

const PatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  parentId: z.string().cuid().nullable().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission('media.manage_folders');
  const body = await req.json();
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const folder = await prisma.mediaFolder.update({ where: { id }, data: parsed.data });
  await logAudit({ userId: actor.id, userEmail: actor.email, action: 'media.folder_update', resource: 'mediaFolder', resourceId: folder.id });
  return NextResponse.json({ folder });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission('media.delete');
  // Delete all files under this folder tree from Bunny first
  const collectFiles = async (folderId: string): Promise<string[]> => {
    const [files, subs] = await Promise.all([
      prisma.mediaFile.findMany({ where: { folderId }, select: { storageKey: true, originalKey: true } }),
      prisma.mediaFolder.findMany({ where: { parentId: folderId }, select: { id: true } }),
    ]);
    const keys = files.flatMap((f) => [f.storageKey, f.originalKey].filter(Boolean) as string[]);
    for (const sub of subs) keys.push(...(await collectFiles(sub.id)));
    return keys;
  };
  const allKeys = await collectFiles(id);
  if (allKeys.length) await bunnyDelete(allKeys);
  await prisma.mediaFolder.delete({ where: { id } });
  await logAudit({ userId: actor.id, userEmail: actor.email, action: 'media.folder_delete', resource: 'mediaFolder', resourceId: id, metadata: { deletedKeys: allKeys.length } });
  return NextResponse.json({ ok: true });
}
