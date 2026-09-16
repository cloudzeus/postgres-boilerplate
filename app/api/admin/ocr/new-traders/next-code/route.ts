import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { getSetting } from '@/lib/settings';
import { softoneNextTraderCode, TRADER_KIND_SODTYPE } from '@/lib/softone';
import { traderCodeMaskKey } from '@/lib/trader-code';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Query = z.enum(['supplier', 'creditor', 'debtor']);

/**
 * GET ?kind=creditor — ο **επόμενος ελεύθερος** κωδικός για τον τύπο.
 *
 * Μόνο ΑΝΑΓΝΩΣΗ: ένα `GetTable` στον `TRDR` φιλτραρισμένο στο SODTYPE του τύπου
 * (cached 60s στη διεργασία). Καμία εγγραφή, καμία δέσμευση κωδικού — η πρόταση
 * είναι πρόταση, και επαληθεύεται ξανά τη στιγμή της δημιουργίας.
 *
 * Όταν το SoftOne δεν απαντά πέφτουμε στον τοπικό καθρέφτη και το δηλώνουμε
 * (`stale: true`): μπαγιάτικα δεδομένα ⇒ ο κωδικός μπορεί να έχει πιαστεί.
 */
export async function GET(req: Request) {
  await requirePermission('ocr.categorize');

  const parsed = Query.safeParse(new URL(req.url).searchParams.get('kind'));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_kind', message: 'Άγνωστος τύπος συναλλασσομένου.' }, { status: 400 });
  }
  const kind = parsed.data;

  const [mask, mirror] = await Promise.all([
    getSetting<string>(traderCodeMaskKey(kind), '').catch(() => ''),
    prisma.softoneTrader
      .findMany({ where: { sodtype: TRADER_KIND_SODTYPE[kind] }, select: { code: true } })
      .catch(() => [] as { code: string }[]),
  ]);

  const res = await softoneNextTraderCode(kind, {
    mask: mask ?? '',
    fallbackCodes: mirror.map((r) => r.code),
  });

  return NextResponse.json({ kind, ...res });
}
