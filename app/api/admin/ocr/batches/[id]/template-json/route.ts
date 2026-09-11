// GET ?download=1 → array of DocumentEnvelope, one per document of the folder (latest run each). Spec §17.1 / §15.6.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { asEnvelope, toRunOutput } from '@/lib/templates/output';
import { latestPerDocument } from '@/lib/templates/excel-server';
import { loadDocumentJson } from '@/lib/ocr/document';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A folder's worth of runs plus their documents' extractedData — well past the 60s default.
export const maxDuration = 120;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.read');
  const { id } = await params;

  const runs = await prisma.templateRun.findMany({
    // A FAILED run stored no values: exporting it would emit an empty document entry and hide the
    // last run that actually read something.
    where: { document: { batchId: id }, status: { not: 'FAILED' } },
    // One row per document, newest first; the `id` tie-break keeps the pick deterministic when two
    // runs of the same document share a createdAt.
    distinct: ['documentId'],
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    // A folder is built entirely in memory: an unbounded read of a pathological batch would take the
    // process down instead of producing a file. 2000 documents is far past any real folder.
    take: 2000,
    include: {
      template: { select: { slug: true } },
      document: { select: { id: true, fileName: true } },
    },
  });
  const latest = latestPerDocument(runs);
  if (latest.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Runs made before the canonical envelope existed stored no `output`: only those pay for a
  // document read, so a folder of new runs is still one query.
  const out = await Promise.all(
    latest.map(async (r) =>
      asEnvelope(r.output) ?? toRunOutput({
        slug: r.template.slug,
        file: r.document.fileName,
        documentId: r.document.id,
        createdAt: r.createdAt,
        document: await loadDocumentJson(r.document.id),
      }),
    ),
  );

  const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (new URL(req.url).searchParams.get('download') === '1') {
    headers['Content-Disposition'] = `attachment; filename="templates-${id.slice(0, 8)}.json"`;
  }
  return new Response(JSON.stringify(out, null, 2), { headers });
}
