import ExcelJS from 'exceljs';
import { prisma } from '@/lib/db';

export async function parseExcelSheet(buffer: ArrayBuffer, userId: string) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    Buffer.from(buffer) as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  const worksheet = workbook.worksheets[0];

  const rows = [] as Record<string, string | number | null>[];
  const headerRow = worksheet.getRow(1);
  // Row.values is `CellValue[] | { [k]: CellValue }`; normalize to an array.
  const headerValues = (headerRow.values as ExcelJS.CellValue[]) ?? [];
  const headers = headerValues.slice(1).map((value) => String(value ?? '').trim());

  worksheet.eachRow((row, index) => {
    if (index === 1) return;
    const record: Record<string, string | number | null> = {};
    const cellValues = (row.values as ExcelJS.CellValue[]) ?? [];
    cellValues.slice(1).forEach((value, colIndex) => {
      const v = value ?? null;
      record[headers[colIndex]] =
        v === null || typeof v === 'string' || typeof v === 'number' ? v : String(v);
    });
    rows.push(record);
  });

  await prisma.excelImport.create({
    data: {
      userId,
      fileName: 'uploaded.xlsx',
      status: 'PARSED',
      mappedFields: { headers },
    },
  });

  return rows;
}
