import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { getSetting } from '@/lib/settings';
import { softoneNextItemCode } from '@/lib/softone';
import { itemCodeMaskKey, type ItemCodeKind } from '@/lib/item-code';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Query = z.enum(['product', 'service', 'expense', 'lineitem']);

/** Οι κωδικοί του μητρώου από τον ΤΟΠΙΚΟ καθρέφτη — εφεδρεία όταν το SoftOne δεν απαντά. */
async function mirrorCodes(kind: ItemCodeKind): Promise<string[]> {
  try {
    if (kind === 'expense') {
      const rows = await prisma.softoneExpense.findMany({ select: { code: true } });
      return rows.map((r) => r.code);
    }
    if (kind === 'lineitem') {
      const rows = await prisma.softoneLineItem.findMany({ select: { code: true } });
      return rows.map((r) => r.code);
    }
    const rows = await prisma.softoneItem.findMany({
      where: { isService: kind === 'service' }, select: { code: true },
    });
    return rows.map((r) => r.code);
  } catch {
    return [];
  }
}

/**
 * GET ?kind=service&supplierCode=ABC123 — ο **προτεινόμενος** κωδικός για νέα εγγραφή μητρώου.
 *
 * Δύο κανόνες, με αυτή τη σειρά: ο κωδικός του **προμηθευτή** αν είναι ελεύθερος, αλλιώς ο
 * **επόμενος ελεύθερος** της δικής μας αρίθμησης. Ποτέ slug της περιγραφής.
 *
 * Μόνο ΑΝΑΓΝΩΣΗ: ένα `GetTable` στο μητρώο (cached 60s στη διεργασία). Καμία εγγραφή, καμία
 * δέσμευση κωδικού — η πρόταση είναι πρόταση και επαληθεύεται ξανά τη στιγμή της δημιουργίας.
 */
export async function GET(req: Request) {
  await requirePermission('ocr.categorize');

  const url = new URL(req.url);
  const parsed = Query.safeParse(url.searchParams.get('kind'));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_kind', message: 'Άγνωστο μητρώο ειδών.' }, { status: 400 });
  }
  const kind = parsed.data;
  const supplierCode = (url.searchParams.get('supplierCode') ?? '').trim().slice(0, 50) || null;

  const [mask, fallbackCodes] = await Promise.all([
    getSetting<string>(itemCodeMaskKey(kind), '').catch(() => ''),
    mirrorCodes(kind),
  ]);

  const res = await softoneNextItemCode(kind, { mask: mask ?? '', supplierCode, fallbackCodes });

  return NextResponse.json({ kind, ...res });
}
