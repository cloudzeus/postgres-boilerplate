import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { normalizeAfm } from '@/lib/ocr/validate';
import { applyTraderToDocs } from '@/lib/ocr/queues';
import { SUPPLIER_SODTYPES } from '@/lib/softone';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ trdr: z.number().int().positive() });

// POST — «Είναι υπάρχων…»: συνδέει όλα τα έγγραφα του ΑΦΜ με υπάρχοντα
// προμηθευτή/πιστωτή (SODTYPE 12/16) του τοπικού μητρώου (spec 2026-09-11 §2).
export async function POST(req: Request, { params }: { params: Promise<{ afm: string }> }) {
  const u = await requirePermission('ocr.categorize');
  const afm = normalizeAfm((await params).afm);
  if (!afm) return NextResponse.json({ error: 'invalid_afm', message: 'Μη έγκυρο ΑΦΜ.' }, { status: 400 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  }

  const trader = await prisma.softoneTrader.findUnique({ where: { trdr: parsed.data.trdr } });
  if (!trader) {
    return NextResponse.json({ error: 'trader_not_found', message: 'Ο συναλλασσόμενος δεν βρέθηκε.' }, { status: 404 });
  }
  if (!(SUPPLIER_SODTYPES as readonly number[]).includes(trader.sodtype)) {
    return NextResponse.json(
      { error: 'invalid_sodtype', message: 'Επίλεξε προμηθευτή ή πιστωτή (SODTYPE 12/16).' },
      { status: 422 },
    );
  }

  const docsUpdated = await applyTraderToDocs(afm, {
    trdr: trader.trdr, code: trader.code, name: trader.name, kind: trader.kind,
  });

  await logAudit({
    userId: u.id, userEmail: u.email,
    action: 'ocr.trader.link', resource: 'softone_trader', resourceId: String(trader.trdr),
    metadata: { afm, code: trader.code, name: trader.name, sodtype: trader.sodtype, docsUpdated },
  }).catch(() => null);

  return NextResponse.json({
    ok: true, trdr: trader.trdr, code: trader.code, name: trader.name, kind: trader.kind, docsUpdated,
  });
}
