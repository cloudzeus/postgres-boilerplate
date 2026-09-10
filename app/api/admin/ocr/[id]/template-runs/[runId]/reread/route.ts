// POST { fieldKey, region? } → re-read ONE field of the document (spec §16.4): rescan only the box
// that did not work out, optionally with a region the user just moved or resized on the canvas.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { rereadField, type RereadError } from '@/lib/templates/run';
import { toRunDto } from '@/lib/templates/run-dto';
import { RegionSchema } from '@/lib/templates/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// One vision call (plus a possible typed retry) — the default 60s ceiling is not enough.
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string; runId: string }> };

const Body = z.object({
  fieldKey: z.string().min(1),
  /** The box the user just drew on the canvas; without it the run's own region is re-used. */
  region: RegionSchema.optional(),
});

/** Greek text + status for each way a re-read can be refused. */
const FAILURE: Record<RereadError, { status: number; message: string }> = {
  not_found: { status: 404, message: 'Δεν βρέθηκε' },
  not_latest: { status: 409, message: 'Μόνο η τελευταία εκτέλεση μπορεί να διορθωθεί' },
  unknown_field: { status: 400, message: 'Άγνωστο πεδίο' },
  no_region: { status: 422, message: 'Το πεδίο δεν έχει περιοχή' },
  read_failed: { status: 502, message: 'Η ανάγνωση από το μοντέλο απέτυχε' },
};

export async function POST(req: Request, { params }: Ctx) {
  const u = await requirePermission('ocr.categorize');
  const { id, runId } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });

  const result = await rereadField({ documentId: id, runId, fieldKey: parsed.data.fieldKey, region: parsed.data.region });
  if (!result.ok) {
    const f = FAILURE[result.error];
    return NextResponse.json({ error: result.error, message: f.message }, { status: f.status });
  }

  await logAudit({
    userId: u.id, userEmail: u.email, action: 'template.run.reread', resource: 'templateRun', resourceId: runId,
    metadata: { documentId: id, fieldKey: parsed.data.fieldKey, overridden: result.overridden, model: result.model, tokensUsed: result.tokensUsed },
  });
  return NextResponse.json({ run: toRunDto(result.run), value: result.value });
}
