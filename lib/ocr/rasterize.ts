import sharp from 'sharp';

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

  if (mimeType === 'application/pdf') {
    // Point pdfjs at its worker before pdf-to-img loads.
    try {
      const { createRequire } = await import('node:module');
      const req = createRequire(import.meta.url);
      const workerPath = req.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      (pdfjs as any).GlobalWorkerOptions.workerSrc = workerPath;
    } catch { /* pdf-to-img will fall back to its own worker */ }

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
