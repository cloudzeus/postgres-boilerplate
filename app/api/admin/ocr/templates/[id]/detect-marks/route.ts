// POST { page, mode } → proposed fields from the whole page (spec §14.3, §14.8 «Αυτόματη σάρωση»).
// mode 'all' (default) = every labelled value; mode 'marks' = only what the accountant circled/wrote.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyDownload } from '@/lib/bunny';
import { renderPage } from '@/lib/ocr/rasterize';
import { detectMarksOnPage } from '@/lib/templates/detect';
import { COLOR_PALETTE } from '@/lib/templates/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// `takenKeys` = keys of proposals the designer holds but has not saved yet (see detect-field).
// `max` = free colour slots as the DESIGNER sees them (saved fields plus unsaved proposals). The
// server only knows the saved ones, so it would over-cap the batch and pay for output it then slices off.
const Body = z.object({ page: z.number().int().min(0), mode: z.enum(['marks', 'all']).default('all'), takenKeys: z.array(z.string().max(60)).max(100).default([]), max: z.number().int().min(0).max(20).optional() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.categorize');
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  const { page, mode, takenKeys, max: clientMax } = parsed.data;

  const t = await prisma.extractionTemplate.findUnique({ where: { id }, include: { fields: { select: { key: true } } } });
  if (!t) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!t.sampleStorageKey) return NextResponse.json({ error: 'no_sample', message: 'Ανέβασε πρώτα δείγμα' }, { status: 422 });
  if (page >= (t.samplePageCount ?? 1)) return NextResponse.json({ error: 'bad_page' }, { status: 422 });
  // Every field needs its own highlight colour; proposing more than the palette can carry is wasted spend.
  const serverMax = Math.max(0, COLOR_PALETTE.length - t.fields.length);
  const max = clientMax == null ? serverMax : Math.min(clientMax, serverMax);
  if (max === 0) return NextResponse.json({ error: 'color_cap', message: 'Μέγιστο 12 πεδία ανά πρότυπο' }, { status: 422 });

  let buf: Buffer;
  try { buf = await bunnyDownload(t.sampleStorageKey); }
  catch { return NextResponse.json({ error: 'file unavailable' }, { status: 502 }); }

  const started = Date.now();
  try {
    // Scale 3 (~1785px for A4) so detectMarksOnPage's 1600px cap actually bites — at scale 2 an A4
    // page renders ~1191px wide and small handwriting reaches the model softer than it needs to be.
    const pageBuf = await renderPage(buf, t.sampleMimeType ?? 'application/pdf', page, 3);
    const r = await detectMarksOnPage(pageBuf, { taken: new Set([...t.fields.map((f) => f.key), ...takenKeys]), mode, max, ref: { refType: 'ExtractionTemplate', refId: id } });
    if (!r.marks) return NextResponse.json({ error: 'read_failed', message: 'Το μοντέλο δεν επέστρεψε έγκυρη απάντηση' }, { status: 502 });
    return NextResponse.json({ marks: r.marks, model: r.model, tokensUsed: r.tokensUsed ?? 0, durationMs: Date.now() - started });
  } catch (e) {
    return NextResponse.json({ error: 'read_failed', message: (e as Error).message }, { status: 502 });
  }
}
