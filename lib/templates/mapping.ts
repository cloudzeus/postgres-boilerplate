// lib/templates/mapping.ts — PURE projections of extracted values onto outputs.
import { invoiceKeyInfo, type FieldValue, type MappingRowExcel, type MappingRowInvoice } from './schema';

type Json = Record<string, unknown>;

/**
 * Merge mapped values into a copy of `existing` (OcrDocument.extractedData).
 * - header keys → top-level
 * - customFields.<k> → extractedData.customFields[k]
 * - items.<col> mapped from a TABLE field `<tableKey>.<colKey>` → rebuilds items[] from the table rows
 *   (when at least one line mapping is present); otherwise items are left untouched.
 *
 * @remarks The result is a *shallow* copy of `existing`: nested objects and arrays that were not
 * rewritten (e.g. an untouched `items[]`) are shared with the input. Treat the return value as
 * read-only rather than mutating it in place.
 */
export function projectToInvoice(
  values: Record<string, FieldValue>,
  rows: MappingRowInvoice[],
  existing: Json = {},
): Json {
  const out: Json = { ...existing };
  const prev = existing.customFields;
  const custom: Json = prev && typeof prev === 'object' && !Array.isArray(prev) ? { ...(prev as Json) } : {};
  let customTouched = false;
  const lineMaps: { tableKey: string; colKey: string; itemKey: string }[] = [];

  for (const r of rows) {
    const info = invoiceKeyInfo(r.invoiceKey);
    if (!info) continue;
    if (info.isLine) {
      const dot = r.fieldKey.indexOf('.');
      if (dot <= 0) continue;
      lineMaps.push({ tableKey: r.fieldKey.slice(0, dot), colKey: r.fieldKey.slice(dot + 1), itemKey: r.invoiceKey.slice('items.'.length) });
      continue;
    }
    const v = values[r.fieldKey]?.value;
    if (v == null) continue;
    if (r.invoiceKey.startsWith('customFields.')) { custom[r.invoiceKey.slice('customFields.'.length)] = v; customTouched = true; }
    else out[r.invoiceKey] = v;
  }
  if (customTouched) out.customFields = custom;

  if (lineMaps.length) {
    // Line rows from a second table are dropped; the mappings endpoint rejects such mappings (plan Task 11).
    const tableKey = lineMaps[0].tableKey;
    const tableRows = values[tableKey]?.value;
    if (Array.isArray(tableRows)) {
      out.items = (tableRows as Json[]).map((row) => {
        const item: Json = {};
        for (const m of lineMaps) if (m.tableKey === tableKey && row[m.colKey] != null) item[m.itemKey] = row[m.colKey];
        return item;
      });
    }
  }
  return out;
}

/** One Excel row for a document: ordered column headers + cell values. */
export function projectToExcel(
  values: Record<string, FieldValue>,
  rows: MappingRowExcel[],
): { columns: string[]; row: (string | number)[] } {
  const ordered = [...rows].sort((a, b) => a.order - b.order);
  const columns = ordered.map((r) => r.column);
  const row = ordered.map((r) => {
    const v = values[r.fieldKey]?.value;
    if (v == null) return '';
    if (typeof v === 'number') return v;
    if (Array.isArray(v)) {
      // TABLE rows do not belong in a single cell — they are exported to their own sheet.
      if (v.length && typeof v[0] === 'object' && v[0] !== null) return '';
      return v.map((x) => String(x)).join(', ');
    }
    return String(v);
  });
  return { columns, row };
}
