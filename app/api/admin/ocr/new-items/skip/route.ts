import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { skipGroup, QueueError } from '@/lib/ocr/queues';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  afm: z.string().trim().max(20).default(''),
  pattern: z.string().trim().min(1).max(200),
});

// POST — «Παράλειψη»: οι γραμμές της ομάδας βγαίνουν από την ουρά
// (`softoneMatchedBy: 'skipped'`), χωρίς κανόνα μνήμης (spec 2026-09-11 §3).
export async function POST(req: Request) {
  const u = await requirePermission('ocr.categorize');
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  }
  const b = parsed.data;

  try {
    const r = await skipGroup({ afm: b.afm, pattern: b.pattern });
    await logAudit({
      userId: u.id, userEmail: u.email,
      action: 'ocr.line.skip', resource: 'ocr_line_group', resourceId: `${b.afm}|${b.pattern}`,
      metadata: { linesUpdated: r.linesUpdated },
    }).catch(() => null);
    return NextResponse.json({ ok: true, linesUpdated: r.linesUpdated });
  } catch (e) {
    if (e instanceof QueueError) {
      return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
    }
    throw e;
  }
}
