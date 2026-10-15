import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { traderDocuments } from '@/lib/ocr/trader-docs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET — τα σκαναρισμένα παραστατικά του συναλλασσομένου (συνδεδεμένα ή με τον ίδιο ΑΦΜ). Μόνο ανάγνωση.
export async function GET(_req: Request, ctx: { params: Promise<{ trdr: string }> }) {
  await requirePermission('ocr.read');
  const trdr = Number((await ctx.params).trdr);
  if (!Number.isInteger(trdr) || trdr <= 0) return NextResponse.json({ error: 'invalid_trdr' }, { status: 400 });
  const t = await prisma.softoneTrader.findUnique({ where: { trdr }, select: { afm: true } });
  if (!t) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ docs: await traderDocuments(trdr, t.afm) });
}
