import sharp from 'sharp';
import { PDFiumLibrary } from '@hyzyla/pdfium';

/** True if the buffer begins with the PDF magic header (`%PDF-`). */
export function isPdfBuffer(buf: Buffer): boolean {
  return buf.subarray(0, 5).toString('latin1') === '%PDF-';
}

// PDFium (Chrome's PDF engine, WASM) renders embedded fonts reliably — unlike the
// pdf-to-img canvas backend, which throws on TrueType glyphs ("Value is none of
// these types String, Path" at paintChar). The WASM library is initialized once
// and reused across requests.
let _libPromise: Promise<Awaited<ReturnType<typeof PDFiumLibrary.init>>> | null = null;
function getLibrary() {
  if (!_libPromise) _libPromise = PDFiumLibrary.init();
  return _libPromise;
}

/** Counts the pages of a PDF buffer. Returns 1 on failure (never throws). */
export async function countPdfPages(buf: Buffer): Promise<number> {
  try {
    const library = await getLibrary();
    const doc = await library.loadDocument(new Uint8Array(buf));
    try {
      const n = doc.getPageCount();
      return n > 0 ? n : 1;
    } finally {
      doc.destroy();
    }
  } catch {
    return 1;
  }
}

/** Renders a single PDF page to a full-resolution PNG (no resize) via pdfium. */
async function renderPdfPagePng(buffer: Buffer, page: number, scale: number): Promise<Buffer> {
  const library = await getLibrary();
  const doc = await library.loadDocument(new Uint8Array(buffer));
  try {
    const count = doc.getPageCount();
    if (page < 0 || page >= count) throw new Error('page out of range');
    const pdfPage = doc.getPage(page);
    const rendered = await pdfPage.render({
      scale,
      render: (o: { data: Uint8Array; width: number; height: number }) =>
        sharp(Buffer.from(o.data), { raw: { width: o.width, height: o.height, channels: 4 } }).png().toBuffer(),
    });
    return Buffer.from(rendered.data);
  } finally {
    doc.destroy();
  }
}

/**
 * Crops a normalized region [x,y,w,h] (0..1) of a page to a PNG, so the vision
 * model sees ONLY the marked area (a textual region hint alone is unreliable —
 * the model otherwise picks a different/more prominent table).
 */
export async function cropRegionToImage(
  buffer: Buffer,
  mimeType: string,
  region: { page: number; bbox: [number, number, number, number] },
  scale = 3,
): Promise<Buffer> {
  const treatAsPdf = mimeType === 'application/pdf' || isPdfBuffer(buffer);
  const pageBuf = treatAsPdf ? await renderPdfPagePng(buffer, region.page, scale) : buffer;
  const meta = await sharp(pageBuf).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) throw new Error('could not read page dimensions');
  const [x, y, w, h] = region.bbox;
  const left = Math.min(W - 1, Math.max(0, Math.round(x * W)));
  const top = Math.min(H - 1, Math.max(0, Math.round(y * H)));
  const width = Math.max(1, Math.min(W - left, Math.round(w * W)));
  const height = Math.max(1, Math.min(H - top, Math.round(h * H)));
  return sharp(pageBuf).extract({ left, top, width, height }).png().toBuffer();
}

/**
 * Rasterizes a page of a PDF (or re-encodes an image) to WebP for crisp browser preview.
 * 2400px cap, quality 82 — matches the original page-image behavior.
 */
export async function rasterizeToWebp(
  buffer: Buffer,
  mimeType: string,
  opts: { page?: number; scale?: number } = {},
): Promise<Buffer> {
  const page = opts.page ?? 0;
  const scale = Math.min(5, Math.max(2, opts.scale ?? 3));

  // Trust the bytes over the declared mime type: some uploads arrive with an
  // empty or wrong Content-Type, which previously made us treat PDFs as images.
  const treatAsPdf = mimeType === 'application/pdf' || isPdfBuffer(buffer);

  if (treatAsPdf) {
    const library = await getLibrary();
    const doc = await library.loadDocument(new Uint8Array(buffer));
    try {
      const count = doc.getPageCount();
      if (page < 0 || page >= count) throw new Error('page out of range');
      const pdfPage = doc.getPage(page);
      const rendered = await pdfPage.render({
        scale,
        render: (o: { data: Uint8Array; width: number; height: number }) =>
          sharp(Buffer.from(o.data), { raw: { width: o.width, height: o.height, channels: 4 } })
            .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 82 })
            .toBuffer(),
      });
      return Buffer.from(rendered.data);
    } finally {
      doc.destroy();
    }
  }

  if (!mimeType.startsWith('image/')) {
    throw new Error('unsupported type');
  }

  return sharp(buffer)
    .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
}
