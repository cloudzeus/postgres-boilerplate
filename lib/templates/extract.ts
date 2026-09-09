// lib/templates/extract.ts — SERVER. Reads every template field from a document.
// Digital PDFs: text layer first (free). Otherwise: crop the region → vision model.
import 'server-only';
import { isPdfBuffer, renderPage } from '@/lib/ocr/rasterize';
import { textInBox } from '@/lib/ocr/region-text';
import { extractPdfTextItems } from './pdf-text';
import { prepareCrop, readCropTable, readCropValue, type UsageRef } from './vision';
import { coerceValue } from './coerce';
import type { FieldDef, FieldValue } from './schema';

export type ExtractResult = {
  values: Record<string, FieldValue>;
  model: string | null;                              // model(s) used, comma-separated
  tokensUsed: number;
  errors: { fieldKey: string; message: string }[];
};

const MIN_TEXT_CHARS = 2;
const TEXT_CONFIDENCE = 1;      // text layer is deterministic
const VISION_CONFIDENCE = 0.8;  // model read; plan 2 shows a chip for < 1

export async function extractTemplateFields(
  buffer: Buffer,
  mimeType: string,
  fields: FieldDef[],
  opts?: { ref?: UsageRef },
): Promise<ExtractResult> {
  const out: ExtractResult = { values: {}, model: null, tokensUsed: 0, errors: [] };
  const isPdf = mimeType === 'application/pdf' || isPdfBuffer(buffer);
  const pageBitmaps = new Map<number, Buffer>();
  const pageText = new Map<number, Awaited<ReturnType<typeof extractPdfTextItems>>>();
  // Fallback can swap models mid-run, so a single `model` string would report
  // whichever field happened to be read last. Collect every distinct one.
  const models = new Set<string>();
  const ref = opts?.ref;

  const bitmap = async (page: number) => {
    let b = pageBitmaps.get(page);
    if (!b) { b = await renderPage(buffer, mimeType, page); pageBitmaps.set(page, b); }
    return b;
  };
  const text = async (page: number) => {
    let t = pageText.get(page);
    if (!t) {
      // A text layer we cannot parse (malformed/encrypted PDF) is not a field
      // error — it just means this document has to be read by the vision model.
      // Cache the empty result so it is not re-attempted for every field.
      try {
        t = await extractPdfTextItems(buffer, page);
      } catch (e) {
        console.warn(`[templates] text layer unavailable for page ${page}: ${(e as Error).message}`);
        t = [];
      }
      pageText.set(page, t);
    }
    return t;
  };

  for (const f of fields) {
    const base: FieldValue = { raw: null, value: null, confidence: null, source: 'none', page: f.region?.page ?? null, bbox: f.region?.bbox ?? null, color: f.color };
    if (!f.region) { out.values[f.key] = base; continue; }
    const { page, bbox } = f.region;
    try {
      if (f.kind === 'TABLE') {
        // TABLE fields deliberately SKIP the text layer: textInBox flattens every
        // item in the region into one space-joined string, which loses the row and
        // column structure a table needs. Only the vision model can recover it.
        const crop = await prepareCrop(await bitmap(page), bbox);
        const cols = (f.columns ?? []).map((c) => ({ key: c.key, label: c.label }));
        const r = await readCropTable({ crop, columns: cols, operation: 'template.table', hint: f.aiHint, ref });
        models.add(r.model); out.tokensUsed += r.tokensUsed ?? 0;
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
          const coerced = coerceValue(s, f.valueType);
          // For typed fields, an uncoercible hit means the box caught a stray label
          // or the region is slightly off — that is not a usable reading, so fall
          // through to vision rather than storing a null value with confidence 1.
          const typed = f.valueType === 'NUMBER' || f.valueType === 'CURRENCY' || f.valueType === 'DATE';
          if (!typed || coerced !== null) {
            out.values[f.key] = { ...base, raw: s, value: coerced, source: 'text', confidence: TEXT_CONFIDENCE };
            continue;
          }
        }
      }

      const crop = await prepareCrop(await bitmap(page), bbox);
      const prompt = `Read the value of the field "${f.label}"${f.aiHint ? ` (${f.aiHint})` : ''}. Expected type: ${f.valueType.toLowerCase()}.`;
      const r = await readCropValue({ crop, prompt, operation: 'template.field', ref });
      models.add(r.model); out.tokensUsed += r.tokensUsed ?? 0;
      out.values[f.key] = { ...base, raw: r.value || null, value: coerceValue(r.value, f.valueType), source: 'vision', confidence: r.value ? VISION_CONFIDENCE : null };
    } catch (e) {
      out.values[f.key] = base;
      out.errors.push({ fieldKey: f.key, message: (e as Error).message });
    }
  }
  out.model = models.size ? [...models].join(', ') : null;
  return out;
}
