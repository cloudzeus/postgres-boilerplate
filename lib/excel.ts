import ExcelJS from 'exceljs';
import { prisma } from '@/lib/db';

export async function parseExcelSheet(buffer: ArrayBuffer, userId: string) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(buffer));
  const worksheet = workbook.worksheets[0];

  const rows = [] as Record<string, string | number | null>[];
  const headerRow = worksheet.getRow(1);
  const headers = headerRow.values.slice(1).map((value) => String(value ?? '').trim());

  worksheet.eachRow((row, index) => {
    if (index === 1) return;
    const record: Record<string, string | number | null> = {};
    row.values.slice(1).forEach((value, colIndex) => {
      record[headers[colIndex]] = value ?? null;
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
