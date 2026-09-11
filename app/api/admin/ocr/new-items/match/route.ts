import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { applyMatchToGroup, QueueError } from '@/lib/ocr/queues';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  afm: z.string().trim().max(20).default(''),
  pattern: z.string().trim().min(1).max(200),
  target: z.union([
    z.object({ mtrl: z.number().int().positive() }),
    z.object({ expn: z.number().int().positive() }),
  ]),
  isService: z.boolean().optional(),
});

// POST — αντιστοιχίζει ΟΛΕΣ τις γραμμές μιας ομάδας σε είδος (MTRL) ή έξοδο (EXPN)
// και γράφει τη μνήμη (`LineMatchRule`) για τις επόμενες σαρώσεις (spec §3).
export async function POST(req: Request) {
  const u = await requirePermission('ocr.categorize');
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  }
  const b = parsed.data;

  try {
    const r = await applyMatchToGroup({
      afm: b.afm, pattern: b.pattern, target: b.target, isService: b.isService, userId: u.id,
    });
    await logAudit({
      userId: u.id, userEmail: u.email,
      action: 'ocr.line.match', resource: 'ocr_line_group', resourceId: `${b.afm}|${b.pattern}`,
      metadata: { mtrl: r.mtrl, expn: r.expn, code: r.code, name: r.name, linesUpdated: r.linesUpdated },
    }).catch(() => null);
    return NextResponse.json({ ok: true, linesUpdated: r.linesUpdated, mtrl: r.mtrl, expn: r.expn, code: r.code, name: r.name });
  } catch (e) {
    if (e instanceof QueueError) {
      return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
    }
    throw e;
  }
}
