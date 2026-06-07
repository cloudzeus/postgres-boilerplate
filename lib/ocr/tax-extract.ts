import {
  resolveCfg, callVisionLLM, callGeminiPdfNative, rasterizePdf, enhanceForOcr, parseJsonLoose,
  type DeepSeekCfg,
} from '@/lib/ocr/extract';
import { cropRegionToImage } from '@/lib/ocr/rasterize';
import { regionHintText, type TemplateFieldLite } from '@/lib/tax/template-prompt';

export type SeriesPoint = { year: number | null; value: string | null };

export type TaxExtractResult = {
  values: Record<string, string | null>;        // SINGLE fields → fieldKey → raw value
  series: Record<string, SeriesPoint[]>;         // SERIES fields → fieldKey → [{year, value}]
  model: string;
  tokensUsed: number | null;
  durationMs: number;
};

export type ScanTableResult = {
  columns: string[];                              // column headers (e.g. years)
  rows: { label: string; values: string[] }[];    // one entry per table row
  model: string;
  tokensUsed: number | null;
  durationMs: number;
};

function safeParseJsonLoose(s: string): Record<string, unknown> | null {
  try {
    return (parseJsonLoose(s) as Record<string, unknown>) ?? null;
  } catch {
    return null;
  }
}

const GEMINI = 'generativelanguage.googleapis.com';

/** Runs the vision pipeline (gemini-native PDF, rasterized-PDF fallback, or image) and returns parsed JSON. */
async function runVision(
  cfg: DeepSeekCfg,
  system: string,
  buffer: Buffer,
  mimeType: string,
): Promise<{ parsed: Record<string, unknown>; model: string; tokens: number | null }> {
  if (mimeType === 'application/pdf' && cfg.visionUrl.includes(GEMINI)) {
    const out = await callGeminiPdfNative(cfg, system, buffer, undefined, 'TAX_FORM');
    return { parsed: safeParseJsonLoose(out.content) ?? {}, model: out.model, tokens: out.tokens };
  }
  if (mimeType === 'application/pdf') {
    const pages = await rasterizePdf(buffer, 5, 2);
    const merged: Record<string, unknown> = {};
    let model = cfg.visionModel;
    let tokens: number | null = null;
    for (const page of pages) {
      const enhanced = await enhanceForOcr(page);
      const out = await callVisionLLM(cfg, system, enhanced.buffer.toString('base64'), enhanced.mimeType, undefined, 'TAX_FORM');
      model = out.model;
      tokens = (tokens ?? 0) + (out.tokens ?? 0);
      const parsed = safeParseJsonLoose(out.content) ?? {};
      for (const [k, v] of Object.entries(parsed)) {
        const empty = v == null || (Array.isArray(v) && v.length === 0);
        if (!empty && (merged[k] == null || (Array.isArray(merged[k]) && (merged[k] as unknown[]).length === 0))) merged[k] = v;
      }
    }
    return { parsed: merged, model, tokens };
  }
  const enhanced = await enhanceForOcr(buffer);
  const out = await callVisionLLM(cfg, system, enhanced.buffer.toString('base64'), enhanced.mimeType, undefined, 'TAX_FORM');
  return { parsed: safeParseJsonLoose(out.content) ?? {}, model: out.model, tokens: out.tokens };
}

function buildFieldsPrompt(fields: TemplateFieldLite[]): string {
  const lines = fields.map((f) => {
    const loc = regionHintText(f.regionHint);
    const where = loc ? ` — located at ${loc}` : '';
    const hint = f.aiHint ? ` (${f.aiHint})` : '';
    if (f.kind === 'SERIES') {
      return `- "${f.fieldKey}": SERIES — read the table row labeled "${f.label}"${where}${hint}. Return an array of {"year": <number or null>, "value": "<string or null>"} for every year/column present, left to right.`;
    }
    return `- "${f.fieldKey}": "${f.label}"${where}${hint}. Return the single value as a string, or null.`;
  });
  const shape = fields.map((f) => (f.kind === 'SERIES'
    ? `"${f.fieldKey}": [{"year": 2024, "value": "..."}]`
    : `"${f.fieldKey}": "value or null"`)).join(', ');
  return [
    'You are a precise field extractor for a Greek financial/tax document (Ε3/Ε1).',
    'Extract ONLY the fields listed. Respond with a single raw JSON object (no markdown).',
    'Keep numbers EXACTLY as printed (Greek format, e.g. "1.556.540,27"). Use null when absent.',
    '',
    'Fields:',
    ...lines,
    '',
    `Output shape: { ${shape} }`,
  ].join('\n');
}

