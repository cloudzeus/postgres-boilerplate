// app/api/admin/ocr/[id]/read-region/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyDownload } from '@/lib/bunny';
import { prepareCrop, readCropValue } from '@/lib/templates/vision';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const norm = z.number().min(0).max(1);
const Body = z.object({
  field: z.string().min(1),
  page: z.number().int().min(0).default(0),
  bbox: z.tuple([norm, norm, norm, norm]), // x,y,w,h normalized 0..1
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.categorize');
  const { id } = await params;
  const { field, page, bbox } = Body.parse(await req.json());

  const doc = await prisma.ocrDocument.findUnique({ where: { id } });
  if (!doc) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // Fetch original bytes from Bunny private storage (publicUrl is a `bunny:<key>`
  // reference, not an HTTP URL — download via the storage key like the file route).
  let imgBuf: Buffer;
  try {
    const dl = await bunnyDownload(doc.storageKey);
    imgBuf = Buffer.isBuffer(dl) ? dl : Buffer.from(dl as ArrayBuffer);
  } catch {
    return NextResponse.json({ error: 'file unavailable' }, { status: 502 });
  }

  // For PDFs, rasterize the requested page first (mirrors lib/ocr/extract.ts rasterizePdf).
  if (doc.mimeType === 'application/pdf') {
    try {
      const { createRequire } = await import('node:module');
      const req2 = createRequire(import.meta.url);
      const workerPath = req2.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      (pdfjs as any).GlobalWorkerOptions.workerSrc = workerPath;
    } catch { /* pdf-to-img will try its own fallback */ }

    const { pdf } = await import('pdf-to-img');
    const document = await pdf(imgBuf, { scale: 3 });
    let i = 0;
    let found: Buffer<ArrayBuffer> | null = null;
    for await (const p of document) {
      if (i === page) {
        const raw = p as Uint8Array;
        const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
        found = Buffer.from(ab);
        break;
      }
      i++;
    }
    if (!found) return NextResponse.json({ error: 'page out of range' }, { status: 422 });
    imgBuf = found;
  }

  let crop: Buffer;
  try {
    crop = await prepareCrop(imgBuf, bbox);
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg === 'unreadable page' ? 'unreadable page' : 'invalid region' }, { status: 422 });
  }
  try {
    const r = await readCropValue({ crop, prompt: `Read the value of the field "${field}".`, operation: 'ocr.region' });
    return NextResponse.json({ value: r.value });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
