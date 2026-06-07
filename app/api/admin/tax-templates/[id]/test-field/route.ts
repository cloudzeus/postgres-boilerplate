import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyDownload } from '@/lib/bunny';
import { isPdfBuffer, cropRegionToImage } from '@/lib/ocr/rasterize';
import { extractTaxForm } from '@/lib/ocr/tax-extract';
import { coerceFinancialValue, type FinancialValueTypeStr } from '@/lib/greek-format';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  label: z.string().min(1),
  valueType: z.enum(['CURRENCY', 'NUMBER', 'PERCENT', 'INTEGER', 'DATE', 'BOOLEAN']),
  kind: z.enum(['SINGLE', 'SERIES']).optional(),
  aiHint: z.string().nullable().optional(),
  regionHint: z.object({
    page: z.number().int().min(0),
    bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  }),
});

// POST /api/admin/tax-templates/[id]/test-field — OCR a single field's region on the sample
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
  const key = 'test';
  const vt = body.valueType as FinancialValueTypeStr;
  const kind = body.kind ?? 'SINGLE';

  try {
    // Crop to the marked region so the model reads ONLY this cell/row.
    const crop = await cropRegionToImage(buf, mime, body.regionHint);
    const result = await extractTaxForm(crop, 'image/png', [{
      fieldKey: key, label: body.label, aiHint: body.aiHint ?? null,
      regionHint: undefined, valueType: vt, kind,
    }]);
    if (kind === 'SERIES') {
      const series = (result.series[key] ?? []).map((p) => ({ year: p.year, raw: p.value, value: coerceFinancialValue(p.value, vt) }));
      return NextResponse.json({ kind: 'SERIES', series, model: result.model });
    }
    const raw = result.values[key] ?? null;
    return NextResponse.json({ kind: 'SINGLE', raw, value: coerceFinancialValue(raw, vt), model: result.model });
  } catch (err: any) {
    console.error('[tax test-field] extract failed', { key: template.sampleStorageKey, message: err?.message });
    return NextResponse.json({ error: `scan failed: ${err?.message ?? err}` }, { status: 502 });
  }
}
