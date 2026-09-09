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
    })().catch((e) => {
      // Self-heal: a cached REJECTED promise would poison every later call for the
      // life of the process (e.g. a transient module-load failure during boot).
      _pdfjs = null;
      throw e;
    });
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
      // the rasterised page, which is rendered WITH /Rotate applied — so both the
      // ORIGIN and the EXTENTS must go through the viewport transform. Dividing
      // it.width/it.height by vp.width/vp.height measures them in the unrotated
      // frame: on /Rotate 90|270 the axes are swapped (and on 180 mirrored), so the
      // box landed off-page and textInBox never matched.
      // `it.width`/`it.height` are already user-space units (pdfjs TextItem), so
      // pushing the four corners of the glyph box through vp.transform and taking
      // their device-space AABB is exact for every rotation.
      // `||` not `??` on the height: pdfjs emits height 0 for some items — fall back
      // to the transform's vertical scale (the effective font size).
      const glyphH = it.height || Math.abs(it.transform[3] ?? 0);
      const glyphW = it.width ?? 0;
      // Text-space box: origin at the baseline (tx,ty), extending +width along x and
      // +height along y (PDF y grows upward).
      const corners: [number, number][] = [[tx, ty], [tx + glyphW, ty], [tx, ty + glyphH], [tx + glyphW, ty + glyphH]];
      // NOTE: current pdfjs mutates the point in place and returns void; older
      // builds returned a fresh array. Accept both.
      const dev = corners.map(([px, py]) => {
        const pt: number[] = [px, py];
        return (Util.applyTransform(pt, vp.transform) as number[] | undefined) ?? pt;
      });
      const xs = dev.map((d) => d[0]);
      const ys = dev.map((d) => d[1]);
      const minX = Math.min(...xs); const minY = Math.min(...ys);
      const x = minX / vp.width;
      const y = minY / vp.height;
      const w = (Math.max(...xs) - minX) / vp.width;
      const h = (Math.max(...ys) - minY) / vp.height;
      const str = it.str.trim();
      if (str) items.push({ str, x, y, w, h });
    }
    return items;
  } finally {
    await doc.destroy().catch(() => {});
  }
}
