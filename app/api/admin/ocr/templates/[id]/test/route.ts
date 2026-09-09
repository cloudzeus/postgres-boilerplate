// POST {} → JSON output of the template applied to its own sample (spec §14.1-5).
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyDownload } from '@/lib/bunny';
import { extractTemplateFields } from '@/lib/templates/extract';
import { toOutputJson } from '@/lib/templates/output';
import { toFieldDef } from '@/lib/templates/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.categorize');
  const { id } = await params;
  const t = await prisma.extractionTemplate.findUnique({ where: { id }, include: { fields: true } });
  if (!t) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!t.sampleStorageKey) return NextResponse.json({ error: 'no_sample', message: 'Ανέβασε πρώτα δείγμα' }, { status: 422 });
  const fields = [...t.fields].sort((a, b) => a.order - b.order).map(toFieldDef).filter((f) => f.region);
  if (fields.length === 0) return NextResponse.json({ error: 'no_fields', message: 'Δεν υπάρχουν αποθηκευμένα πεδία με περιοχή' }, { status: 422 });

  let buf: Buffer;
  try { buf = await bunnyDownload(t.sampleStorageKey); }
  catch { return NextResponse.json({ error: 'file unavailable' }, { status: 502 }); }

  const started = Date.now();
  const r = await extractTemplateFields(buf, t.sampleMimeType ?? 'application/pdf', fields, { ref: { refType: 'ExtractionTemplate', refId: id } });
  const json = toOutputJson({ slug: t.slug, version: t.version }, r.values);
  return NextResponse.json({ ...json, fields: r.values, model: r.model, tokensUsed: r.tokensUsed, durationMs: Date.now() - started, errors: r.errors });
}
