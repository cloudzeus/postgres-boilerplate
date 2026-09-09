// POST { region } → proposed field for that region of the sample (spec §14.3).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyDownload } from '@/lib/bunny';
import { renderPage } from '@/lib/ocr/rasterize';
import { detectFieldFromCrop } from '@/lib/templates/detect';
import { RegionSchema } from '@/lib/templates/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ region: RegionSchema });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.categorize');
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  const { region } = parsed.data;

  const t = await prisma.extractionTemplate.findUnique({ where: { id }, include: { fields: { select: { key: true } } } });
  if (!t) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!t.sampleStorageKey) return NextResponse.json({ error: 'no_sample', message: 'Ανέβασε πρώτα δείγμα' }, { status: 422 });
  if (region.page >= (t.samplePageCount ?? 1)) return NextResponse.json({ error: 'bad_page' }, { status: 422 });

  let buf: Buffer;
  try { buf = await bunnyDownload(t.sampleStorageKey); }
  catch { return NextResponse.json({ error: 'file unavailable' }, { status: 502 }); }

  const started = Date.now();
  try {
    const pageBuf = await renderPage(buf, t.sampleMimeType ?? 'application/pdf', region.page);
    const r = await detectFieldFromCrop(pageBuf, region.bbox, { taken: t.fields.map((f) => f.key), fallbackLabel: `Πεδίο ${t.fields.length + 1}`, ref: { refType: 'ExtractionTemplate', refId: id } });
    return NextResponse.json({ ...r.field, model: r.model, tokensUsed: r.tokensUsed ?? 0, durationMs: Date.now() - started });
  } catch (e) {
    return NextResponse.json({ error: 'read_failed', message: (e as Error).message }, { status: 502 });
  }
}
