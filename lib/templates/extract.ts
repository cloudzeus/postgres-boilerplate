// lib/templates/extract.ts — SERVER. Reads every template field from a document.
// Digital PDFs: text layer first (free). Otherwise: crop the region → vision model.
import 'server-only';
import { countPdfPages, isPdfBuffer, renderPage } from '@/lib/ocr/rasterize';
import { UPGRADED_VISION_MODEL } from '@/lib/ocr/extract';
import { textInBox } from '@/lib/ocr/region-text';
import { extractPdfTextItems } from './pdf-text';
import { prepareCrop, readCropTable, readCropValue, readCropValueLocated, type UsageRef } from './vision';
import { cropBoxToPage } from './geometry';
import { ADAPTIVE_CONFIDENCE, adaptiveRegion } from './adaptive';
import { coerceValue } from './coerce';
import type { FieldDef, FieldValue, TemplateValueType } from './schema';

export type ExtractResult = {
  values: Record<string, FieldValue>;
  model: string | null;                              // model(s) used, comma-separated
  tokensUsed: number;
  errors: { fieldKey: string; message: string }[];
  pageCount: number;                                 // real page count of the document (images: 1)
  /** Keys that only the WIDENED second look could read (spec §17.2) — the run flags them for review. */
  adaptive: string[];
};

const MIN_TEXT_CHARS = 2;
const TEXT_CONFIDENCE = 1;      // text layer is deterministic
const VISION_CONFIDENCE = 0.8;  // model read; plan 2 shows a chip for < 1
const RETRY_CONFIDENCE = 0.6;   // second, wider read with the stronger model — worth a human's eyes
/** Padding of the RETRY crop: ~2.5× the default, to catch a value the tight box cut in half. */
const RETRY_CROP_PAD = 0.03;
/** Types where a blank or uncoercible read is worth a second, more expensive attempt. */
const RETRYABLE_TYPES = new Set<TemplateValueType>(['NUMBER', 'CURRENCY', 'DATE']);

/**
 * Type-specific reading instructions. Amounts are the field users complain about most: without this
 * the model happily answers «229» for «229,40» or drops a thousands separator, and the coercion has
 * no way to tell a truncated amount from a correct one.
 */
function typeInstruction(valueType: TemplateValueType): string {
  if (valueType === 'CURRENCY' || valueType === 'NUMBER') {
    return ' The value is a number in Greek format (e.g. 1.234,56 — dot groups thousands, comma is the decimal separator). Return the complete number with all its digits and decimals exactly as printed, without a currency symbol.';
  }
  if (valueType === 'DATE') return ' Return the date exactly as printed, without reformatting it.';
  return '';
}

/**
 * The widened second look (spec §17.2). Returns the value it found, or `null` when it found nothing
 * — in which case the field keeps whatever the first two reads left on it.
 *
 * Its failures are logged, never pushed onto `out.errors`: the field ALREADY has a value (an empty
 * one), and an error there means something else entirely downstream — «Σφάλμα ανάγνωσης» on the run
 * card, and a refused per-field re-read. A bonus attempt that could not be made is not a read error.
 */
async function readAdaptively(
  f: FieldDef,
  base: FieldValue,
  bitmap: (page: number) => Promise<Buffer>,
  ref: UsageRef | undefined,
  spend: { models: Set<string>; add: (tokens: number | null) => void },
): Promise<FieldValue | null> {
  const region = adaptiveRegion(f);
  if (!region) return null;
  try {
    const crop = await prepareCrop(await bitmap(region.page), region.bbox, { pad: 0 });
    const r = await readCropValueLocated({ crop, label: f.label, aiHint: f.aiHint, valueType: f.valueType, operation: 'template.field.adaptive', ref });
    spend.models.add(r.model);
    spend.add(r.tokensUsed);
    const coerced = coerceValue(r.value, f.valueType);
    if (!r.value || coerced == null) return null;
    return {
      ...base,
      raw: r.value,
      value: coerced,
      source: 'vision',
      confidence: ADAPTIVE_CONFIDENCE,
      page: region.page,
      // Where the model says it found the value, else the box we searched — either way the run
      // records a position the learning can fold into `lastGood`.
      bbox: cropBoxToPage(region.bbox, r.box) ?? region.bbox,
      adaptive: true,
    };
  } catch (e) {
    console.warn(`[templates] adaptive read failed for «${f.label}»: ${(e as Error).message}`);
    return null;
  }
}

export async function extractTemplateFields(
  buffer: Buffer,
  mimeType: string,
  fields: FieldDef[],
  opts?: { ref?: UsageRef },
): Promise<ExtractResult> {
  const out: ExtractResult = { values: {}, model: null, tokensUsed: 0, errors: [], pageCount: 1, adaptive: [] };
  const isPdf = mimeType === 'application/pdf' || isPdfBuffer(buffer);
  // The real page count drives the `$pageCount` rule variable; a document we cannot count is a
  // single page as far as the rules are concerned (countPdfPages already swallows its own errors).
  if (isPdf) out.pageCount = await countPdfPages(buffer).catch(() => 1);
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
        // Mirror the SINGLE-field rule: a model read that produced something is
        // VISION_CONFIDENCE, an empty read has no confidence to report.
        out.values[f.key] = { ...base, raw: JSON.stringify(r.rows), value: rows, source: 'vision', confidence: r.rows.length > 0 ? VISION_CONFIDENCE : null };
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
      const prompt = `Read the value of the field "${f.label}"${f.aiHint ? ` (${f.aiHint})` : ''}. Expected type: ${f.valueType.toLowerCase()}.${typeInstruction(f.valueType)}`;
      let r = await readCropValue({ crop, prompt, operation: 'template.field', ref });
      models.add(r.model); out.tokensUsed += r.tokensUsed ?? 0;
      let coerced = coerceValue(r.value, f.valueType);
      let confidence = r.value ? VISION_CONFIDENCE : null;

      // A typed field that read as nothing — or as something that will not coerce — is where the
      // wrong amounts come from. Retry it ONCE with more air around the region and the stronger
      // model before storing a null; a value that only the retry could read is marked down to
      // RETRY_CONFIDENCE so the UI still asks a human to glance at it.
      if (RETRYABLE_TYPES.has(f.valueType) && (!r.value || coerced == null)) {
        const wide = await prepareCrop(await bitmap(page), bbox, { pad: RETRY_CROP_PAD });
        const retry = await readCropValue({ crop: wide, prompt, operation: 'template.field', ref, model: UPGRADED_VISION_MODEL });
        models.add(retry.model); out.tokensUsed += retry.tokensUsed ?? 0;
        if (retry.value) {
          r = retry;
          coerced = coerceValue(retry.value, f.valueType);
          confidence = RETRY_CONFIDENCE;
        }
      }
      out.values[f.key] = { ...base, raw: r.value || null, value: coerced, source: 'vision', confidence };

      // Still nothing usable: the box itself is probably in the wrong place on THIS document. Take
      // one — and only one — look in a widened box around where the field was last found (spec
      // §17.2), this time asking the model to locate the label rather than to read a fixed rectangle.
      if (coerced == null) {
        const adaptive = await readAdaptively(f, base, bitmap, ref, { models, add: (t) => { out.tokensUsed += t ?? 0; } });
        if (adaptive) { out.values[f.key] = adaptive; out.adaptive.push(f.key); }
      }
    } catch (e) {
      out.values[f.key] = base;
      out.errors.push({ fieldKey: f.key, message: (e as Error).message });
    }
  }
  out.model = models.size ? [...models].join(', ') : null;
  return out;
}
