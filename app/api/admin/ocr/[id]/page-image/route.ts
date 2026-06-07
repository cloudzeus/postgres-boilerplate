import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyDownload } from '@/lib/bunny';
import { rasterizeToWebp } from '@/lib/ocr/rasterize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * High-resolution raster of a single document page, for the crisp zoom preview.
 *
 * For PDFs we rasterize the requested page with pdf-to-img (vector → bitmap at a
 * high scale) so zooming shows real characters instead of a stretched, blurry
 * iframe. For images we just re-encode the original. Output is WebP (small + crisp).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.read');
  const { id } = await params;
  const url = new URL(req.url);
  const page = Math.max(0, Number(url.searchParams.get('page') ?? 0) || 0);
  const scale = Math.min(5, Math.max(2, Number(url.searchParams.get('scale') ?? 3) || 3));

  const doc = await prisma.ocrDocument.findUnique({ where: { id } });
  if (!doc) return NextResponse.json({ error: 'not found' }, { status: 404 });

  let buf: Buffer;
  try {
    const dl = await bunnyDownload(doc.storageKey);
    buf = Buffer.isBuffer(dl) ? dl : Buffer.from(dl as ArrayBuffer);
  } catch {
    return NextResponse.json({ error: 'file unavailable' }, { status: 502 });
  }

  let out: Buffer;
  try {
    out = await rasterizeToWebp(buf, doc.mimeType, { page, scale });
  } catch (err: any) {
    if (err?.message === 'page out of range') {
      return NextResponse.json({ error: 'page out of range' }, { status: 422 });
    }
    if (err?.message === 'unsupported type') {
      return NextResponse.json({ error: 'unsupported type' }, { status: 415 });
    }
    return NextResponse.json({ error: `render failed: ${err?.message ?? err}` }, { status: 502 });
  }

  return new NextResponse(new Uint8Array(out), {
    headers: {
      'Content-Type': 'image/webp',
      'Cache-Control': 'private, max-age=86400',
    },
  });
}
