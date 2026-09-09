// GET ?runId= → Excel of one document's template run (latest when no runId). Spec §3δ / §15.6.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { EXPORT_INCLUDE, runsToSheets, sheetsToXlsx, xlsxResponse } from '@/lib/templates/excel-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Building the workbook is CPU work on top of the query; a large lines table can outrun the 60s default.
export const maxDuration = 120;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.read');
  const { id } = await params;
  const runId = new URL(req.url).searchParams.get('runId');

  const run = await prisma.templateRun.findFirst({
    // A FAILED run stored no values, so it would export as an empty row and hide the last good run.
    // An explicit `runId` still wins: the caller asked for that exact run, failure included.
    where: { documentId: id, ...(runId ? { id: runId } : { status: { not: 'FAILED' } }) },
    // The `id` tie-break makes "the latest" deterministic when two runs share a createdAt.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: EXPORT_INCLUDE,
  });
  if (!run) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return xlsxResponse(await sheetsToXlsx(runsToSheets([run])), `${run.template.slug}-${id.slice(0, 8)}.xlsx`);
}
