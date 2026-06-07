import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyDownload } from '@/lib/bunny';
import { rasterizeToWebp, isPdfBuffer } from '@/lib/ocr/rasterize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/admin/tax-templates/[id]/page-image?page=0&scale=2
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.read');
  const { id } = await params;
  const url = new URL(req.url);
  const page = Math.max(0, Number(url.searchParams.get('page') ?? 0) || 0);
  const scale = Math.min(5, Math.max(2, Number(url.searchParams.get('scale') ?? 2) || 2));

  const template = await prisma.taxFormTemplate.findUnique({ where: { id } });
  if (!template) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (!template.sampleStorageKey) return NextResponse.json({ error: 'no sample uploaded' }, { status: 404 });

  let buf: Buffer;
  try {
    const dl = await bunnyDownload(template.sampleStorageKey);
    buf = Buffer.isBuffer(dl) ? dl : Buffer.from(dl as ArrayBuffer);
  } catch {
    return NextResponse.json({ error: 'file unavailable' }, { status: 502 });
  }

  // Decide PDF vs image from the actual bytes (handles samples mis-stored with a
  // .png key because the upload arrived without a proper application/pdf type).
  const mime = isPdfBuffer(buf) || template.sampleStorageKey.endsWith('.pdf') ? 'application/pdf' : 'image/png';

  let out: Buffer;
  try {
    out = await rasterizeToWebp(buf, mime, { page, scale });
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
