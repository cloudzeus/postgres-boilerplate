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
    select: {
      name: true, total: true,
      document: { select: { issuerAfm: true, document: true } },
    },
  });
  if (!line) return NextResponse.json({ message: 'Η γραμμή δεν βρέθηκε.' }, { status: 404 });

  // ΤΟ ΧΕΙΡΟΓΡΑΦΟ ΥΠΟΛΟΓΙΖΕΤΑΙ ΠΡΩΤΑ και επιστρέφεται ΠΑΝΤΑ: οι έξοδοι «δεν βρέθηκε κανόνας»
  // παρακάτω δεν επιτρέπεται να το κρύψουν — είναι ανεξάρτητη πηγή από τη μνήμη.
  const total = line.total == null ? null : Number(line.total);
  const parts = asHandwritten(line.document?.document);
  const resolved: { label: string; amount: number; percent: number; registryMtrl: number; code: string; name: string }[] = [];
  // `accountLike` = η ετικέτα ΕΙΝΑΙ κωδικός λογαριασμού αλλά δεν βρέθηκε στο μητρώο ΑΥΤΗΣ της
  // εγκατάστασης. Ριζικά διαφορετικό από «είναι κέντρο κόστους»: το πρώτο λύνεται μόλις
  // συγχρονιστεί το σχέδιο του πελάτη, το δεύτερο θέλει νέα διάσταση στον επιμερισμό.
  const unresolved: (HandwrittenPart & { accountLike: boolean })[] = [];
  for (const p of parts) {
    const code = p.label.replace(/\s+/g, '');
    const accountLike = looksLikeAccount(code);
    if (!accountLike || p.amount == null || !total) { unresolved.push({ ...p, accountLike }); continue; }
    const hit = await prisma.softoneLineItem.findFirst({
      where: { code, isActive: true },
      select: { mtrl: true, code: true, name: true },
    });
    if (!hit) { unresolved.push({ ...p, accountLike: true }); continue; }
    resolved.push({
      label: p.label, amount: p.amount,
      percent: Math.round((p.amount / total) * 1000000) / 10000,
      registryMtrl: hit.mtrl, code: hit.code, name: hit.name,
    });
  }
  const handwritten = parts.length === 0 ? null : {
    /** Εφαρμόσιμο ΜΟΝΟ όταν ΚΑΘΕ κομμάτι λύθηκε σε λογαριασμό — μερική εφαρμογή θα έχανε ποσά. */
    applicable: resolved.length > 0 && unresolved.length === 0,
    parts: resolved,
    unresolved,
  };

  const pattern = normalizeLineText(line.name);
  if (!pattern) return NextResponse.json({ suggestion: null, handwritten });

  // Πρώτα ο κανόνας ΑΥΤΟΥ του εκδότη· αν δεν υπάρχει, ο γενικός (κενό ΑΦΜ) για την ίδια γραμμή.
  const afm = String(line.document?.issuerAfm ?? '').trim();
  const rule = await prisma.lineMatchRule.findFirst({
    where: { pattern, lin: { not: null }, targetSource: 'manual', afm: { in: afm ? [afm, ''] : [''] } },
    orderBy: [{ afm: 'desc' }, { timesUsed: 'desc' }],
    select: { lin: true, timesUsed: true, afm: true },
  });
  if (!rule?.lin) return NextResponse.json({ suggestion: null, handwritten });

  const account = await prisma.softoneLineItem.findUnique({
    where: { mtrl: rule.lin },
    select: { mtrl: true, code: true, name: true, isActive: true },
  });
  // Κανόνας που δείχνει σε μητρώο που δεν υπάρχει πια: δεν προτείνουμε νεκρό λογαριασμό.
  if (!account?.isActive) return NextResponse.json({ suggestion: null, handwritten });

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
    handwritten,
  });
}

/**
 * ΤΟ ΣΧΗΜΑ ΠΟΥ ΕΓΡΑΨΕ Ο ΛΟΓΙΣΤΗΣ ΜΕ ΤΟ ΣΤΥΛΟ.
 *
 * Το `handwritten.allocations` το διαβάζει ΗΔΗ το μοντέλο («an allocation of the amount») και
 * αποθηκεύεται στο κανονικό JSON — και μέχρι τώρα δεν το έβλεπε **κανείς**: η εφαρμογή διάβαζε
 * τον χειρόγραφο επιμερισμό και τον πετούσε.
 *
 * Μετρημένο σε 63 σαρωμένα: 6 παραστατικά κουβαλούν χειρόγραφο σπάσιμο — σε κέντρο κόστους
 * («Αλκυδικές 2.391,60»), σε συντελεστή ΦΠΑ («0% 3.298,53») ή σε ΛΟΓΑΡΙΑΣΜΟ
 * («62.03.90.020023 = 1.395,18»). Μόνο το τελευταίο μπορεί να εφαρμοστεί σήμερα, γιατί ο
 * επιμερισμός κρατά λογαριασμό και όχι κέντρο κόστους.
 *
 * Γι' αυτό επιστρέφουμε ΚΑΙ τα ανεπίλυτα: ο χρήστης πρέπει να δει «ο λογιστής το έσπασε σε 6»
 * ακόμη κι όταν δεν μπορούμε να το περάσουμε αυτόματα. Το να μην το δείξουμε καθόλου είναι που
 * κάνει τη δουλειά του αόρατη.
 */
type HandwrittenPart = { label: string; amount: number | null };

const asHandwritten = (doc: unknown): HandwrittenPart[] => {
  const h = (doc as { handwritten?: { allocations?: unknown } } | null)?.handwritten;
  const raw = Array.isArray(h?.allocations) ? h!.allocations : [];
  return raw
    .map((a) => {
      const o = a as { label?: unknown; amount?: unknown };
      const label = String(o?.label ?? '').trim();
      const amount = typeof o?.amount === 'number' && Number.isFinite(o.amount) ? o.amount : null;
      return { label, amount };
    })
    .filter((p) => p.label !== '' || p.amount != null);
};

/** Ετικέτα που ΕΙΝΑΙ λογαριασμός (π.χ. «62.03.90.020023»), όχι περιγραφή κέντρου κόστους. */
const looksLikeAccount = (label: string) => /^\d{2}[\d.]{4,}$/.test(label.replace(/\s+/g, ''));
