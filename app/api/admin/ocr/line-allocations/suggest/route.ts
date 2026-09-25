import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { normalizeLineText } from '@/lib/ocr/line-match';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * ΠΡΟΤΑΣΗ λογαριασμού δαπάνης για μια γραμμή, από τη ΜΝΗΜΗ (`LineMatchRule`).
 *
 * Κλειδί: **ΑΦΜ εκδότη + κανονικοποιημένο κείμενο γραμμής** — το ίδιο που χρησιμοποιεί ήδη η
 * αντιστοίχιση ειδών/εξόδων. Δηλαδή: «το προηγούμενο τιμολόγιο της PwC με αυτή τη γραμμή πήγε
 * στον 61.00.06.0024· να το ξανακάνω;»
 *
 * ΓΙΑΤΙ ΠΡΟΤΑΣΗ ΚΑΙ ΟΧΙ ΑΥΤΟΜΑΤΗ ΕΦΑΡΜΟΓΗ: ο λογαριασμός δαπάνης είναι ΛΟΓΙΣΤΙΚΗ απόφαση. Μια
 * σιωπηλή εφαρμογή σημαίνει ότι ένα λάθος της πρώτης φοράς αντιγράφεται σε κάθε επόμενο
 * παραστατικό του ίδιου εκδότη χωρίς να το δει ποτέ άνθρωπος. Η οθόνη δείχνει την πρόταση, ο
 * χρήστης πατά «Χρήση».
 *
 * Επιστρέφει ΜΟΝΟ κανόνες που έγραψε άνθρωπος (`targetSource: 'manual'`) και δείχνουν σε
 * χρεοπίστωση — οι υπόλοιποι στόχοι (είδος/έξοδο) δεν είναι λογαριασμοί δαπάνης.
 */
export async function GET(req: Request) {
  await requirePermission('ocr.read');
  const lineId = new URL(req.url).searchParams.get('lineId')?.trim();
  if (!lineId) return NextResponse.json({ message: 'Λείπει το lineId.' }, { status: 400 });

  const line = await prisma.ocrInvoiceItem.findUnique({
    where: { id: lineId },
    select: { name: true, document: { select: { issuerAfm: true } } },
  });
  if (!line) return NextResponse.json({ message: 'Η γραμμή δεν βρέθηκε.' }, { status: 404 });

  const pattern = normalizeLineText(line.name);
  if (!pattern) return NextResponse.json({ suggestion: null });

  // Πρώτα ο κανόνας ΑΥΤΟΥ του εκδότη· αν δεν υπάρχει, ο γενικός (κενό ΑΦΜ) για την ίδια γραμμή.
  const afm = String(line.document?.issuerAfm ?? '').trim();
  const rule = await prisma.lineMatchRule.findFirst({
    where: { pattern, lin: { not: null }, targetSource: 'manual', afm: { in: afm ? [afm, ''] : [''] } },
    orderBy: [{ afm: 'desc' }, { timesUsed: 'desc' }],
    select: { lin: true, timesUsed: true, afm: true },
  });
  if (!rule?.lin) return NextResponse.json({ suggestion: null });

  const account = await prisma.softoneLineItem.findUnique({
    where: { mtrl: rule.lin },
    select: { mtrl: true, code: true, name: true, isActive: true },
  });
  // Κανόνας που δείχνει σε μητρώο που δεν υπάρχει πια: δεν προτείνουμε νεκρό λογαριασμό.
  if (!account?.isActive) return NextResponse.json({ suggestion: null });

  return NextResponse.json({
    suggestion: {
      registryMtrl: account.mtrl,
      kind: 'LINEITEM' as const,
      code: account.code,
      name: account.name,
      timesUsed: rule.timesUsed,
      /** `true` όταν ο κανόνας είναι ΑΥΤΟΥ του εκδότη, όχι γενικός — το λέει η οθόνη. */
      sameIssuer: Boolean(afm) && rule.afm === afm,
    },
  });
}
