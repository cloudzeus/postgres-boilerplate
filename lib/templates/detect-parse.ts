// lib/templates/detect-parse.ts — ISOMORPHIC. Turns the vision model's JSON into field proposals (spec §14.1-6/7).
import { guessValueType, isGlAccount } from './guess';
import { isValidBbox, slugKey, uniqueKey, type Bbox, type ColumnDef, type TemplateFieldKind, type TemplateValueType } from './schema';

const VALUE_TYPES = new Set(['TEXT', 'NUMBER', 'CURRENCY', 'DATE', 'LIST']);
export const GL_LABEL = 'Λογιστικό άρθρο (χειρόγραφο)';
export const GL_KEY = 'gl_account_handwritten';
/** Validator limits the proposals must already respect (lib/templates/validate.ts). */
const LABEL_MAX = 120;
const COLUMNS_MAX = 30;
/** A "mark" covering more of the page than this is the model boxing the whole document, not a value. */
const MARK_AREA_MAX = 0.7;

export type DetectedField = { label: string; key: string; kind: TemplateFieldKind; valueType: TemplateValueType; value: string; columns: ColumnDef[] | null };
export type DetectedMark = { label: string; key: string; valueType: TemplateValueType; value: string; bbox: Bbox };

/** Scan a balanced `{…}` / `[…]` from `start`, ignoring braces inside strings, so trailing prose (with braces of its own) cannot swallow the value. */
function scanJson(s: string, start: number): unknown | null {
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0; let inStr = false; let esc = false;
  for (let i = start; i < s.length; i += 1) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) { try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; } }
    }
  }
  return null;
}

/** First JSON value in a model reply — an object or a top-level array — tolerating ```json fences and prose on both sides. */
export function extractJson(content: string): unknown | null {
  const stripped = String(content ?? '').replace(/```(?:json)?/gi, '').trim();
  const o = stripped.indexOf('{'); const a = stripped.indexOf('[');
  const start = o < 0 ? a : a < 0 ? o : Math.min(o, a);
  if (start < 0) return null;
  return scanJson(stripped, start);
}

const str = (v: unknown): string => (v == null ? '' : String(v).trim());
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const num = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
const cleanLabel = (v: unknown): string => str(v).replace(/[:：]\s*$/, '').trim();

function resolveType(model: unknown, value: string): TemplateValueType {
  const m = str(model).toUpperCase();
  return VALUE_TYPES.has(m) ? (m as TemplateValueType) : guessValueType(value);
}

/** `null` when the model did not return parseable JSON — the caller must surface that as a failure, not as an empty field. */
export function parseDetectField(content: string, opts: { taken: Iterable<string>; fallbackLabel: string }): DetectedField | null {
  const raw = extractJson(content);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const value = str(obj.value);
  const label = (cleanLabel(obj.label) || opts.fallbackLabel).slice(0, LABEL_MAX);
  const rawCols = (Array.isArray(obj.columns) ? obj.columns : []).slice(0, COLUMNS_MAX);
  const kind: TemplateFieldKind = str(obj.kind).toUpperCase() === 'TABLE' && rawCols.length > 0 ? 'TABLE' : 'SINGLE';
  let columns: ColumnDef[] | null = null;
  if (kind === 'TABLE') {
    const used: string[] = [];
    columns = rawCols.map((c, i) => {
      const col = (typeof c === 'string' ? { label: c } : (c ?? {})) as Record<string, unknown>;
      const l = (cleanLabel(col.label) || `Στήλη ${i + 1}`).slice(0, LABEL_MAX);
      const k = uniqueKey(slugKey(l), used); used.push(k);
      return { key: k, label: l, valueType: resolveType(col.valueType, str(col.sample)) };
    });
  }
  return { label, key: uniqueKey(slugKey(label), opts.taken), kind, valueType: kind === 'TABLE' ? 'TEXT' : resolveType(obj.valueType, value), value, columns };
}

/**
 * `box_2d` = [ymin, xmin, ymax, xmax] on a 0–1000 grid (Gemini) — or already normalized 0–1 when all
 * four values are ≤ 1 — or `bbox` = [x, y, w, h] normalized 0–1. Numeric strings are accepted.
 * Geometry only: the "this box is the whole page" guard lives in `parseMarks`.
 */
export function toBbox(m: Record<string, unknown>): Bbox | null {
  const b2 = m.box_2d;
  if (Array.isArray(b2) && b2.length === 4) {
    const v = b2.map(num);
    if (v.every((n) => Number.isFinite(n))) {
      // A model that answers on a 0–1 scale is indistinguishable from a 0–1000 one only for
      // degenerate boxes; treat "every value ≤ 1" as already normalized.
      const div = v.every((n) => n <= 1) ? 1 : 1000;
      const c = (n: number) => Math.min(1, Math.max(0, n / div));
      const [ymin, xmin, ymax, xmax] = v;
      const x = c(xmin); const y = c(ymin);
      const w = c(xmax) - x; const h = c(ymax) - y;
      if (!(w > 0 && h > 0)) return null; // validate before rounding — rounding can only hide an inverted box
      const rx = round3(x); const ry = round3(y);
      // Rounding both edges outwards can push x+w past 1 (e.g. 0.1005 + 0.8995 → 0.101 + 0.9).
      const box: Bbox = [rx, ry, Math.min(round3(w), 1 - rx), Math.min(round3(h), 1 - ry)];
      return isValidBbox(box) ? box : null;
    }
    return null;
  }
  const bb = m.bbox;
  if (Array.isArray(bb) && bb.length === 4) {
    const v = bb.map(num);
    if (!v.every((n) => Number.isFinite(n))) return null;
    const [x, y, w, h] = v.map(round3);
    const box: Bbox = [x, y, Math.min(w, 1 - x), Math.min(h, 1 - y)];
    return isValidBbox(box) ? box : null;
  }
  return null;
}

/** `null` when the model did not return parseable JSON; `[]` when it answered with no marks. */
export function parseMarks(content: string, opts: { taken: Iterable<string>; max?: number }): DetectedMark[] | null {
  const raw = extractJson(content);
  if (raw == null) return null;
  const arr = Array.isArray(raw) ? raw : Array.isArray((raw as { marks?: unknown }).marks) ? ((raw as { marks: unknown[] }).marks) : null;
  const taken = new Set(opts.taken);
  const out: DetectedMark[] = [];
  const cap = Math.max(0, opts.max ?? 20);
  if (!arr) return out;
  for (const entry of arr) {
    if (out.length >= cap) break;
    if (!entry || typeof entry !== 'object') continue;
    const m = entry as Record<string, unknown>;
    const value = str(m.value);
    const rawLabel = str(m.label);
    if (!rawLabel && !value) continue; // nothing to name and nothing to show
    const bbox = toBbox(m);
    if (!bbox) continue;
    if (bbox[2] * bbox[3] > MARK_AREA_MAX) continue; // the whole page is not a mark
    const gl = isGlAccount(value);
    // «Πεδίο N» must continue the numbering of the fields the template already has.
    const label = (gl ? rawLabel || GL_LABEL : cleanLabel(m.label)) || `Πεδίο ${taken.size + 1}`;
    const key = uniqueKey(gl ? GL_KEY : slugKey(label), taken);
    taken.add(key);
    out.push({ label: label.slice(0, LABEL_MAX), key, valueType: gl ? 'TEXT' : resolveType(m.valueType, value), value, bbox });
  }
  return out;
}
