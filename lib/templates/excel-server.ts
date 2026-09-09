// lib/templates/excel-server.ts — SERVER. Prisma runs → SheetInput, and sheets → an .xlsx buffer (exceljs).
import 'server-only';
import ExcelJS from 'exceljs';
import type { ExtractionTemplate, TemplateField, TemplateMapping, TemplateRun } from '@prisma/client';
import { buildSheets, type Sheet, type SheetInput } from './excel';
import { toFieldDef, toMappingDto } from './serialize';
import type { FieldValue, MappingRowExcel } from './schema';

/**
 * Everything `runsToSheetInputs` needs from Prisma. `TemplateMapping` has no `createdAt` column, so
 * mappings are ordered by `id` — a cuid, which is time-prefixed, so this is insertion order in
 * practice and, above all, stable between requests (the column set of an export must not shuffle).
 */
export const EXPORT_INCLUDE = {
  template: { include: { fields: true, mappings: { orderBy: { id: 'asc' } } } },
  document: { select: { id: true, fileName: true } },
} as const;

export type RunForExport = TemplateRun & {
  template: ExtractionTemplate & { fields: TemplateField[]; mappings: TemplateMapping[] };
  document: { id: string; fileName: string };
};

/** The EXCEL mapping that drives the columns: the default one, else the first, else none (a column per SINGLE field). */
function excelRowsOf(mappings: TemplateMapping[]): MappingRowExcel[] | null {
  const excel = mappings.map(toMappingDto).filter((m) => m.target === 'EXCEL');
  const picked = excel.find((m) => m.isDefault) ?? excel[0];
  if (!picked) return null;
  const rows = picked.rows as MappingRowExcel[];
  return rows.length ? rows : null;
}

export function runsToSheetInputs(runs: RunForExport[]): SheetInput[] {
  return runs.map((r) => ({
    templateSlug: r.template.slug,
    templateName: r.template.name,
    file: r.document.fileName,
    fields: [...r.template.fields].sort((a, b) => a.order - b.order).map(toFieldDef),
    excelRows: excelRowsOf(r.template.mappings),
    values: ((r.values as unknown as Record<string, FieldValue>) ?? {}) as SheetInput['values'],
  }));
}

/**
 * From runs ordered newest-first, keep one row per document — the latest run of each.
 * The caller must order by `[{ createdAt: 'desc' }, { id: 'desc' }]`: two runs of the same document
 * can share a `createdAt` (they are written within the same millisecond on a fast re-run), and the
 * `id` tie-break is what makes "the latest" the same run on every request.
 */
export function latestPerDocument<T extends { documentId: string }>(runs: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of runs) if (!seen.has(r.documentId)) { seen.add(r.documentId); out.push(r); }
  return out;
}

/** Convenience for the routes: runs → the finished workbook. */
export function runsToSheets(runs: RunForExport[]): Sheet[] {
  return buildSheets(runsToSheetInputs(runs));
}

export async function sheetsToXlsx(sheets: Sheet[]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DGEspa ERP';
  wb.created = new Date();

  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    ws.columns = s.columns.map((header, i) => {
      const longest = Math.max(header.length, ...s.rows.map((r) => String(r[i] ?? '').length));
      return { header, width: Math.max(10, Math.min(60, longest + 2)) };
    });
    for (const row of s.rows) ws.addRow(row);
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.getRow(1).eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0078D4' } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { vertical: 'middle' };
    });
  }
  // An empty workbook is not a valid file — the routes 404 before getting here, but be safe.
  if (wb.worksheets.length === 0) wb.addWorksheet('Κενό');

  // exceljs hands back an ArrayBuffer; `Response` takes one as a body directly, so an export of a
  // few hundred rows is never copied through a Buffer and then a Uint8Array on the way out.
  return wb.xlsx.writeBuffer();
}

export function xlsxResponse(body: ArrayBuffer, filename: string): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
