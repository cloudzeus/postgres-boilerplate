// GET → the run's output JSON (spec §14.8, `?download=1` for a file). PATCH { values } → manual corrections on the run.
import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { coerceValue } from '@/lib/templates/coerce';
import { toRunOutput } from '@/lib/templates/output';
import { RUN_INCLUDE, toRunDto } from '@/lib/templates/run-dto';
import { toFieldDef } from '@/lib/templates/serialize';
import type { FieldValue } from '@/lib/templates/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; runId: string }> };

const shortId = (id: string) => id.slice(0, 8);

export async function GET(req: Request, { params }: Ctx) {
  await requirePermission('ocr.read');
  const { id, runId } = await params;
  const run = await prisma.templateRun.findUnique({ where: { id: runId }, include: RUN_INCLUDE });
  if (!run || run.documentId !== id) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const doc = await prisma.ocrDocument.findUnique({ where: { id }, select: { fileName: true, extractedData: true } });
  if (!doc) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const json = toRunOutput({
    slug: run.template.slug,
    version: run.templateVersion,
    file: doc.fileName,
    documentId: id,
    createdAt: run.createdAt,
    extractedData: (doc.extractedData as Record<string, unknown> | null) ?? null,
    values: (run.values as unknown as Record<string, FieldValue>) ?? {},
  });

  const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (new URL(req.url).searchParams.get('download') === '1') {
    headers['Content-Disposition'] = `attachment; filename="${run.template.slug}-${shortId(id)}.json"`;
  }
  return new Response(JSON.stringify(json, null, 2), { headers });
}

const Body = z.object({ values: z.record(z.string(), z.unknown()) });

export async function PATCH(req: Request, { params }: Ctx) {
  const u = await requirePermission('ocr.categorize');
  const { id, runId } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });

  const run = await prisma.templateRun.findUnique({ where: { id: runId }, include: RUN_INCLUDE });
  if (!run || run.documentId !== id) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const fields = [...run.template.fields].sort((a, b) => a.order - b.order).map(toFieldDef);
  const values = { ...((run.values as unknown as Record<string, FieldValue>) ?? {}) };

  for (const [key, raw] of Object.entries(parsed.data.values)) {
    const prev = values[key];
    const field = fields.find((f) => f.key === key);
    // A key the run never produced and the template does not define cannot be corrected.
    if (!prev && !field) return NextResponse.json({ error: 'unknown_field', message: `Άγνωστο πεδίο «${key}»` }, { status: 400 });
    const text = String(raw ?? '');
    values[key] = {
      raw: text,
      value: coerceValue(text, field?.valueType ?? 'TEXT'),
      confidence: 1,
      source: 'manual',
      page: prev?.page ?? field?.region?.page ?? null,
      bbox: prev?.bbox ?? field?.region?.bbox ?? null,
      color: prev?.color ?? field?.color ?? '#000000',
    };
  }

  const updated = await prisma.templateRun.update({
    where: { id: runId },
    data: { values: values as unknown as Prisma.InputJsonValue },
    include: RUN_INCLUDE,
  });
  await logAudit({
    userId: u.id, userEmail: u.email, action: 'template.run.edit', resource: 'templateRun', resourceId: runId,
    metadata: { documentId: id, keys: Object.keys(parsed.data.values) },
  });
  return NextResponse.json(toRunDto(updated));
}
