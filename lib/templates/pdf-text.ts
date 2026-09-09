// lib/templates/pdf-text.ts — SERVER. Positioned text items of one PDF page, normalized 0-1
// (origin top-left), matching lib/ocr/region-text.ts::TextItem so textInBox can be reused.
import 'server-only';
import type { TextItem } from '@/lib/ocr/region-text';

// Import + configure pdfjs ONCE per process. Same worker-path setup as
// lib/ocr/extract.ts::extractDigitalPdfText — avoids pdfjs falling back to a
// "fake worker" (noisy warnings / unreliable in Node). The promise is cached so
// repeated extractions don't re-resolve the worker path on every call.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _pdfjs: Promise<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getPdfjs(): Promise<any> {
  if (!_pdfjs) {
    _pdfjs = (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
      try {
        const { createRequire } = await import('node:module');
        const req = createRequire(import.meta.url);
        pdfjs.GlobalWorkerOptions.workerSrc = req.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
      } catch { /* ignore — pdfjs will try its own fallback */ }
      return pdfjs;
    })();
  }
  return _pdfjs;
}

export async function extractPdfTextItems(buffer: Buffer, page: number): Promise<TextItem[]> {
  const pdfjs = await getPdfjs();
  const { Util } = pdfjs;

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: 0,
  }).promise;
  try {
    if (page < 0 || page >= doc.numPages) return [];
    const p = await doc.getPage(page + 1);
    const vp = p.getViewport({ scale: 1 });
    const content = await p.getTextContent();
    const items: TextItem[] = [];
    for (const it of content.items as Array<{ str?: string; transform?: number[]; width?: number; height?: number }>) {
      if (!it.str || !it.transform) continue;
      const [, , , , tx, ty] = it.transform;
      // `it.transform` tx/ty are in UNROTATED PDF user space (y up, origin at the
      // MediaBox corner). The bboxes these items are matched against are drawn on
      // the rasterised page, which is rendered WITH /Rotate applied — so we must
      // push the point through the viewport transform rather than dividing by
      // vp.width/vp.height by hand (those are swapped on /Rotate 90|270 and ignore
      // a non-zero viewBox origin). applyTransform yields device pixels with a
      // top-left origin and y growing downward.
      // NOTE: current pdfjs mutates `p` in place and returns void; older builds
      // returned a fresh array. Accept both.
      const pt = [tx, ty];
      const [dx, dy] = Util.applyTransform(pt, vp.transform) ?? pt;
      const w = (it.width ?? 0) / vp.width;
      // `||` not `??`: pdfjs emits height 0 for some items — fall back to the
      // transform's vertical scale (the effective font size).
      const h = (it.height || Math.abs(it.transform[3] ?? 0)) / vp.height;
      const x = dx / vp.width;
      const y = dy / vp.height - h;                  // dy is the BASELINE; the box starts a glyph-height above it
      const str = it.str.trim();
      if (str) items.push({ str, x, y, w, h });
    }
    return items;
  } finally {
    await doc.destroy().catch(() => {});
  }
}
