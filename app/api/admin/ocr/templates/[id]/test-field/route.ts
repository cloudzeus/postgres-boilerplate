// app/api/admin/ocr/templates/[id]/test-field/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyDownload } from '@/lib/bunny';
import { extractTemplateFields } from '@/lib/templates/extract';
import { toFieldDef } from '@/lib/templates/serialize';
import { RegionSchema } from '@/lib/templates/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  fieldKey: z.string().min(1),
  /** Optional unsaved region from the designer, so the user can test before saving. */
  region: RegionSchema.optional(),
});

// POST { fieldKey, region? } → { raw, value, source, model, tokensUsed, color, durationMs }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.categorize');
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });

  const t = await prisma.extractionTemplate.findUnique({ where: { id }, include: { fields: true } });
  if (!t) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!t.sampleStorageKey) return NextResponse.json({ error: 'no_sample', message: 'Ανέβασε πρώτα δείγμα' }, { status: 422 });
  const row = t.fields.find((f) => f.key === parsed.data.fieldKey);
  if (!row) return NextResponse.json({ error: 'unknown_field' }, { status: 404 });

  const field = toFieldDef(row);
  if (parsed.data.region) field.region = parsed.data.region;
  if (!field.region) return NextResponse.json({ error: 'no_region', message: 'Το πεδίο δεν έχει περιοχή' }, { status: 422 });

  let buf: Buffer;
  try { buf = await bunnyDownload(t.sampleStorageKey); }
  catch { return NextResponse.json({ error: 'file unavailable' }, { status: 502 }); }

  const started = Date.now();
  const r = await extractTemplateFields(buf, t.sampleMimeType ?? 'application/pdf', [field], { ref: { refType: 'ExtractionTemplate', refId: id } });
  const v = r.values[field.key];
  if (r.errors.length) return NextResponse.json({ error: 'read_failed', message: r.errors[0].message }, { status: 502 });
  return NextResponse.json({ raw: v.raw, value: v.value, source: v.source, model: r.model, tokensUsed: r.tokensUsed, color: v.color, durationMs: Date.now() - started });
}
