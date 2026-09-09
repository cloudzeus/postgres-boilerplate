import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { bunnyUploadPrivate, bunnyDelete } from '@/lib/bunny';
import { countPdfPages, isPdfBuffer, sniffImageType } from '@/lib/ocr/rasterize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);
const MAX_BYTES = 25 * 1024 * 1024;

// POST multipart { file } — αποθηκεύει το δείγμα στο private Bunny zone και μετρά σελίδες.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requirePermission('ocr.categorize');
  const { id } = await params;
  const t = await prisma.extractionTemplate.findUnique({ where: { id } });
  if (!t) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'file_required' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'too_large', message: 'Μέγιστο 25 MB' }, { status: 413 });

  const buffer = Buffer.from(await file.arrayBuffer());
  // Trust the bytes, never the declared type. Bytes we cannot recognise are
  // rejected outright whatever the client claims they are: accepting them would
  // push a corrupt/renamed file into sharp/pdfium and fail later with an opaque
  // error (and the declared type is attacker-controlled anyway).
  const sniffed = isPdfBuffer(buffer) ? 'application/pdf' : sniffImageType(buffer);
  if (sniffed === null || !ALLOWED.has(sniffed)) return NextResponse.json({ error: 'unsupported_type' }, { status: 415 });
  const mimeType = sniffed;

  const pageCount = mimeType === 'application/pdf' ? await countPdfPages(buffer).catch(() => 1) : 1;
  const ext = mimeType === 'application/pdf' ? 'pdf' : mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const key = `templates/${id}/sample-${nanoid(8)}.${ext}`;
  await bunnyUploadPrivate({ key, body: buffer, contentType: mimeType });

  const old = t.sampleStorageKey;
  const updated = await prisma.extractionTemplate.update({
    where: { id },
    data: { sampleStorageKey: key, sampleMimeType: mimeType, samplePageCount: pageCount, version: { increment: 1 } },
  });
  // The thumb URL carries the post-increment version so replacing the sample
  // gives every <img src> a new URL — the browser (and any proxy) cannot serve
  // the previous sample's bitmap from cache. `v` is a cache key only; the
  // page-image route ignores it and revalidates against the storage key ETag.
  await prisma.extractionTemplate.update({
    where: { id },
    data: { sampleThumbUrl: `/api/admin/ocr/templates/${id}/page-image?page=0&scale=2&v=${updated.version}` },
  });
  if (old && old !== key) await bunnyDelete([old]).catch(() => null);

  await logAudit({ userId: u.id, userEmail: u.email, action: 'template.sample.upload', resource: 'extractionTemplate', resourceId: id, metadata: { mimeType, pageCount } });
  return NextResponse.json({ ok: true, mimeType, pageCount });
}
