// lib/templates/run-logic.ts — PURE pieces of a template run (spec §15.3). No I/O.
import { coerceValue } from './coerce';
import { invoiceKeyInfo, type FieldDef, type FieldValue, type MappingTarget, type TemplateMode } from './schema';

export type RunFlags = { review: string[]; blocked: string[] };
export type MappingLike = { name: string; target: MappingTarget; isDefault: boolean; rows: unknown[] };
export type RunDecision = 'EXTRACTED' | 'REVIEW' | 'BLOCKED' | 'POST';

/** SET_FIELD actions that target a template field: coerce by the field's type and mark the value as manual. */
export function applySetFields(values: Record<string, FieldValue>, fields: FieldDef[], sets: { fieldKey?: string; value: string }[]): Record<string, FieldValue> {
  const out = { ...values };
  for (const s of sets) {
    if (!s.fieldKey) continue;
    const f = fields.find((x) => x.key === s.fieldKey);
    if (!f) continue;
    const prev = out[f.key];
    out[f.key] = { raw: s.value, value: coerceValue(s.value, f.valueType), confidence: 1, source: 'manual', page: prev?.page ?? f.region?.page ?? null, bbox: prev?.bbox ?? f.region?.bbox ?? null, color: f.color };
  }
  return out;
}

const isBlank = (v: FieldValue['value']) => v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

export function requiredMissing(fields: FieldDef[], values: Record<string, FieldValue>): FieldDef[] {
  return fields.filter((f) => f.required && isBlank(values[f.key]?.value ?? null));
}

/** The INVOICE mapping that drives the projection: the switched one if it exists and is INVOICE, else the default, else the first. */
export function pickMapping<M extends MappingLike>(mappings: M[], switched: string | null): M | null {
  const invoice = mappings.filter((m) => m.target === 'INVOICE');
  if (switched) { const hit = invoice.find((m) => m.name === switched); if (hit) return hit; }
  return invoice.find((m) => m.isDefault) ?? invoice[0] ?? null;
}

export function decideStatus(mode: TemplateMode, flags: RunFlags): RunDecision {
  if (mode === 'MANUAL') return 'EXTRACTED';
  if (mode === 'SEMI_AUTO') return 'REVIEW';
  return flags.blocked.length ? 'BLOCKED' : 'POST';
}

export function extrasFrom(extracted: Record<string, unknown>, itemsCount: number, pageCount: number): Record<string, number | string | null> {
  const t = extracted.totalAmount;
  return { $total: typeof t === 'number' ? t : typeof t === 'string' && t.trim() ? t : null, $itemsCount: itemsCount, $pageCount: pageCount };
}

/** SET_FIELD actions that target an invoice key, applied after the projection. `items.*` cannot be set as a whole — ignored. */
export function setInvoicePath(data: Record<string, unknown>, invoiceKey: string, value: string): void {
  const info = invoiceKeyInfo(invoiceKey);
  if (!info || info.isLine) return;
  if (invoiceKey.startsWith('customFields.')) {
    const prev = data.customFields;
    const cf = prev && typeof prev === 'object' && !Array.isArray(prev) ? { ...(prev as Record<string, unknown>) } : {};
    cf[invoiceKey.slice('customFields.'.length)] = value;
    data.customFields = cf;
    return;
  }
  data[invoiceKey] = info.valueType === 'TEXT' ? value : (coerceValue(value, info.valueType) ?? value);
}

export type ItemRow = { rowIndex: number; code: string | null; name: string; quantity: number | null; price: number | null; discount: number | null; vatRate: number | null; total: number | null };
const num = (x: unknown): number | null => { if (x == null || x === '') return null; const n = typeof x === 'number' ? x : Number(String(x).replace(',', '.')); return Number.isFinite(n) ? n : null; };

/** extractedData.items → OcrInvoiceItem rows (same shape the upload route writes). */
export function itemsToRows(items: unknown[]): ItemRow[] {
  return items.map((raw, i) => { const it = (raw ?? {}) as Record<string, unknown>; return { rowIndex: i, code: it.code == null ? null : String(it.code), name: String(it.name ?? ''), quantity: num(it.quantity), price: num(it.price), discount: num(it.discount), vatRate: num(it.vatRate), total: num(it.total) }; });
}

export type ReviewFlags = RunFlags & { templateSlug: string; templateName: string; runStatus: string; runId: string };
export function buildReviewFlags(t: { slug: string; name: string }, status: string, runId: string, flags: RunFlags): ReviewFlags {
  return { review: flags.review, blocked: flags.blocked, templateSlug: t.slug, templateName: t.name, runStatus: status, runId };
}