/** Extracts named tax-form fields (single + multi-year series) using region hints + AI vision. */
export async function extractTaxForm(
  buffer: Buffer,
  mimeType: string,
  fields: TemplateFieldLite[],
): Promise<TaxExtractResult> {
  const cfg = await resolveCfg();
  const started = Date.now();
  const { parsed, model, tokens } = await runVision(cfg, buildFieldsPrompt(fields), buffer, mimeType);

  const values: Record<string, string | null> = {};
  const series: Record<string, SeriesPoint[]> = {};
  for (const f of fields) {
    const raw = parsed[f.fieldKey];
    if (f.kind === 'SERIES') {
      series[f.fieldKey] = Array.isArray(raw)
        ? raw.map((p) => {
            const o = (p ?? {}) as { year?: unknown; value?: unknown };
            const year = o.year == null ? null : Number(String(o.year).replace(/[^\d]/g, '')) || null;
            return { year, value: o.value == null ? null : String(o.value) };
          })
        : [];
    } else {
      values[f.fieldKey] = raw == null ? null : String(raw);
    }
  }
  return { values, series, model, tokensUsed: tokens, durationMs: Date.now() - started };
}

/** Reads a marked TABLE region into a generic grid (columns + labeled rows) for template mapping. */
export async function scanTable(
  buffer: Buffer,
  mimeType: string,
  regionHint: { page: number; bbox: [number, number, number, number] },
): Promise<ScanTableResult> {
  const cfg = await resolveCfg();
  const started = Date.now();
  const system = [
    'The image is a CROP of ONE table from a Greek financial/tax document (Ε3/Ε1).',
    'Read ONLY what is visible in this image.',
    'Return a single raw JSON object (no markdown) with this shape:',
    '{ "columns": ["<header1>", "<header2>", ...], "rows": [ { "label": "<row label, leftmost cell>", "values": ["<v1>", "<v2>", ...] } ] }',
    'Rules:',
    '- "columns" = the column headers across the top (e.g. years "2016","2017","2018"). If there is a single value column with no header, use ["Τιμή"].',
    '- Each row: "label" is the descriptive text on the left; "values" are the cell values aligned to columns, left to right.',
    '- Keep numbers EXACTLY as printed (Greek format, e.g. "1.556.540,27"). Use "" for empty cells.',
    '- Include every data row. Skip purely decorative/empty rows.',
  ].join('\n');

  // Crop to the marked region so the model sees ONLY this table (reliable).
  const crop = await cropRegionToImage(buffer, mimeType, regionHint);
  const { parsed, model, tokens } = await runVision(cfg, system, crop, 'image/png');
  const columns = Array.isArray(parsed.columns) ? (parsed.columns as unknown[]).map((c) => String(c)) : [];
  const rowsRaw = Array.isArray(parsed.rows) ? (parsed.rows as unknown[]) : [];
  const rows = rowsRaw
    .map((r) => {
      const o = (r ?? {}) as { label?: unknown; values?: unknown };
      return {
        label: o.label == null ? '' : String(o.label),
        values: Array.isArray(o.values) ? (o.values as unknown[]).map((v) => (v == null ? '' : String(v))) : [],
      };
    })
    .filter((r) => r.label.trim().length > 0);
  return { columns, rows, model, tokensUsed: tokens, durationMs: Date.now() - started };
}
