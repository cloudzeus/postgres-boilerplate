// GET ?download=1 → array of OutputJson, one per document of the folder (latest run each). Spec §14.8 / §15.6.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { toRunOutput } from '@/lib/templates/output';
import { latestPerDocument } from '@/lib/templates/excel-server';
import type { FieldValue } from '@/lib/templates/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.read');
  const { id } = await params;

  const runs = await prisma.templateRun.findMany({
    where: { document: { batchId: id } },
    orderBy: { createdAt: 'desc' },
    include: {
      template: { select: { slug: true } },
      document: { select: { id: true, fileName: true, extractedData: true } },
    },
  });
  const latest = latestPerDocument(runs);
  if (latest.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const out = latest.map((r) =>
    toRunOutput({
      slug: r.template.slug,
      version: r.templateVersion,
      file: r.document.fileName,
      documentId: r.document.id,
      createdAt: r.createdAt,
      extractedData: (r.document.extractedData as Record<string, unknown> | null) ?? null,
      values: (r.values as unknown as Record<string, FieldValue>) ?? {},
    }),
  );

  const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (new URL(req.url).searchParams.get('download') === '1') {
    headers['Content-Disposition'] = `attachment; filename="templates-${id.slice(0, 8)}.json"`;
  }
  return new Response(JSON.stringify(out, null, 2), { headers });
}
