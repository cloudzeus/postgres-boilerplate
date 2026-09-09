// lib/templates/excel.ts — PURE. Template runs → Excel sheets (spec §3δ, §15.6). No exceljs here.
import { projectToExcel } from './mapping';
import type { FieldValue, MappingRowExcel, TemplateFieldKind } from './schema';

/** Only `.value` is read, so a run's stored FieldValue fits without a cast at the call site. */
export type CellValues = Record<string, { value: unknown }>;
export type SheetField = { key: string; label: string; kind: TemplateFieldKind; columns: { key: string; label: string }[] | null };

export type SheetInput = {
  templateSlug: string;
  templateName: string;
  file: string;
  documentId: string;
  fields: SheetField[];
  /** Rows of the template's EXCEL mapping, or null when it has none (→ one column per SINGLE field). */
  excelRows: MappingRowExcel[] | null;
  values: CellValues;
};

export type Sheet = { name: string; columns: string[]; rows: (string | number)[][] };

const FILE_COL = 'Αρχείο';
const FIELD_COL = 'Πεδίο';
const LINES_SUFFIX = ' — Γραμμές';
const MAX_NAME = 31; // Excel's hard limit on worksheet names.

/** Excel-safe, unique worksheet name. Mutates `used` so the next call sees this one. */
export function sheetName(raw: string, used: Set<string>): string {
  const base =
    raw
      .replace(/[[\]:*?/\\]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .trim()
      .slice(0, MAX_NAME)
      .trim() || 'Φύλλο';
  let name = base;
  for (let n = 2; used.has(name); n += 1) {
    const suffix = `_${n}`;
    name = base.slice(0, MAX_NAME - suffix.length) + suffix;
  }
  used.add(name);
  return name;
}

/** One cell of the main sheet when there is no EXCEL mapping: numbers stay numbers, table rows do not belong here. */
function cell(v: unknown): string | number {
  if (v == null) return '';
  if (typeof v === 'number') return v;
  if (Array.isArray(v)) {
    if (v.length && typeof v[0] === 'object' && v[0] !== null) return ''; // TABLE rows → the lines sheet
    return v.map((x) => String(x)).join(', ');
  }
  if (typeof v === 'object') return '';
  return String(v);
}

type TableRow = { field: SheetField; file: string; row: Record<string, unknown> };

function tableRowsOf(input: SheetInput): TableRow[] {
  const out: TableRow[] = [];
  for (const f of input.fields) {
    if (f.kind !== 'TABLE') continue;
    const v = input.values[f.key]?.value;
    if (!Array.isArray(v)) continue;
    for (const r of v) {
      if (r && typeof r === 'object' && !Array.isArray(r)) out.push({ field: f, file: input.file, row: r as Record<string, unknown> });
    }
  }
  return out;
}

/**
 * One main sheet per template (a row per document), plus a «Γραμμές» sheet when any document
 * of that template produced TABLE rows. Groups keep the order in which their template first appears.
 */
export function buildSheets(inputs: SheetInput[]): Sheet[] {
  const groups = new Map<string, SheetInput[]>();
  for (const i of inputs) {
    const g = groups.get(i.templateSlug);
    if (g) g.push(i);
    else groups.set(i.templateSlug, [i]);
  }

  const used = new Set<string>();
  const sheets: Sheet[] = [];

  for (const group of groups.values()) {
    // The template is the same for every document of the group, so the first one defines the columns.
    const head = group[0];
    const excelRows = head.excelRows;
    const singles = head.fields.filter((f) => f.kind === 'SINGLE');
    const columns = excelRows
      ? [...excelRows].sort((a, b) => a.order - b.order).map((r) => r.column)
      : singles.map((f) => f.label);

    const rows = group.map((i) =>
      excelRows
        // projectToExcel only reads `.value`; the cast keeps SheetInput usable with any FieldValue-shaped map.
        ? [i.file, ...projectToExcel(i.values as Record<string, FieldValue>, excelRows).row]
        : [i.file, ...singles.map((f) => cell(i.values[f.key]?.value))],
    );
    const name = sheetName(head.templateName, used);
    sheets.push({ name, columns: [FILE_COL, ...columns], rows });

    // Lines sheet — only the TABLE fields that actually produced rows contribute columns.
    const lineRows = group.flatMap(tableRowsOf);
    if (lineRows.length === 0) continue;
    const cols: { key: string; label: string }[] = [];
    for (const { field } of lineRows) {
      for (const c of field.columns ?? []) if (!cols.some((x) => x.key === c.key)) cols.push(c);
    }
    sheets.push({
      name: sheetName(name + LINES_SUFFIX, used),
      columns: [FILE_COL, FIELD_COL, ...cols.map((c) => c.label)],
      rows: lineRows.map(({ field, file, row }) => [file, field.label, ...cols.map((c) => cell(row[c.key]))]),
    });
  }

  return sheets;
}
