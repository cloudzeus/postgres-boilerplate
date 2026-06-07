import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyUploadPrivate } from '@/lib/bunny';
import { isPdfBuffer, countPdfPages } from '@/lib/ocr/rasterize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/admin/tax-templates/[id]/sample — upload sample file
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.create');
  const { id } = await params;

  const exists = await prisma.taxFormTemplate.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required (multipart/form-data)' }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());

  // Detect PDF by magic bytes (and filename) — not just Content-Type, which
  // some browsers send empty or wrong, which would mis-store a PDF as .png.
  const isPdf = isPdfBuffer(buf) || file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const ext = isPdf ? 'pdf' : 'png';
  const timestamp = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const storageKey = `tax-templates/${id}/sample-${timestamp}.${ext}`;
  const contentType = isPdf ? 'application/pdf' : (file.type || 'image/png');

  await bunnyUploadPrivate({ key: storageKey, body: buf, contentType });

  const pageCount = isPdf ? await countPdfPages(buf) : 1;

  const template = await prisma.taxFormTemplate.update({
    where: { id },
    data: { sampleStorageKey: storageKey, samplePageCount: pageCount },
  });

  return NextResponse.json(template);
}
