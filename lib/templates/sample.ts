// lib/templates/sample.ts — SERVER. Store a template's sample file (route + seed script share this).
import 'server-only';
import { nanoid } from 'nanoid';
import { prisma } from '@/lib/db';
import { bunnyUploadPrivate, bunnyDelete } from '@/lib/bunny';
import { countPdfPages, isPdfBuffer, sniffImageType } from '@/lib/ocr/rasterize';

export const SAMPLE_MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);

export class SampleError extends Error {
  constructor(public code: 'not_found' | 'too_large' | 'unsupported_type') { super(code); }
}

export async function storeSample(templateId: string, buffer: Buffer): Promise<{ mimeType: string; pageCount: number; version: number }> {
  const t = await prisma.extractionTemplate.findUnique({ where: { id: templateId } });
  if (!t) throw new SampleError('not_found');
  if (buffer.length > SAMPLE_MAX_BYTES) throw new SampleError('too_large');

  // Trust the bytes, never the declared type. Bytes we cannot recognise are
  // rejected outright whatever the client claims they are: accepting them would
  // push a corrupt/renamed file into sharp/pdfium and fail later with an opaque
  // error (and the declared type is attacker-controlled anyway).
  const sniffed = isPdfBuffer(buffer) ? 'application/pdf' : sniffImageType(buffer);
  if (sniffed === null || !ALLOWED.has(sniffed)) throw new SampleError('unsupported_type');
  const mimeType = sniffed;

  const pageCount = mimeType === 'application/pdf' ? await countPdfPages(buffer).catch(() => 1) : 1;
  const ext = mimeType === 'application/pdf' ? 'pdf' : mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const key = `templates/${templateId}/sample-${nanoid(8)}.${ext}`;
  await bunnyUploadPrivate({ key, body: buffer, contentType: mimeType });

  const old = t.sampleStorageKey;
  const updated = await prisma.extractionTemplate.update({
    where: { id: templateId },
    data: { sampleStorageKey: key, sampleMimeType: mimeType, samplePageCount: pageCount, version: { increment: 1 } },
  });
  // The thumb URL carries the post-increment version so replacing the sample
  // gives every <img src> a new URL — the browser (and any proxy) cannot serve
  // the previous sample's bitmap from cache. `v` is a cache key only; the
  // page-image route ignores it and revalidates against the storage key ETag.
  await prisma.extractionTemplate.update({
    where: { id: templateId },
    data: { sampleThumbUrl: `/api/admin/ocr/templates/${templateId}/page-image?page=0&scale=2&v=${updated.version}` },
  });
  if (old && old !== key) await bunnyDelete([old]).catch(() => null);

  return { mimeType, pageCount, version: updated.version };
}
