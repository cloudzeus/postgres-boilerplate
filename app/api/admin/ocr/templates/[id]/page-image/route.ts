import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyDownload } from '@/lib/bunny';
import { rasterizeToWebp } from '@/lib/ocr/rasterize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET ?page=0&scale=3 — rasterized σελίδα του δείγματος (webp), όπως το ocr/[id]/page-image.
// `?v=` is accepted and ignored: it is only a cache-busting token the stored
// sampleThumbUrl carries so a replaced sample gets a fresh URL.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.read');
  const { id } = await params;
  const url = new URL(req.url);
  const page = Math.max(0, Number(url.searchParams.get('page') ?? 0) || 0);
  const scale = Math.min(5, Math.max(2, Number(url.searchParams.get('scale') ?? 3) || 3));

  const t = await prisma.extractionTemplate.findUnique({ where: { id } });
  if (!t?.sampleStorageKey) return NextResponse.json({ error: 'no_sample' }, { status: 404 });

  // The bitmap is a pure function of (storage key, page, scale), and uploading a
  // new sample writes a new key — so the key plus the render params identify the
  // bytes exactly. Revalidate on every request instead of caching for a day: the
  // old max-age=86400 kept serving a replaced sample's page for up to 24h.
  const etag = `W/"${createHash('sha1').update(`${t.sampleStorageKey}:${page}:${scale}`).digest('hex')}"`;
  if (req.headers.get('if-none-match') === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag, 'Cache-Control': 'private, max-age=0, must-revalidate' } });
  }

  let buf: Buffer;
  try { buf = await bunnyDownload(t.sampleStorageKey); }
  catch { return NextResponse.json({ error: 'file unavailable' }, { status: 502 }); }

  try {
    const out = await rasterizeToWebp(buf, t.sampleMimeType ?? 'application/pdf', { page, scale });
    return new NextResponse(new Uint8Array(out), { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=0, must-revalidate', ETag: etag } });
  } catch (err: any) {
    if (err?.message === 'page out of range') return NextResponse.json({ error: 'page out of range' }, { status: 422 });
    if (err?.message === 'unsupported type') return NextResponse.json({ error: 'unsupported type' }, { status: 415 });
    return NextResponse.json({ error: `render failed: ${err?.message ?? err}` }, { status: 502 });
  }
}
