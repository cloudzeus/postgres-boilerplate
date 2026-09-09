// GET ?runId= → Excel of one document's template run (latest when no runId). Spec §3δ / §15.6.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { EXPORT_INCLUDE, runsToSheets, sheetsToXlsx, xlsxResponse } from '@/lib/templates/excel-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.read');
  const { id } = await params;
  const runId = new URL(req.url).searchParams.get('runId');

  const run = await prisma.templateRun.findFirst({
    where: { documentId: id, ...(runId ? { id: runId } : {}) },
    orderBy: { createdAt: 'desc' },
    include: EXPORT_INCLUDE,
  });
  if (!run) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const buffer = await sheetsToXlsx(runsToSheets([run]));
  return xlsxResponse(buffer, `${run.template.slug}-${id.slice(0, 8)}.xlsx`);
}
