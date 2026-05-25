import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

// List files + subfolders of a folder (or root if folderId omitted).
export async function GET(req: Request) {
  await requirePermission('media.read');
  const url = new URL(req.url);
  const folderId = url.searchParams.get('folderId');
  const q = url.searchParams.get('q')?.trim();
  const onlyImages = url.searchParams.get('images') === '1';

  const [folders, files] = await Promise.all([
    prisma.mediaFolder.findMany({
      where: { parentId: folderId || null },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
    }),
    prisma.mediaFile.findMany({
      where: {
        folderId: folderId || null,
        ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { originalName: { contains: q, mode: 'insensitive' } }] } : {}),
        ...(onlyImages ? { isImage: true } : {}),
      },
      orderBy: { uploadedAt: 'desc' },
      take: 500,
    }),
  ]);

  // Breadcrumbs
  const breadcrumbs: { id: string; name: string }[] = [];
  let cur = folderId;
  while (cur) {
    const f: { id: string; name: string; parentId: string | null } | null = await prisma.mediaFolder.findUnique({
      where: { id: cur }, select: { id: true, name: true, parentId: true },
    });
    if (!f) break;
    breadcrumbs.unshift({ id: f.id, name: f.name });
    cur = f.parentId;
  }

  return NextResponse.json({ folders, files, breadcrumbs });
}
