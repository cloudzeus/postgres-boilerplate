import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyDownload } from '@/lib/bunny';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('programs.read');
  const { id } = await params;
  const program = await prisma.program.findUnique({ where: { id } });
  if (!program || !program.storageKey) return new Response('not found', { status: 404 });
  const buf = await bunnyDownload(program.storageKey);
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': program.mimeType ?? 'application/octet-stream',
      'Content-Disposition': `inline; filename="${encodeURIComponent(program.sourceFileName ?? 'program.pdf')}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
