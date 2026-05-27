import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { requirePermission } from '@/lib/rbac';

const MAX_BYTES = 10 * 1024 * 1024;     // 10MB
const MAX_ROWS_PER_SHEET = 10_000;

type CellValue = string | number | boolean | null;
type SheetParse = {
  name: string;
  totalRows: number;
  totalCols: number;
  rows: CellValue[][];                  // up to MAX_ROWS_PER_SHEET
  truncated: boolean;
};

function normalizeCell(v: any): CellValue {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if ('text' in v && typeof v.text === 'string') return v.text;                                       // rich text
    if ('result' in v) return normalizeCell(v.result);                                                  // formula
    if ('hyperlink' in v) return v.text ?? v.hyperlink ?? null;
    if ('richText' in v && Array.isArray(v.richText)) return v.richText.map((r: any) => r.text).join('');
    if ('error' in v) return null;
  }
  return String(v);
}

export async function POST(request: Request) {
  await requirePermission('imports.create');
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'no_file' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'too_large' }, { status: 400 });

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(await file.arrayBuffer());
  } catch (e) {
    return NextResponse.json({ error: 'parse_failed', message: (e as Error).message }, { status: 400 });
  }

  const sheets: SheetParse[] = wb.worksheets.map((ws) => {
    const total = ws.rowCount;
    const limit = Math.min(total, MAX_ROWS_PER_SHEET);
    const rows: CellValue[][] = [];
    let maxCols = 0;
    for (let r = 1; r <= limit; r++) {
      const row = ws.getRow(r);
      // row.values is 1-indexed; slice off the first undefined cell
      const cells = (row.values as any[]).slice(1).map(normalizeCell);
      maxCols = Math.max(maxCols, cells.length);
      rows.push(cells);
    }
    // Normalize all rows to the same length
    const padded = rows.map((c) => {
      const out = c.slice(0, maxCols);
      while (out.length < maxCols) out.push(null);
      return out;
    });
    return { name: ws.name, totalRows: total, totalCols: maxCols, rows: padded, truncated: total > limit };
  });

  return NextResponse.json({ fileName: file.name, sheets });
}
