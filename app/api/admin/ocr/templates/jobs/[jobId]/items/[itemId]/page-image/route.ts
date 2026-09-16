// GET ?page=0&scale=3 — η σελίδα ενός αρχείου εργασίας ως webp, για το πλαϊνό πάνελ του πίνακα.
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyDownload } from '@/lib/bunny';
import { rasterizeToWebp } from '@/lib/ocr/rasterize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ jobId: string; itemId: string }> }) {
  await requirePermission('ocr.read');
  const { jobId, itemId } = await params;
  const url = new URL(req.url);
  const page = Math.max(0, Number(url.searchParams.get('page') ?? 0) || 0);
  const scale = Math.min(5, Math.max(2, Number(url.searchParams.get('scale') ?? 3) || 3));

  const item = await prisma.templateJobItem.findUnique({ where: { id: itemId }, select: { jobId: true, storageKey: true, mimeType: true } });
  if (!item || item.jobId !== jobId) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Το κλειδί δεν ξαναχρησιμοποιείται ποτέ, άρα (κλειδί, σελίδα, κλίμακα) ταυτοποιεί την εικόνα.
  const etag = `W/"${createHash('sha1').update(`${item.storageKey}:${page}:${scale}`).digest('hex')}"`;
  if (req.headers.get('if-none-match') === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag, 'Cache-Control': 'private, max-age=0, must-revalidate' } });
  }

  let buf: Buffer;
  try { buf = await bunnyDownload(item.storageKey); }
  catch { return NextResponse.json({ error: 'file unavailable' }, { status: 502 }); }

  try {
    const out = await rasterizeToWebp(buf, item.mimeType, { page, scale });
    return new NextResponse(new Uint8Array(out), { headers: { 'Content-Type': 'image/webp', 'Content-Length': String(out.byteLength), 'Cache-Control': 'private, max-age=0, must-revalidate', ETag: etag } });
  } catch (err) {
    const message = (err as Error)?.message;
    if (message === 'page out of range') return NextResponse.json({ error: 'page out of range' }, { status: 422 });
    if (message === 'unsupported type') return NextResponse.json({ error: 'unsupported type' }, { status: 415 });
    return NextResponse.json({ error: `render failed: ${message}` }, { status: 502 });
  }
}
