// GET ?page=0&scale=3 — η σελίδα ενός δείγματος ως webp, όπως το `[id]/page-image` για το κύριο δείγμα.
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyDownload } from '@/lib/bunny';
import { rasterizeToWebp } from '@/lib/ocr/rasterize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string; sampleId: string }> }) {
  await requirePermission('ocr.read');
  const { id, sampleId } = await params;
  const url = new URL(req.url);
  const page = Math.max(0, Number(url.searchParams.get('page') ?? 0) || 0);
  const scale = Math.min(5, Math.max(2, Number(url.searchParams.get('scale') ?? 3) || 3));

  const s = await prisma.templateSample.findUnique({ where: { id: sampleId }, select: { templateId: true, storageKey: true, mimeType: true } });
  if (!s || s.templateId !== id) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Η εικόνα είναι καθαρή συνάρτηση του (κλειδί, σελίδα, κλίμακα) και το κλειδί δεν
  // ξαναχρησιμοποιείται ποτέ — άρα το ETag την ταυτοποιεί ακριβώς.
  const etag = `W/"${createHash('sha1').update(`${s.storageKey}:${page}:${scale}`).digest('hex')}"`;
  if (req.headers.get('if-none-match') === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag, 'Cache-Control': 'private, max-age=0, must-revalidate' } });
  }

  let buf: Buffer;
  try { buf = await bunnyDownload(s.storageKey); }
  catch { return NextResponse.json({ error: 'file unavailable' }, { status: 502 }); }

  try {
    const out = await rasterizeToWebp(buf, s.mimeType, { page, scale });
    return new NextResponse(new Uint8Array(out), { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=0, must-revalidate', ETag: etag } });
  } catch (err) {
    const message = (err as Error)?.message;
    if (message === 'page out of range') return NextResponse.json({ error: 'page out of range' }, { status: 422 });
    if (message === 'unsupported type') return NextResponse.json({ error: 'unsupported type' }, { status: 415 });
    return NextResponse.json({ error: `render failed: ${message}` }, { status: 502 });
  }
}
