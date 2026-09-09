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
export const maxDuration = 120;

// `takenKeys` = keys of proposals the designer holds but has not saved yet; without them a second
// detection can hand back a key the unsaved first one already uses.
const Body = z.object({ region: RegionSchema, takenKeys: z.array(z.string().max(60)).max(100).default([]) });

/** What the browser is told when the model fails, whatever the underlying cause. */
const VISION_FAILED = 'Η ανάγνωση από το μοντέλο απέτυχε';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.categorize');
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  const { region, takenKeys } = parsed.data;

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
    const taken = new Set([...t.fields.map((f) => f.key), ...takenKeys]);
    const r = await detectFieldFromCrop(pageBuf, region.bbox, { taken, fallbackLabel: `Πεδίο ${taken.size + 1}`, ref: { refType: 'ExtractionTemplate', refId: id } });
    // The detail (model name, provider error, stack) goes to the server log only — the browser
    // gets one fixed sentence so a model/provider message never reaches the user.
    if (!r.field) {
      console.error(`[detect-field] template ${id}: model ${r.model} returned no usable JSON`);
      return NextResponse.json({ error: 'read_failed', message: VISION_FAILED }, { status: 502 });
    }
    return NextResponse.json({ ...r.field, model: r.model, tokensUsed: r.tokensUsed ?? 0, durationMs: Date.now() - started });
  } catch (e) {
    console.error(`[detect-field] template ${id}:`, e);
    return NextResponse.json({ error: 'read_failed', message: VISION_FAILED }, { status: 502 });
  }
}
