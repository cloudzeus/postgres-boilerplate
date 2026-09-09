// lib/templates/pdf-text.ts — SERVER. Positioned text items of one PDF page, normalized 0-1
// (origin top-left), matching lib/ocr/region-text.ts::TextItem so textInBox can be reused.
import 'server-only';
import type { TextItem } from '@/lib/ocr/region-text';

export async function extractPdfTextItems(buffer: Buffer, page: number): Promise<TextItem[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Same worker-path setup as lib/ocr/extract.ts::extractDigitalPdfText — avoids
  // pdfjs falling back to a "fake worker" (noisy warnings / unreliable in Node).
  try {
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    pdfjs.GlobalWorkerOptions.workerSrc = req.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
  } catch { /* ignore — pdfjs will try its own fallback */ }

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
      const w = (it.width ?? 0) / vp.width;
      const h = (it.height ?? Math.abs(it.transform[3] ?? 0)) / vp.height;
      const x = tx / vp.width;
      const y = 1 - ty / vp.height - h;               // PDF y grows upward; flip to top-left origin
      const str = it.str.trim();
      if (str) items.push({ str, x, y, w, h });
    }
    return items;
  } finally {
    await doc.destroy().catch(() => {});
  }
}
