import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { pullChangedItems, rematchUnmatchedLines } from '@/lib/softone-sync/items-rescan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ docId: z.string().min(1).max(64).optional() });

// POST { docId? } — ΕΠΑΝΕΛΕΓΧΟΣ ΕΙΔΩΝ ΣΤΟ SOFTONE κατά παραγγελία: φέρνει τα είδη που μπήκαν ή
// άλλαξαν στη SoftOne μετά τον τελευταίο έλεγχο και ξαναψάχνει ΜΟΝΟ τις γραμμές χωρίς είδος (ενός
// παραστατικού, ή όλων των μη καταχωρισμένων). Μόνο αναγνώσεις στη SoftOne.
export async function POST(req: Request) {
  const u = await requirePermission('ocr.categorize');
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const { docId } = parsed.data;

  let pull;
  try {
    pull = await pullChangedItems();
  } catch (e) {
    return NextResponse.json({
      error: 'softone_unreachable',
      message: `Η SoftOne δεν απάντησε — τα είδη δεν ανανεώθηκαν. ${(e as Error).message}`,
    }, { status: 502 });
  }
  const rematch = await rematchUnmatchedLines(docId ? [docId] : undefined);
  await logAudit({
    userId: u.id, userEmail: u.email, action: 'ocr.items.rescan', resource: docId ? 'ocr_document' : 'ocr_queue',
    resourceId: docId ?? null, metadata: { ...pull, ...rematch },
  }).catch(() => null);
  return NextResponse.json({ ok: true, pull, rematch });
}
