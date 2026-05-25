import { NextRequest, NextResponse } from 'next/server';
import { parseExcelSheet } from '@/lib/excel';

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get('file');

  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'Missing file upload' }, { status: 400 });
  }

  const buffer = await file.arrayBuffer();
  const userId = 'anonymous';
  const rows = await parseExcelSheet(buffer, userId);

  return NextResponse.json({ success: true, rows: rows.slice(0, 10), count: rows.length });
}
