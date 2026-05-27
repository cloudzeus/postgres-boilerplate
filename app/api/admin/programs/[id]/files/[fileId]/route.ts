import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyDelete, bunnyDownload } from '@/lib/bunny';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET — stream the file inline (preview/download)
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  await requirePermission('programs.read');
  const { id, fileId } = await params;
  const f = await prisma.programFile.findFirst({ where: { id: fileId, programId: id } });
  if (!f) return new Response('not found', { status: 404 });
  const buf = await bunnyDownload(f.storageKey);
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': f.mimeType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(f.fileName)}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  await requirePermission('programs.delete');
  const { id, fileId } = await params;
  const f = await prisma.programFile.findFirst({ where: { id: fileId, programId: id } });
  if (!f) return NextResponse.json({ error: 'not found' }, { status: 404 });
  try { await bunnyDelete([f.storageKey]); } catch { /* best effort */ }
  await prisma.programFile.delete({ where: { id: fileId } });
  return NextResponse.json({ ok: true });
}
