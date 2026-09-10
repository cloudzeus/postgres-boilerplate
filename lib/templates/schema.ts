// lib/templates/schema.ts — ISOMORPHIC (no prisma, no React). Shared by client + server.
import { slugifyFieldKey } from './slug';

export type Bbox = [number, number, number, number];           // x, y, w, h normalized 0-1
export type Region = { page: number; bbox: Bbox };
export type TemplateFieldKind = 'SINGLE' | 'TABLE';
export type TemplateValueType = 'TEXT' | 'NUMBER' | 'CURRENCY' | 'DATE' | 'LIST';
export type TemplateMode = 'AUTO' | 'SEMI_AUTO' | 'MANUAL';
export type MappingTarget = 'INVOICE' | 'EXCEL';

export type ColumnDef = { key: string; label: string; valueType: TemplateValueType };

export type FieldDef = {
  key: string;
  label: string;
  kind: TemplateFieldKind;
  valueType: TemplateValueType;
  color: string;
  region: Region | null;
  columns: ColumnDef[] | null;
  aiHint: string | null;
  required: boolean;
  order: number;
};

/** Value of one extracted field, as stored in TemplateRun.values[key]. */
export type FieldValue = {
  raw: string | null;                                // what the reader returned
  value: string | number | string[] | Record<string, unknown>[] | null; // coerced (TABLE → rows)
  confidence: number | null;
  source: 'text' | 'vision' | 'manual' | 'rule' | 'none'; // 'rule' = written by a SET_FIELD action; 'none' = nothing was read (no region, or the read failed)
  page: number | null;
  bbox: Bbox | null;
  color: string;
};

/** Outcome of one template run, as stored in TemplateRun.status (mirrors prisma enum TemplateRunStatus). */
export type RunStatus = 'EXTRACTED' | 'REVIEW' | 'BLOCKED' | 'POSTED' | 'FAILED';
/** What started a run (TemplateRun.trigger). */
export type RunTrigger = 'upload' | 'manual' | 'reextract';
/**
 * What a run reports back to its caller. Isomorphic on purpose: the runner (`lib/templates/run.ts`)
 * returns it and the client (`components/templates/api.ts`) types the POST response with it, so the
 * two can never drift apart.
 */
export type RunOutcome = { runId: string; status: RunStatus; flags: { review: string[]; blocked: string[] }; error: string | null };

export type MappingRowInvoice = { fieldKey: string; invoiceKey: string };
export type MappingRowExcel = { fieldKey: string; column: string; order: number };

export type ClauseOp =
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
  | 'contains' | 'notContains' | 'empty' | 'notEmpty' | 'regex' | 'in';
export type Clause = { fieldKey: string; op: ClauseOp; value?: string };

export type ActionType = 'SET_FIELD' | 'FLAG_REVIEW' | 'BLOCK_POSTING' | 'SWITCH_MAPPING' | 'NOTIFY';
export type Action =
  | { type: 'SET_FIELD'; params: { fieldKey?: string; invoiceKey?: string; value: string } }
  | { type: 'FLAG_REVIEW'; params: { reason: string } }
  | { type: 'BLOCK_POSTING'; params: { reason: string } }
  | { type: 'SWITCH_MAPPING'; params: { mappingName: string } }
  | { type: 'NOTIFY'; params: { emails?: string; subject: string } };

/** Fixed palette (all legible on white, distinct from each other). Order matters: assigned first-free. */
export const COLOR_PALETTE = [
  '#0078D4', '#047857', '#C2410C', '#6D28D9', '#BE185D', '#0F766E',
  '#B45309', '#1D4ED8', '#7C2D12', '#4D7C0F', '#9F1239', '#334155',
] as const;

