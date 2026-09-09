// GET → Excel of a whole folder: the latest template run of every document in the batch. Spec §15.6.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { EXPORT_INCLUDE, latestPerDocument, runsToSheets, sheetsToXlsx, xlsxResponse } from '@/lib/templates/excel-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.read');
  const { id } = await params;

  const runs = await prisma.templateRun.findMany({
    where: { document: { batchId: id } },
    orderBy: { createdAt: 'desc' },
    include: EXPORT_INCLUDE,
  });
  const latest = latestPerDocument(runs);
  if (latest.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const buffer = await sheetsToXlsx(runsToSheets(latest));
  return xlsxResponse(buffer, `templates-${id.slice(0, 8)}.xlsx`);
}
