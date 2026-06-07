import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyDownload } from '@/lib/bunny';
import { isPdfBuffer } from '@/lib/ocr/rasterize';
import { scanTable } from '@/lib/ocr/tax-extract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  regionHint: z.object({
    page: z.number().int().min(0),
    bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  }),
});

// POST /api/admin/tax-templates/[id]/scan-table — OCR a marked table region into columns + rows
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.create');
  const { id } = await params;
  const body = BodySchema.parse(await req.json());

  const template = await prisma.taxFormTemplate.findUnique({ where: { id } });
  if (!template) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (!template.sampleStorageKey) return NextResponse.json({ error: 'no sample uploaded' }, { status: 404 });

  let buf: Buffer;
  try {
    const dl = await bunnyDownload(template.sampleStorageKey);
    buf = Buffer.isBuffer(dl) ? dl : Buffer.from(dl as ArrayBuffer);
  } catch (err: any) {
    return NextResponse.json({ error: `file unavailable: ${err?.message ?? err}` }, { status: 502 });
  }

  const mime = isPdfBuffer(buf) || template.sampleStorageKey.endsWith('.pdf') ? 'application/pdf' : 'image/png';

  try {
    const result = await scanTable(buf, mime, body.regionHint);
    return NextResponse.json({ name: result.name, columns: result.columns, rows: result.rows, headers: result.headers, grid: result.grid, model: result.model });
  } catch (err: any) {
    console.error('[tax scan-table] failed', { key: template.sampleStorageKey, message: err?.message });
    return NextResponse.json({ error: `scan failed: ${err?.message ?? err}` }, { status: 502 });
  }
}
