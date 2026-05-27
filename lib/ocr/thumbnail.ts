import sharp from 'sharp';
import { customAlphabet } from 'nanoid';
import { prisma } from '@/lib/db';
import { bunnyUpload, bunnyDownload } from '@/lib/bunny';

const slug = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8);
const THUMB_SIZE = 320;

/**
 * Lazily generate (and persist) a small WebP thumbnail for an OcrDocument.
 * Returns the public CDN URL. No-op if a thumb already exists.
 */
export async function ensureOcrThumbnail(documentId: string): Promise<string | null> {
  const doc = await prisma.ocrDocument.findUnique({ where: { id: documentId } });
  if (!doc) return null;
  if (doc.thumbUrl) return doc.thumbUrl;

  let pageBuffer: Buffer | null = null;

  try {
    if (doc.mimeType === 'application/pdf') {
      try {
        const { createRequire } = await import('node:module');
        const req = createRequire(import.meta.url);
        const workerPath = req.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        (pdfjs as any).GlobalWorkerOptions.workerSrc = workerPath;
      } catch { /* fallback to pdf-to-img defaults */ }
      const { pdf } = await import('pdf-to-img');
      const pages = await pdf(await bunnyDownload(doc.storageKey), { scale: 1.2 });
      for await (const p of pages) {
        pageBuffer = Buffer.isBuffer(p)
          ? p
          : Buffer.from((p as Uint8Array).buffer, (p as Uint8Array).byteOffset, (p as Uint8Array).byteLength);
        break;
      }
    } else if (doc.mimeType.startsWith('image/')) {
      pageBuffer = await bunnyDownload(doc.storageKey);
    } else {
      return null;
    }
    if (!pageBuffer) return null;

    const webp = await sharp(pageBuffer)
      .resize({ width: THUMB_SIZE, height: THUMB_SIZE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();

    const key = `ocr/thumbs/${doc.id}-${slug()}.webp`;
    const { publicUrl } = await bunnyUpload({
      key, body: webp, contentType: 'image/webp',
      cacheControl: 'public, max-age=2592000',
    });

    await prisma.ocrDocument.update({
      where: { id: doc.id },
      data: { thumbKey: key, thumbUrl: publicUrl },
    });
    return publicUrl;
  } catch (err) {
    console.error('ensureOcrThumbnail failed', { id: doc.id, err });
    return null;
  }
}
