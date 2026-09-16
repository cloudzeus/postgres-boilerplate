import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyDownload } from '@/lib/bunny';
import { rasterizeToWebp } from '@/lib/ocr/rasterize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Μία σελίδα του ΠΡΩΤΟΤΥΠΟΥ PDF ενός φακέλου, ως WebP — η μικρογραφία της οθόνης διαχωρισμού.
 * Τεμπέλικη επίτηδες: ο browser ζητάει μόνο όσες σελίδες βλέπει ο χρήστης.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.read');
  const { id } = await params;
  const url = new URL(req.url);
  const page = Math.max(0, Number(url.searchParams.get('page') ?? 0) || 0);
  const scale = Math.min(5, Math.max(2, Number(url.searchParams.get('scale') ?? 2) || 2));

  const batch = await prisma.ocrBatch.findUnique({ where: { id }, select: { sourceKey: true } });
  if (!batch?.sourceKey) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // (κλειδί, σελίδα, κλίμακα) ταυτοποιεί την εικόνα — validator αντί για τυφλό max-age.
  const etag = `W/"${createHash('sha1').update(`${batch.sourceKey}:${page}:${scale}`).digest('hex')}"`;
  if (req.headers.get('if-none-match') === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag, 'Cache-Control': 'private, max-age=0, must-revalidate' } });
  }

  let buf: Buffer;
  try {
    const dl = await bunnyDownload(batch.sourceKey);
    buf = Buffer.isBuffer(dl) ? dl : Buffer.from(dl as ArrayBuffer);
  } catch {
    return NextResponse.json({ error: 'file unavailable' }, { status: 502 });
  }

  let out: Buffer;
  try {
    out = await rasterizeToWebp(buf, 'application/pdf', { page, scale });
  } catch (err: any) {
    if (err?.message === 'page out of range') {
      return NextResponse.json({ error: 'page out of range' }, { status: 422 });
    }
    return NextResponse.json({ error: `render failed: ${err?.message ?? err}` }, { status: 502 });
  }

  return new NextResponse(new Uint8Array(out), {
    headers: {
      'Content-Type': 'image/webp',
      'Content-Length': String(out.byteLength),
      'Cache-Control': 'private, max-age=0, must-revalidate',
      ETag: etag,
    },
  });
}
