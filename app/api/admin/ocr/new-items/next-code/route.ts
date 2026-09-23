import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/rbac';
import { getSetting } from '@/lib/settings';
import { softoneNextItemCode } from '@/lib/softone';
import { itemCodeMaskKey } from '@/lib/item-code';
import { mirrorItemCodes } from '@/lib/item-code-mirror';
import { prisma } from '@/lib/db';
import { codeFollowsAccount } from '@/lib/ocr/lineitem-create';
import { isCodeTaken } from '@/lib/next-code';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Query = z.enum(['product', 'service', 'expense', 'lineitem']);

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

  /**
   * **Χρεοπίστωση με λογαριασμό: ο κωδικός ΕΙΝΑΙ ο λογαριασμός** — όταν η εγκατάσταση το κάνει.
   *
   * Στον πελάτη 190 από τις 207 ενεργές χρεοπιστώσεις έχουν `CODE` ίδιο με το `ACNMSK`
   * (`62.01.00.0000` «Φωταέριο…»): μία χρεοπίστωση ανά λογαριασμό γενικής. Μια αριθμητική σειρά
   * τύπου `90000000103` θα έσπαγε τη σύμβαση σε **κάθε** δημιουργία, χωρίς να το πει κανείς.
   *
   * Δεν την επιβάλλουμε: τη **μετράμε** στον καθρέφτη και προτείνουμε τον λογαριασμό μόνο όταν
   * όντως κρατά και ο κωδικός είναι **ελεύθερος**. Αλλιώς πέφτουμε στη συνηθισμένη αρίθμηση.
   */
  const account = (url.searchParams.get('account') ?? '').trim().slice(0, 40);
  if (kind === 'lineitem' && account) {
    const rows = await prisma.softoneLineItem
      .findMany({ select: { code: true, acnmsk: true } })
      .catch(() => [] as { code: string | null; acnmsk: string | null }[]);
    const convention = codeFollowsAccount(rows);
    if (convention.follows) {
      const taken = isCodeTaken(rows.map((r) => r.code ?? ''), account);
      if (!taken) {
        return NextResponse.json({
          kind, code: account, source: 'account', prefix: null, width: null,
          taken: rows.length, stale: false, convention,
        });
      }
    }
  }

  const [mask, fallbackCodes] = await Promise.all([
    getSetting<string>(itemCodeMaskKey(kind), '').catch(() => ''),
    mirrorItemCodes(kind),
  ]);

  const res = await softoneNextItemCode(kind, { mask: mask ?? '', supplierCode, fallbackCodes });

  return NextResponse.json({ kind, ...res });
}
