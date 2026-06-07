import sharp from 'sharp';

/** True if the buffer begins with the PDF magic header (`%PDF-`). */
export function isPdfBuffer(buf: Buffer): boolean {
  return buf.subarray(0, 5).toString('latin1') === '%PDF-';
}

/** Point pdfjs at its bundled worker before pdf-to-img loads (best-effort). */
async function setupPdfWorker(): Promise<void> {
  try {
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    const workerPath = req.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    (pdfjs as any).GlobalWorkerOptions.workerSrc = workerPath;
  } catch {
    /* pdf-to-img falls back to its own bundled worker */
  }
}

/** Counts the pages of a PDF buffer. Returns 1 on failure (never throws). */
export async function countPdfPages(buf: Buffer): Promise<number> {
  try {
    await setupPdfWorker();
    const { pdf } = await import('pdf-to-img');
    const doc = await pdf(buf, { scale: 1 });
    // pdf-to-img exposes `length` (page count) on the returned document.
    if (typeof (doc as any).length === 'number' && (doc as any).length > 0) {
      return (doc as any).length;
    }
    let n = 0;
    for await (const _ of doc) n++;
    return n > 0 ? n : 1;
  } catch {
    return 1;
  }
}

/**
 * Rasterizes a page of a PDF (or re-encodes an image) to WebP for crisp browser preview.
 * Matches the exact sharp params used in the page-image route (2400px cap, quality 82).
 */
export async function rasterizeToWebp(
  buffer: Buffer,
  mimeType: string,
  opts: { page?: number; scale?: number } = {},
): Promise<Buffer> {
  const page = opts.page ?? 0;
  const scale = Math.min(5, Math.max(2, opts.scale ?? 3));
  let buf = buffer;

  // Trust the bytes over the declared mime type: some uploads arrive with an
  // empty or wrong Content-Type, which previously made us treat PDFs as images.
  const treatAsPdf = mimeType === 'application/pdf' || isPdfBuffer(buffer);

  if (treatAsPdf) {
    await setupPdfWorker();
    const { pdf } = await import('pdf-to-img');
    const doc = await pdf(buf, { scale });
    let i = 0;
    let found: Buffer | null = null;
    for await (const p of doc) {
      if (i === page) {
        const raw = p as Uint8Array;
        found = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
        break;
      }
      i++;
    }
    if (!found) throw new Error('page out of range');
    buf = found;
  } else if (!mimeType.startsWith('image/')) {
    throw new Error('unsupported type');
  }

  return sharp(buf)
    .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
}
