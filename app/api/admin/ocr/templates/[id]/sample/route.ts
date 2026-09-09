import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyUploadPrivate, bunnyDelete } from '@/lib/bunny';
import { countPdfPages, isPdfBuffer, sniffImageType } from '@/lib/ocr/rasterize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);
const MAX_BYTES = 25 * 1024 * 1024;

// POST multipart { file } — αποθηκεύει το δείγμα στο private Bunny zone και μετρά σελίδες.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.categorize');
  const { id } = await params;
  const t = await prisma.extractionTemplate.findUnique({ where: { id } });
  if (!t) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'file_required' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'too_large', message: 'Μέγιστο 25 MB' }, { status: 413 });

  const buffer = Buffer.from(await file.arrayBuffer());
  // Trust the bytes over the declared type; fall back to the declared type only
  // when the bytes are unrecognised. 415 only if NEITHER is something we support.
  const sniffed = isPdfBuffer(buffer) ? 'application/pdf' : sniffImageType(buffer);
  const declared = file.type || '';
  // A file that CLAIMS to be an image but carries bytes we cannot recognise is
  // rejected outright: trusting the declared type would push a corrupt/renamed
  // file into sharp/pdfium and fail later with an opaque error.
  if (sniffed === null && declared.startsWith('image/')) return NextResponse.json({ error: 'unsupported_type' }, { status: 415 });
  const mimeType = sniffed && ALLOWED.has(sniffed) ? sniffed : declared;
  if (!ALLOWED.has(mimeType)) return NextResponse.json({ error: 'unsupported_type' }, { status: 415 });

  const pageCount = mimeType === 'application/pdf' ? await countPdfPages(buffer).catch(() => 1) : 1;
  const ext = mimeType === 'application/pdf' ? 'pdf' : mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const key = `templates/${t.vatNumber}/${id}/sample-${nanoid(8)}.${ext}`;
  await bunnyUploadPrivate({ key, body: buffer, contentType: mimeType });

  const old = t.sampleStorageKey;
  await prisma.extractionTemplate.update({
    where: { id },
    data: { sampleStorageKey: key, sampleMimeType: mimeType, samplePageCount: pageCount, sampleThumbUrl: `/api/admin/ocr/templates/${id}/page-image?page=0&scale=2`, version: { increment: 1 } },
  });
  if (old && old !== key) await bunnyDelete([old]).catch(() => null);

  return NextResponse.json({ ok: true, mimeType, pageCount });
}
