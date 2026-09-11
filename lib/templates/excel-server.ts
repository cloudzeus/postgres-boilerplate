// lib/templates/excel-server.ts — SERVER. Prisma rows → SheetInput, and sheets → an .xlsx buffer (exceljs).
import 'server-only';
import ExcelJS from 'exceljs';
import type { ExtractionTemplate, TemplateField, TemplateMapping, TemplateRun } from '@prisma/client';
import { docTypeOf, fromLegacy, normalizeDocument, type DocumentJson } from '@/lib/ocr/canonical';
import { buildSheets, type Sheet, type SheetInput } from './excel';
import { asEnvelope } from './output';
import { toFieldDef, toMappingDto } from './serialize';
import type { FieldValue, MappingRowExcel } from './schema';

const isObj = (v: unknown): v is Record<string, unknown> => v != null && typeof v === 'object' && !Array.isArray(v);

/** The document columns the exporter needs to build a canonical document without a second query. */
export const DOCUMENT_EXPORT_SELECT = {
  id: true, fileName: true, document: true, extractedData: true, docType: true,
  items: {
    orderBy: { rowIndex: 'asc' },
    select: { code: true, name: true, quantity: true, price: true, discount: true, vatRate: true, total: true },
  },
} as const;

/**
 * Everything `runsToSheetInputs` needs from Prisma. `TemplateMapping` has no `createdAt` column, so
 * mappings are ordered by `id` — a cuid, which is time-prefixed, so this is insertion order in
 * practice and, above all, stable between requests (the column set of an export must not shuffle).
 */
export const EXPORT_INCLUDE = {
  template: { include: { fields: true, mappings: { orderBy: { id: 'asc' } } } },
  document: { select: DOCUMENT_EXPORT_SELECT },
} as const;

/** One `OcrDocument` as the exporter reads it (`DOCUMENT_EXPORT_SELECT`). */
export type DocumentForExport = {
  id: string;
  fileName: string;
  document: unknown;
  extractedData: unknown;
  docType: unknown;
  items: { code: string | null; name: string | null; quantity: unknown; price: unknown; discount: unknown; vatRate: unknown; total: unknown }[];
};

export type RunForExport = TemplateRun & {
  template: ExtractionTemplate & { fields: TemplateField[]; mappings: TemplateMapping[] };
  document: DocumentForExport;
};

/** The slug/name under which documents with no template run are exported. */
export const PLAIN_DOCUMENT_SLUG = '_document';
export const PLAIN_DOCUMENT_NAME = 'Έγγραφα';

/**
 * The canonical document of a row. `OcrDocument.document` is the truth; a row written before the
 * canonical column existed is bridged from its flat `extractedData` + item rows, exactly as
 * `loadDocumentJson` would — without a second round trip per document in a folder-sized export.
 */
export function documentOf(d: DocumentForExport): DocumentJson {
  if (isObj(d.document)) return normalizeDocument(d.document);
  return fromLegacy(isObj(d.extractedData) ? d.extractedData : {}, d.items, docTypeOf(d.docType));
}

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
    // The envelope the run FROZE is what that run produced; the document may have moved on since
    // (a later run of another template, a manual correction), and an export of a run must show the
    // run. Only a run written before the envelope existed falls back to the live document.
    document: asEnvelope(r.output)?.document ?? documentOf(r.document),
  }));
}

/**
 * Documents with no template run at all. They still have a canonical document, so they still export —
 * into one «Έγγραφα» sheet with the document columns and nothing template-specific.
 */
export function documentsToSheetInputs(docs: DocumentForExport[]): SheetInput[] {
  return docs.map((d) => ({
    templateSlug: PLAIN_DOCUMENT_SLUG,
    templateName: PLAIN_DOCUMENT_NAME,
    file: d.fileName,
    fields: [],
    excelRows: null,
    values: {},
    document: documentOf(d),
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

/** Convenience for the routes: runs (and any template-less documents) → the finished workbook. */
export function runsToSheets(runs: RunForExport[], docs: DocumentForExport[] = []): Sheet[] {
  return buildSheets([...runsToSheetInputs(runs), ...documentsToSheetInputs(docs)]);
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
