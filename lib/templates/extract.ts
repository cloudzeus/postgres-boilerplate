// lib/templates/extract.ts — SERVER. Reads every template field from a document.
// Digital PDFs: text layer first (free). Otherwise: crop the region → vision model.
import 'server-only';
import { isPdfBuffer, renderPage } from '@/lib/ocr/rasterize';
import { textInBox } from '@/lib/ocr/region-text';
import { extractPdfTextItems } from './pdf-text';
import { prepareCrop, readCropTable, readCropValue } from './vision';
import { coerceValue } from './coerce';
import type { FieldDef, FieldValue } from './schema';

export type ExtractResult = {
  values: Record<string, FieldValue>;
  model: string | null;
  tokensUsed: number;
  errors: { fieldKey: string; message: string }[];
};

const MIN_TEXT_CHARS = 2;

export async function extractTemplateFields(buffer: Buffer, mimeType: string, fields: FieldDef[]): Promise<ExtractResult> {
  const out: ExtractResult = { values: {}, model: null, tokensUsed: 0, errors: [] };
  const isPdf = mimeType === 'application/pdf' || isPdfBuffer(buffer);
  const pageBitmaps = new Map<number, Buffer>();
  const pageText = new Map<number, Awaited<ReturnType<typeof extractPdfTextItems>>>();

  const bitmap = async (page: number) => {
    let b = pageBitmaps.get(page);
    if (!b) { b = await renderPage(buffer, mimeType, page); pageBitmaps.set(page, b); }
    return b;
  };
  const text = async (page: number) => {
    let t = pageText.get(page);
    if (!t) { t = await extractPdfTextItems(buffer, page); pageText.set(page, t); }
    return t;
  };

  for (const f of fields) {
    const base: FieldValue = { raw: null, value: null, confidence: null, source: 'vision', page: f.region?.page ?? null, bbox: f.region?.bbox ?? null, color: f.color };
    if (!f.region) { out.values[f.key] = base; continue; }
    const { page, bbox } = f.region;
    try {
      if (f.kind === 'TABLE') {
        const crop = await prepareCrop(await bitmap(page), bbox);
        const cols = (f.columns ?? []).map((c) => ({ key: c.key, label: c.label }));
        const r = await readCropTable({ crop, columns: cols, operation: 'template.table', hint: f.aiHint });
        out.model = r.model; out.tokensUsed += r.tokensUsed ?? 0;
        const rows = r.rows.map((row) => {
          const o: Record<string, unknown> = {};
          for (const c of f.columns ?? []) o[c.key] = coerceValue(row[c.key], c.valueType);
          return o;
        });
        out.values[f.key] = { ...base, raw: JSON.stringify(r.rows), value: rows, source: 'vision', confidence: null };
        continue;
      }

      if (isPdf) {
        const items = await text(page);
        const [x, y, w, h] = bbox;
        const s = textInBox(items, { x, y, w, h });
        if (s.length >= MIN_TEXT_CHARS) {
          out.values[f.key] = { ...base, raw: s, value: coerceValue(s, f.valueType), source: 'text', confidence: 1 };
          continue;
        }
      }

      const crop = await prepareCrop(await bitmap(page), bbox);
      const prompt = `Read the value of the field "${f.label}"${f.aiHint ? ` (${f.aiHint})` : ''}. Expected type: ${f.valueType.toLowerCase()}.`;
      const r = await readCropValue({ crop, prompt, operation: 'template.field' });
      out.model = r.model; out.tokensUsed += r.tokensUsed ?? 0;
      out.values[f.key] = { ...base, raw: r.value || null, value: coerceValue(r.value, f.valueType), source: 'vision', confidence: r.value ? 0.8 : null };
    } catch (e) {
      out.values[f.key] = base;
      out.errors.push({ fieldKey: f.key, message: (e as Error).message });
    }
  }
  return out;
}
