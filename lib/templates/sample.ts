// lib/templates/sample.ts — SERVER. Store a template's sample file (route + seed script share this).
import 'server-only';
import { nanoid } from 'nanoid';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { bunnyUploadPrivate, bunnyDelete } from '@/lib/bunny';
import { countPdfPages, isPdfBuffer, pageOutline, sniffImageType } from '@/lib/ocr/rasterize';
import { buildFingerprint, type Fingerprint } from './fingerprint';

export const SAMPLE_MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);

export class SampleError extends Error {
  constructor(public code: 'not_found' | 'too_large' | 'unsupported_type' | 'primary') { super(code); }
}

/** One HTTP answer per sample failure, so every sample route says the same thing about the same problem. */
export const SAMPLE_ERROR: Record<SampleError['code'], { status: number; body: { error: string; message?: string } }> = {
  not_found: { status: 404, body: { error: 'not_found' } },
  too_large: { status: 413, body: { error: 'too_large', message: 'Μέγιστο 25 MB' } },
  unsupported_type: { status: 415, body: { error: 'unsupported_type', message: 'Δεκτά μόνο PDF, PNG, JPEG, WebP' } },
  primary: { status: 409, body: { error: 'primary', message: 'Το κύριο δείγμα δεν διαγράφεται — αντικατέστησέ το ανεβάζοντας νέο' } },
};

/**
 * The mime type of a sample, decided by the BYTES. Trust the bytes, never the declared type: bytes
 * we cannot recognise are rejected outright whatever the client claims they are, because accepting
 * them would push a corrupt/renamed file into sharp/pdfium and fail later with an opaque error
 * (and the declared type is attacker-controlled anyway).
 */
export function sniffSampleType(buffer: Buffer): string {
  const sniffed = isPdfBuffer(buffer) ? 'application/pdf' : sniffImageType(buffer);
  if (sniffed === null || !ALLOWED.has(sniffed)) throw new SampleError('unsupported_type');
  return sniffed;
}

/** File extension for a sample's storage key. */
export function sampleExt(mimeType: string): string {
  return mimeType === 'application/pdf' ? 'pdf' : mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
}

/** Page count of a sample — images are one page, an unreadable PDF counts as one. */
export function samplePageCount(buffer: Buffer, mimeType: string): Promise<number> {
  return mimeType === 'application/pdf' ? countPdfPages(buffer).catch(() => 1) : Promise.resolve(1);
}

/**
 * The layout fingerprint of a file (spec §14.7) — page 1's printed text and shape, plus whatever
 * the template already knows about the issuer. No model call: the text comes from the PDF itself.
 */
export async function fingerprintOfSample(
  buffer: Buffer,
  mimeType: string,
  issuer: { issuerName?: string | null; afm?: unknown },
): Promise<Fingerprint> {
  const { text, aspect } = await pageOutline(buffer, mimeType, 0);
  return buildFingerprint({ issuerName: issuer.issuerName ?? null, afm: issuer.afm, text, aspect });
}

export async function storeSample(templateId: string, buffer: Buffer): Promise<{ mimeType: string; pageCount: number; version: number }> {
  const t = await prisma.extractionTemplate.findUnique({ where: { id: templateId } });
  if (!t) throw new SampleError('not_found');
  if (buffer.length > SAMPLE_MAX_BYTES) throw new SampleError('too_large');

  const mimeType = sniffSampleType(buffer);

  const pageCount = await samplePageCount(buffer, mimeType);
  const ext = sampleExt(mimeType);
  const key = `templates/${templateId}/sample-${nanoid(8)}.${ext}`;
  await bunnyUploadPrivate({ key, body: buffer, contentType: mimeType });

  // The layout of the file the regions are drawn on IS the template's own fingerprint — the thing an
  // incoming document with an unknown ΑΦΜ is compared against (spec §14.7). Built here, once, from
  // bytes we already hold in memory; a fingerprint we cannot build is simply absent, never fatal.
  const fingerprint = await fingerprintOfSample(buffer, mimeType, { issuerName: t.supplierName, afm: t.vatNumber })
    .catch((e) => { console.warn('[templates] sample fingerprint failed', templateId, (e as Error).message); return null; });

  const old = t.sampleStorageKey;
  const updated = await prisma.extractionTemplate.update({
    where: { id: templateId },
    data: {
      sampleStorageKey: key, sampleMimeType: mimeType, samplePageCount: pageCount, version: { increment: 1 },
      ...(fingerprint && { fingerprint: fingerprint as unknown as Prisma.InputJsonValue }),
    },
  });
  // The thumb URL carries the post-increment version so replacing the sample
  // gives every <img src> a new URL — the browser (and any proxy) cannot serve
  // the previous sample's bitmap from cache. `v` is a cache key only; the
  // page-image route ignores it and revalidates against the storage key ETag.
  await prisma.extractionTemplate.update({
    where: { id: templateId },
    data: { sampleThumbUrl: `/api/admin/ocr/templates/${templateId}/page-image?page=0&scale=2&v=${updated.version}` },
  });
  // The design sample is also a TRAINING sample — the one the regions were drawn on, so by
  // construction the one the template reads best. It gets a row of its own (`isPrimary`) so the
  // training table shows it, the recogniser can rank against it, and replacing the sample replaces
  // the row instead of leaving an orphan pointing at a deleted file.
  await upsertPrimarySample({ templateId, key, mimeType, pageCount, fingerprint })
    .catch((e) => console.error('[templates] primary sample row not stored', templateId, (e as Error).message));

  if (old && old !== key) await bunnyDelete([old]).catch(() => null);

  return { mimeType, pageCount, version: updated.version };
}

async function upsertPrimarySample(input: {
  templateId: string; key: string; mimeType: string; pageCount: number; fingerprint: Fingerprint | null;
}): Promise<void> {
  const { templateId, key, mimeType, pageCount, fingerprint } = input;
  const data = {
    fileName: key.split('/').pop() ?? 'sample',
    storageKey: key,
    mimeType,
    pageCount,
    fingerprint: (fingerprint ?? null) as unknown as Prisma.InputJsonValue,
    // A new file means everything the old primary sample was read/confirmed against is gone.
    status: 'PENDING' as const,
    expected: Prisma.DbNull,
    lastResult: Prisma.DbNull,
    score: null,
  };
  const existing = await prisma.templateSample.findFirst({ where: { templateId, isPrimary: true }, select: { id: true } });
  if (existing) await prisma.templateSample.update({ where: { id: existing.id }, data });
  else await prisma.templateSample.create({ data: { ...data, templateId, isPrimary: true } });
}
