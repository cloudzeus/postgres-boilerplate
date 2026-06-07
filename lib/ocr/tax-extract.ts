import {
  resolveCfg, callVisionLLM, callGeminiPdfNative, rasterizePdf, enhanceForOcr, parseJsonLoose,
  type DeepSeekCfg,
} from '@/lib/ocr/extract';
import { cropRegionToImage } from '@/lib/ocr/rasterize';
import { regionHintText, type TemplateFieldLite } from '@/lib/tax/template-prompt';
import type { FinancialValueTypeStr } from '@/lib/greek-format';

export type SeriesPoint = { year: number | null; value: string | null };

export type TaxExtractResult = {
  values: Record<string, string | null>;        // SINGLE fields → fieldKey → raw value
  series: Record<string, SeriesPoint[]>;         // SERIES fields → fieldKey → [{year, value}]
  model: string;
  tokensUsed: number | null;
  durationMs: number;
};

export type ScanTableResult = {
  name: string;                                   // table title
  code: string;                                   // the table's own Ε3 code (e.g. 040), if any
  columns: string[];                              // value-column headers (e.g. years)
  rows: { label: string; code: string; values: string[] }[]; // label + Ε3 code + values
  headers: string[];                              // ALL column titles (for records mode)
  grid: string[][];                               // every row as raw cells (for records mode)
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
  const lines = fields.filter((f) => f.kind !== 'TABLE').map((f) => {
    const loc = regionHintText(f.regionHint);
    const where = loc ? ` — located at ${loc}` : '';
    const hint = f.aiHint ? ` (${f.aiHint})` : '';
    if (f.kind === 'SERIES') {
      return `- "${f.fieldKey}": SERIES — read the table row labeled "${f.label}"${where}${hint}. Return an array of {"year": <number or null>, "value": "<string or null>"} for every year/column present, left to right.`;
    }
    return `- "${f.fieldKey}": "${f.label}"${where}${hint}. Return the single value as a string, or null.`;
  });
  const shape = fields.filter((f) => f.kind !== 'TABLE').map((f) => (f.kind === 'SERIES'
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
    if (f.kind === 'TABLE') continue; // records extraction handled separately (Phase 2)
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

export type FieldDef = {
  fieldKey: string;
  label: string;
  valueType: FinancialValueTypeStr;
  kind: 'SINGLE' | 'SERIES' | 'TABLE';
  aiHint?: string | null;
  regionHint?: { page: number; bbox: [number, number, number, number] } | null;
  config?: { columns: string[] } | null;
};

export type FieldExtract =
  | { fieldKey: string; label: string; kind: 'SINGLE'; valueType: FinancialValueTypeStr; raw: string | null }
  | { fieldKey: string; label: string; kind: 'SERIES'; valueType: FinancialValueTypeStr; series: { year: number | null; raw: string | null }[] }
  | { fieldKey: string; label: string; kind: 'TABLE'; columns: string[]; records: Record<string, string>[] };

/** Extracts ONE field from a company document by cropping its region (reliable) and dispatching by kind. */
export async function extractField(buffer: Buffer, mimeType: string, field: FieldDef): Promise<FieldExtract> {
  const region = field.regionHint;
  if (!region) {
    if (field.kind === 'TABLE') return { fieldKey: field.fieldKey, label: field.label, kind: 'TABLE', columns: field.config?.columns ?? [], records: [] };
    if (field.kind === 'SERIES') return { fieldKey: field.fieldKey, label: field.label, kind: 'SERIES', valueType: field.valueType, series: [] };
    return { fieldKey: field.fieldKey, label: field.label, kind: 'SINGLE', valueType: field.valueType, raw: null };
  }
  const crop = await cropRegionToImage(buffer, mimeType, region);

  if (field.kind === 'TABLE') {
    const t = await scanTable(crop, 'image/png', { page: 0, bbox: [0, 0, 1, 1] });
    const columns = field.config?.columns?.length ? field.config.columns : t.headers;
    const records = t.grid.map((row) => {
      const o: Record<string, string> = {};
      columns.forEach((c, i) => { o[c] = row[i] ?? ''; });
      return o;
    });
    return { fieldKey: field.fieldKey, label: field.label, kind: 'TABLE', columns, records };
  }

  const r = await extractTaxForm(crop, 'image/png', [{
    fieldKey: field.fieldKey, label: field.label, aiHint: field.aiHint ?? null, regionHint: undefined, valueType: field.valueType, kind: field.kind,
  }]);
  if (field.kind === 'SERIES') {
    return { fieldKey: field.fieldKey, label: field.label, kind: 'SERIES', valueType: field.valueType, series: (r.series[field.fieldKey] ?? []).map((p) => ({ year: p.year, raw: p.value })) };
  }
  return { fieldKey: field.fieldKey, label: field.label, kind: 'SINGLE', valueType: field.valueType, raw: r.values[field.fieldKey] ?? null };
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
    'The image is a CROP of ONE table from a Greek tax form (Ε3/Ε1).',
    'Read ONLY what is visible in this image.',
    'Return a single raw JSON object (no markdown) with this shape:',
    '{ "name": "<table title>", "code": "<table code or empty>", "headers": ["<all column titles in order>"], "grid": [["<cell>", ...], ...], "columns": ["<value column headers>"], "rows": [ { "label": "<row description>", "code": "<Ε3 line code or empty>", "values": ["<v1>", ...] } ] }',
    'Rules:',
    '- "name" = the table heading/title (e.g. "Απασχολούμενο Προσωπικό", "Ενεργοί Επαγγελματικοί Λογαριασμοί").',
    '- "code" = the code printed in the table\'s TITLE/header box (e.g. "040", "041", "045"). "" if the table title has no code.',
    '- "headers" = EVERY column title in order, including the leftmost description column. "grid" = every data row as an array of ALL cell strings in column order (faithful copy).',
    '- "columns" = headers of the VALUE columns only (e.g. years). If a single unlabeled value column, use ["Τιμή"].',
    '- "label" = the descriptive row text on the left.',
    '- "code" = the small numeric form code printed in the row (a 3-digit number like "025", "500"). Put it ONLY in "code", never inside values. Use "" if none.',
    '- "values" = the data cell values aligned to "columns", EXCLUDING the code. Keep numbers EXACTLY as printed (Greek format). Use "" for empty cells.',
    '- Include every data row. Skip purely decorative/empty rows.',
  ].join('\n');

  // Crop to the marked region so the model sees ONLY this table (reliable).
  const crop = await cropRegionToImage(buffer, mimeType, regionHint);
  const { parsed, model, tokens } = await runVision(cfg, system, crop, 'image/png');
  const name = parsed.name == null ? '' : String(parsed.name);
  const code = parsed.code == null ? '' : String(parsed.code).replace(/[^\dA-Za-z]/g, '');
  const columns = Array.isArray(parsed.columns) ? (parsed.columns as unknown[]).map((c) => String(c)) : [];
  const rowsRaw = Array.isArray(parsed.rows) ? (parsed.rows as unknown[]) : [];
  const rows = rowsRaw
    .map((r) => {
      const o = (r ?? {}) as { label?: unknown; code?: unknown; values?: unknown };
      return {
        label: o.label == null ? '' : String(o.label),
        code: o.code == null ? '' : String(o.code).replace(/[^\dA-Za-z]/g, ''),
        values: Array.isArray(o.values) ? (o.values as unknown[]).map((v) => (v == null ? '' : String(v))) : [],
      };
    })
    .filter((r) => r.label.trim().length > 0);
  const headers = Array.isArray(parsed.headers) ? (parsed.headers as unknown[]).map((c) => String(c)) : [];
  const grid = Array.isArray(parsed.grid)
    ? (parsed.grid as unknown[]).map((row) => (Array.isArray(row) ? (row as unknown[]).map((c) => (c == null ? '' : String(c))) : []))
    : [];
  return { name, code, columns, rows, headers, grid, model, tokensUsed: tokens, durationMs: Date.now() - started };
}
