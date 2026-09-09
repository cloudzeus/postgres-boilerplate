// lib/templates/detect-parse.ts — ISOMORPHIC. Turns the vision model's JSON into field proposals (spec §14.1-6/7).
import { guessValueType, isGlAccount } from './guess';
import { isValidBbox, slugKey, uniqueKey, type Bbox, type ColumnDef, type TemplateFieldKind, type TemplateValueType } from './schema';

const VALUE_TYPES = new Set(['TEXT', 'NUMBER', 'CURRENCY', 'DATE', 'LIST']);
export const GL_LABEL = 'Λογιστικό άρθρο (χειρόγραφο)';
export const GL_KEY = 'gl_account_handwritten';

export type DetectedField = { label: string; key: string; kind: TemplateFieldKind; valueType: TemplateValueType; value: string; columns: ColumnDef[] | null };
export type DetectedMark = { label: string; key: string; valueType: TemplateValueType; value: string; bbox: Bbox };

/** First {...} object in a model reply, tolerating ```json fences and prose. */
export function extractJson(content: string): unknown | null {
  const stripped = String(content ?? '').replace(/```(?:json)?/gi, '').trim();
  const start = stripped.indexOf('{'); const end = stripped.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(stripped.slice(start, end + 1)); } catch { return null; }
}

const str = (v: unknown): string => (v == null ? '' : String(v).trim());
const round3 = (n: number) => Math.round(n * 1000) / 1000;

function resolveType(model: unknown, value: string): TemplateValueType {
  const m = str(model).toUpperCase();
  return VALUE_TYPES.has(m) ? (m as TemplateValueType) : guessValueType(value);
}

export function parseDetectField(content: string, opts: { taken: Iterable<string>; fallbackLabel: string }): DetectedField {
  const obj = (extractJson(content) ?? {}) as Record<string, unknown>;
  const value = str(obj.value);
  const label = str(obj.label).replace(/[:：]\s*$/, '') || opts.fallbackLabel;
  const rawCols = Array.isArray(obj.columns) ? obj.columns : [];
  const kind: TemplateFieldKind = str(obj.kind).toUpperCase() === 'TABLE' && rawCols.length > 0 ? 'TABLE' : 'SINGLE';
  let columns: ColumnDef[] | null = null;
  if (kind === 'TABLE') {
    const used: string[] = [];
    columns = rawCols.map((c, i) => {
      const col = (typeof c === 'string' ? { label: c } : (c ?? {})) as Record<string, unknown>;
      const l = str(col.label) || `Στήλη ${i + 1}`;
      const k = uniqueKey(slugKey(l), used); used.push(k);
      return { key: k, label: l, valueType: resolveType(col.valueType, str(col.sample)) };
    });
  }
  return { label, key: uniqueKey(slugKey(label), opts.taken), kind, valueType: kind === 'TABLE' ? 'TEXT' : resolveType(obj.valueType, value), value, columns };
}

/** `box_2d` = [ymin, xmin, ymax, xmax] on a 0–1000 grid (Gemini), or `bbox` = [x, y, w, h] normalized 0–1. */
export function toBbox(m: Record<string, unknown>): Bbox | null {
  const b2 = m.box_2d;
  if (Array.isArray(b2) && b2.length === 4 && b2.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    const c = (n: number) => Math.min(1, Math.max(0, n / 1000));
    const [ymin, xmin, ymax, xmax] = b2 as number[];
    const x = c(xmin), y = c(ymin);
    const box: Bbox = [round3(x), round3(y), round3(c(xmax) - x), round3(c(ymax) - y)];
    return isValidBbox(box) ? box : null;
  }
  const bb = m.bbox;
  if (isValidBbox(bb)) return bb.map(round3) as Bbox;
  return null;
}

export function parseMarks(content: string, opts: { taken: Iterable<string>; max?: number }): DetectedMark[] {
  const obj = extractJson(content) as { marks?: unknown } | null;
  const arr = Array.isArray(obj?.marks) ? (obj!.marks as unknown[]) : [];
  const taken = new Set(opts.taken);
  const out: DetectedMark[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const m = raw as Record<string, unknown>;
    const bbox = toBbox(m);
    if (!bbox) continue;
    const value = str(m.value);
    const gl = isGlAccount(value);
    const label = (gl ? str(m.label) || GL_LABEL : str(m.label).replace(/[:：]\s*$/, '')) || `Πεδίο ${out.length + 1}`;
    const key = uniqueKey(gl ? GL_KEY : slugKey(label), taken);
    taken.add(key);
    out.push({ label, key, valueType: gl ? 'TEXT' : resolveType(m.valueType, value), value, bbox });
    if (out.length >= (opts.max ?? 20)) break;
  }
  return out;
}
