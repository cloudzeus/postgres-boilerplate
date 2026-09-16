import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { parseAfmParam } from '@/lib/ocr/validate';
import { applyVatPrefix } from '@/lib/ocr/vat-prefix';
import { applyTraderToDocs } from '@/lib/ocr/queues';
import { ISSUER_SODTYPES } from '@/lib/softone';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  trdr: z.number().int().positive(),
  /**
   * ISO-2 χώρα που επέλεξε/βρήκε ο χρήστης. Όταν δεν είναι η Ελλάδα και το ΑΦΜ
   * της ομάδας είναι γυμνό, τα έγγραφα ξαναγράφονται με το πρόθεμα της χώρας.
   */
  country: z.string().trim().regex(/^[A-Za-z]{2}$/).nullable().optional(),
});

// POST — «Είναι υπάρχων…»: συνδέει όλα τα έγγραφα του ΑΦΜ με υπάρχοντα
// προμηθευτή/πιστωτή/χρεώστη (SODTYPE 12/16/15) του τοπικού μητρώου (spec 2026-09-11 §2).
export async function POST(req: Request, { params }: { params: Promise<{ afm: string }> }) {
  const u = await requirePermission('ocr.categorize');
  const afm = parseAfmParam((await params).afm);
  if (!afm) return NextResponse.json({ error: 'invalid_afm', message: 'Μη έγκυρο ΑΦΜ.' }, { status: 400 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  }

  const trader = await prisma.softoneTrader.findUnique({ where: { trdr: parsed.data.trdr } });
  if (!trader) {
    return NextResponse.json({ error: 'trader_not_found', message: 'Ο συναλλασσόμενος δεν βρέθηκε.' }, { status: 404 });
  }
  if (!(ISSUER_SODTYPES as readonly number[]).includes(trader.sodtype)) {
    return NextResponse.json(
      { error: 'invalid_sodtype', message: 'Επίλεξε προμηθευτή, πιστωτή ή χρεώστη (SODTYPE 12/16/15).' },
      { status: 422 },
    );
  }

  const vatId = parsed.data.country ? applyVatPrefix(afm, parsed.data.country) : afm;
  const docsUpdated = await applyTraderToDocs(
    afm,
    { trdr: trader.trdr, code: trader.code, name: trader.name, kind: trader.kind, sodtype: trader.sodtype },
    { vatId },
  );

  await logAudit({
    userId: u.id, userEmail: u.email,
    action: 'ocr.trader.link', resource: 'softone_trader', resourceId: String(trader.trdr),
    metadata: { afm, vatId, code: trader.code, name: trader.name, sodtype: trader.sodtype, docsUpdated },
  }).catch(() => null);

  return NextResponse.json({
    ok: true, trdr: trader.trdr, code: trader.code, name: trader.name, kind: trader.kind, afm: vatId, docsUpdated,
  });
}
