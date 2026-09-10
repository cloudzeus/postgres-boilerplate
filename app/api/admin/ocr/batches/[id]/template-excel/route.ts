// GET → Excel of a whole folder: the latest template run of every document in the batch. Spec §15.6.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { EXPORT_INCLUDE, latestPerDocument, runsToSheets, sheetsToXlsx, xlsxResponse } from '@/lib/templates/excel-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A folder-sized workbook is built in memory from every run of the batch — well past the 60s default.
export const maxDuration = 120;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.read');
  const { id } = await params;

  const runs = await prisma.templateRun.findMany({
    // A FAILED run stored no values: exporting it would emit an empty row for that document and
    // hide the last run that actually read something.
    where: { document: { batchId: id }, status: { not: 'FAILED' } },
    // One row per document, newest first; the `id` tie-break keeps the pick deterministic when two
    // runs of the same document share a createdAt.
    distinct: ['documentId'],
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    // A folder is built entirely in memory: an unbounded read of a pathological batch would take the
    // process down instead of producing a file. 2000 documents is far past any real folder.
    take: 2000,
    include: EXPORT_INCLUDE,
  });
  const latest = latestPerDocument(runs);
  if (latest.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return xlsxResponse(await sheetsToXlsx(runsToSheets(latest)), `templates-${id.slice(0, 8)}.xlsx`);
}
