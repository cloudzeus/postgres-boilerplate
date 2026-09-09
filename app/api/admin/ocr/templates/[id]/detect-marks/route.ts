// POST { page, mode } → proposed fields from the whole page (spec §14.3, §14.8 «Αυτόματη σάρωση»).
// mode 'all' (default) = every labelled value; mode 'marks' = only what the accountant circled/wrote.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyDownload } from '@/lib/bunny';
import { renderPage } from '@/lib/ocr/rasterize';
import { detectMarksOnPage } from '@/lib/templates/detect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ page: z.number().int().min(0), mode: z.enum(['marks', 'all']).default('all') });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.categorize');
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  const { page, mode } = parsed.data;

  const t = await prisma.extractionTemplate.findUnique({ where: { id }, include: { fields: { select: { key: true } } } });
  if (!t) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!t.sampleStorageKey) return NextResponse.json({ error: 'no_sample', message: 'Ανέβασε πρώτα δείγμα' }, { status: 422 });
  if (page >= (t.samplePageCount ?? 1)) return NextResponse.json({ error: 'bad_page' }, { status: 422 });

  let buf: Buffer;
  try { buf = await bunnyDownload(t.sampleStorageKey); }
  catch { return NextResponse.json({ error: 'file unavailable' }, { status: 502 }); }

  const started = Date.now();
  try {
    // Scale 2 is enough for whole-page detection (detectMarksOnPage downscales to 1600px anyway).
    const pageBuf = await renderPage(buf, t.sampleMimeType ?? 'application/pdf', page, 2);
    const r = await detectMarksOnPage(pageBuf, { taken: t.fields.map((f) => f.key), mode, ref: { refType: 'ExtractionTemplate', refId: id } });
    return NextResponse.json({ marks: r.marks, model: r.model, tokensUsed: r.tokensUsed ?? 0, durationMs: Date.now() - started });
  } catch (e) {
    return NextResponse.json({ error: 'read_failed', message: (e as Error).message }, { status: 502 });
  }
}