/** First palette colour not in `used` (case-insensitive); wraps to the least-used when all are taken. */
export function nextColor(used: string[]): string {
  const counts = new Map<string, number>();
  for (const c of COLOR_PALETTE) counts.set(c, 0);
  for (const u of used) {
    const k = u.toUpperCase();
    if (counts.has(k)) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best: string = COLOR_PALETTE[0];
  let bestCount = Number.POSITIVE_INFINITY;
  for (const c of COLOR_PALETTE) {
    const n = counts.get(c) ?? 0;
    if (n < bestCount) { best = c; bestCount = n; }
  }
  return best;
}

/** Stable machine key from a label (Greek → Latin, snake_case). Reuses the shared slugger (`./slug`). */
export function slugKey(label: string): string {
  return slugifyFieldKey(label);
}

/**
 * `base` if not taken, else `base_2`, `base_3`, … (exact, case-sensitive match).
 * The suffix must fit inside the 60-char key limit, so a long base is trimmed before it is suffixed
 * (`slugKey` already caps the un-suffixed base at 60).
 */
export function uniqueKey(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  let n = 2;
  for (;;) {
    const b = base.slice(0, 60 - String(n).length - 1);
    const candidate = `${b}_${n}`;
    if (!set.has(candidate)) return candidate;
    n += 1;
  }
}

/** Charset a template slug (and any hand-typed correction of one) must stay inside. */
export const SLUG_RE = /^[a-z0-9_]{1,60}$/;

/**
 * `slugKey` for a CONTROLLED INPUT the user is typing into. Two differences:
 * an empty box stays empty (`slugKey('')` invents a random `field_<id>`), and a
 * separator just typed survives the round trip, so `iron` → `iron_` → `iron_2`
 * is reachable — the plain slugger trims the trailing `_` and swallows the key.
 */
export function slugDraft(typed: string): string {
  if (!typed.trim()) return '';
  // slugKey() already caps at 60; the appended separator can push it to 61, so re-cap.
  return (slugKey(typed) + (/[^\p{L}\p{N}]$/u.test(typed) ? '_' : '')).slice(0, 60);
}

/** Template slug — the key of the JSON output. Same charset/rules as a field key. */
export function templateSlug(name: string): string {
  return slugKey(name);
}

/**
 * The app's single ΑΦΜ predicate: digits only, and exactly nine of them, else `null` = "not an ΑΦΜ
 * we can match a template on". The OCR value arrives with spaces, dots or an `EL` prefix, so the
 * comparison has to normalise both sides — and it must normalise them the SAME way everywhere, or
 * the picker would offer a template the runner would never pick by itself.
 */
export function normalizeVat(v: unknown): string | null {
  const digits = String(v ?? '').replace(/\D/g, '');
  return /^\d{9}$/.test(digits) ? digits : null;
}

export function isValidBbox(b: unknown): b is Bbox {
  if (!Array.isArray(b) || b.length !== 4) return false;
  const [x, y, w, h] = b;
  if (![x, y, w, h].every((n) => typeof n === 'number' && Number.isFinite(n))) return false;
  return x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1.0001 && y + h <= 1.0001;
}

export type InvoiceKeyInfo = { key: string; label: string; valueType: TemplateValueType; isLine: boolean };

/** The app's invoice schema keys a template can map onto (OcrDocument.extractedData). */
export const INVOICE_SCHEMA: InvoiceKeyInfo[] = [
  // Header keys — exactly the names the OCR pipeline writes into OcrDocument.extractedData
  // (see lib/ocr/templates.ts TEMPLATE_SCHEMAS.invoice.jsonStructure).
  { key: 'companyName',        label: 'Επωνυμία εκδότη',            valueType: 'TEXT',     isLine: false },
  { key: 'vatNumber',          label: 'ΑΦΜ εκδότη',                 valueType: 'TEXT',     isLine: false },
  { key: 'companyAddress',     label: 'Διεύθυνση εκδότη',           valueType: 'TEXT',     isLine: false },
  { key: 'companyDoy',         label: 'ΔΟΥ εκδότη',                 valueType: 'TEXT',     isLine: false },
  { key: 'companyProfession',  label: 'Επάγγελμα εκδότη',           valueType: 'TEXT',     isLine: false },
  { key: 'companyPhone',       label: 'Τηλέφωνο εκδότη',            valueType: 'TEXT',     isLine: false },
  { key: 'companyEmail',       label: 'Email εκδότη',               valueType: 'TEXT',     isLine: false },
  { key: 'customerName',       label: 'Επωνυμία παραλήπτη',         valueType: 'TEXT',     isLine: false },
  { key: 'customerVatNumber',  label: 'ΑΦΜ παραλήπτη',              valueType: 'TEXT',     isLine: false },
  { key: 'documentTypeLabel',  label: 'Τύπος παραστατικού',         valueType: 'TEXT',     isLine: false },
  { key: 'invoiceNumber',      label: 'Αριθμός παραστατικού',       valueType: 'TEXT',     isLine: false },
  { key: 'aadeMark',           label: 'ΜΑΡΚ ΑΑΔΕ',                  valueType: 'TEXT',     isLine: false },
  { key: 'date',               label: 'Ημερομηνία',                 valueType: 'DATE',     isLine: false },
  { key: 'time',               label: 'Ώρα',                        valueType: 'TEXT',     isLine: false },
  { key: 'itemsCount',         label: 'Πλήθος ειδών',               valueType: 'NUMBER',   isLine: false },
  { key: 'subtotal',           label: 'Καθαρή αξία',                valueType: 'CURRENCY', isLine: false },
  { key: 'vatAmount',          label: 'ΦΠΑ',                        valueType: 'CURRENCY', isLine: false },
  { key: 'totalAmount',        label: 'Γενικό σύνολο',              valueType: 'CURRENCY', isLine: false },
  { key: 'items.code',         label: 'Γραμμή: κωδικός',            valueType: 'TEXT',     isLine: true },
  { key: 'items.name',         label: 'Γραμμή: περιγραφή',          valueType: 'TEXT',     isLine: true },
  { key: 'items.quantity',     label: 'Γραμμή: ποσότητα',           valueType: 'NUMBER',   isLine: true },
  { key: 'items.price',        label: 'Γραμμή: τιμή μονάδας',       valueType: 'CURRENCY', isLine: true },
  { key: 'items.discount',     label: 'Γραμμή: έκπτωση',            valueType: 'NUMBER',   isLine: true },
  { key: 'items.vatRate',      label: 'Γραμμή: ΦΠΑ %',              valueType: 'NUMBER',   isLine: true },
  { key: 'items.total',        label: 'Γραμμή: αξία',               valueType: 'CURRENCY', isLine: true },
];

/** Info for a mapping target key. `customFields.<anything>` is always accepted as a TEXT header key. */
export function invoiceKeyInfo(key: string): InvoiceKeyInfo | null {
  const found = INVOICE_SCHEMA.find((k) => k.key === key);
  if (found) return found;
  const m = /^customFields\.([a-z0-9_]+)$/.exec(key); // slugKey output charset
  if (m) return { key, label: m[1], valueType: 'TEXT', isLine: false };
  return null;
}
