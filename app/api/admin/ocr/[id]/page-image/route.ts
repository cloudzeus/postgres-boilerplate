import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyDownload } from '@/lib/bunny';

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

  if (doc.mimeType === 'application/pdf') {
    try {
      // Point pdfjs at its worker (mirrors lib/ocr/thumbnail.ts / read-region).
      try {
        const { createRequire } = await import('node:module');
        const req2 = createRequire(import.meta.url);
        const workerPath = req2.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        (pdfjs as any).GlobalWorkerOptions.workerSrc = workerPath;
      } catch { /* pdf-to-img will fall back to its own worker */ }

      const { pdf } = await import('pdf-to-img');
      const document = await pdf(buf, { scale });
      let i = 0;
      let found: Buffer | null = null;
      for await (const p of document) {
        if (i === page) {
          const raw = p as Uint8Array;
          found = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
          break;
        }
        i++;
      }
      if (!found) return NextResponse.json({ error: 'page out of range' }, { status: 422 });
      buf = found;
    } catch (err: any) {
      return NextResponse.json({ error: `render failed: ${err?.message ?? err}` }, { status: 502 });
    }
  } else if (!doc.mimeType.startsWith('image/')) {
    return NextResponse.json({ error: 'unsupported type' }, { status: 415 });
  }

  // Re-encode to WebP — crisp but much smaller than PNG. Cap the long edge so very
  // large rasters stay reasonable while remaining readable at zoom.
  const out = await sharp(buf)
    .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();

  return new NextResponse(new Uint8Array(out), {
    headers: {
      'Content-Type': 'image/webp',
      'Cache-Control': 'private, max-age=86400',
    },
  });
}
