import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyUploadPrivate } from '@/lib/bunny';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/admin/tax-templates/[id]/sample — upload sample file
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.create');
  const { id } = await params;

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required (multipart/form-data)' }, { status: 400 });
  }

  const isPdf = file.type === 'application/pdf';
  const ext = isPdf ? 'pdf' : 'png';
  const timestamp = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const storageKey = `tax-templates/${id}/sample-${timestamp}.${ext}`;

  const buf = Buffer.from(await file.arrayBuffer());

  await bunnyUploadPrivate({ key: storageKey, body: buf, contentType: file.type });

  let pageCount = 1;
  if (isPdf) {
    try {
      const { pdf } = await import('pdf-to-img');
      const doc = await pdf(buf, { scale: 1 });
      let n = 0;
      for await (const _ of doc) n++;
      pageCount = n;
    } catch {
      pageCount = 1;
    }
  }

  const template = await prisma.taxFormTemplate.update({
    where: { id },
    data: { sampleStorageKey: storageKey, samplePageCount: pageCount },
  });

  return NextResponse.json(template);
}
