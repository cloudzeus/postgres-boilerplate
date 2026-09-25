import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { normalizeLineText } from '@/lib/ocr/line-match';
import { rememberLineMatch } from '@/lib/ocr/queues';
import { refreshDocTallies } from '@/lib/ocr/softone-match';
import { ALLOCATION_KINDS, computeAllocationAmounts, validateAllocations, type AllocationKind } from '@/lib/ocr/line-allocation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * ΕΠΙΜΕΡΙΣΜΟΣ μιας γραμμής παραστατικού σε πολλούς λογαριασμούς γενικής.
 *
 * `POST { lineId, allocations: [{ registryMtrl, percent }, …] }` — **αντικαθιστά** ό,τι υπήρχε.
 * Κενή λίστα ⇒ σβήνει τον επιμερισμό και η γραμμή ξαναγίνεται απλή (μονή αντιστοίχιση).
 *
 * ΓΙΑΤΙ ΑΝΤΙΚΑΤΑΣΤΑΣΗ ΚΑΙ ΟΧΙ ΣΥΓΧΩΝΕΥΣΗ: ο επιμερισμός είναι ΣΥΝΟΛΟ που πρέπει να κάνει 100 %.
 * Μια μερική ενημέρωση θα άφηνε ενδιάμεσες καταστάσεις που δεν αθροίζουν — δηλαδή γραμμές που
 * δεν καταχωρούνται, χωρίς ο χρήστης να ξέρει γιατί.
 *
 * Τα ΠΟΣΑ υπολογίζονται **στον server** από τα ποσοστά και το σύνολο της γραμμής. Ο client δεν τα
 * στέλνει: αν τα έστελνε, δύο διαφορετικές εκδοχές στρογγυλοποίησης θα κατέληγαν στη βάση.
 */
const Body = z.object({
  lineId: z.string().trim().min(1),
  allocations: z.array(z.object({
    registryMtrl: z.number().int().positive(),
    /** Ποιο μητρώο: χρεοπίστωση (διπλογραφικά) ή λογαριασμός εσόδων/εξόδων (απλογραφικά). */
    kind: z.enum(ALLOCATION_KINDS as unknown as [AllocationKind, ...AllocationKind[]]).default('LINEITEM'),
    percent: z.number().finite(),
  })).max(50),
});

export async function POST(req: Request) {
  const u = await requirePermission('ocr.categorize');
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: parsed.error.issues[0]?.message ?? 'Άκυρο αίτημα.' }, { status: 400 });
  }
  const { lineId, allocations } = parsed.data;

  const line = await prisma.ocrInvoiceItem.findUnique({
    where: { id: lineId },
    select: {
      id: true, documentId: true, rowIndex: true, name: true, total: true,
      document: { select: { issuerAfm: true } },
    },
  });
  if (!line) return NextResponse.json({ message: 'Η γραμμή δεν βρέθηκε.' }, { status: 404 });

  // Καθαρισμός: κενή λίστα σβήνει τα πάντα και δεν ελέγχει ποσοστά.
  if (allocations.length === 0) {
    const { count } = await prisma.ocrInvoiceItemAllocation.deleteMany({ where: { itemId: lineId } });
    if (count > 0) {
      await logAudit({
        userId: u.id, userEmail: u.email,
        action: 'ocr.line.allocations.clear', resource: 'ocr_line', resourceId: lineId,
        metadata: { docId: line.documentId, rowIndex: line.rowIndex, removed: count },
      });
    }
    // ΚΑΙ ΣΤΟ ΣΒΗΣΙΜΟ. Χωρίς αυτό η γραμμή έμενε «αντιστοιχισμένη» στον μετρητή αφού ο χρήστης
    // αφαίρεσε τον επιμερισμό — η εκκρεμότητα δεν θα επέστρεφε ποτέ.
    await refreshDocTallies([line.documentId]);
    return NextResponse.json({ ok: true, allocations: [] });
  }

  const total = line.total == null ? null : Number(line.total);
  const problems = validateAllocations(allocations, total);
  if (problems.length > 0) {
    return NextResponse.json({ message: problems[0].message, problems }, { status: 422 });
  }

  // Οι εγγραφές μητρώου πρέπει να ΥΠΑΡΧΟΥΝ — αλλιώς γράφουμε δείκτες σε μητρώο που δεν τους έχει
  // και το λάθος φαίνεται πολύ αργότερα, τη στιγμή της καταχώρισης. Ελέγχουμε στο μητρώο που
  // δηλώνει το `kind` της ΚΑΘΕ γραμμής: ο ίδιος αριθμός `MTRL` υπάρχει και στα δύο.
  const linIds = allocations.filter((a) => a.kind === 'LINEITEM').map((a) => a.registryMtrl);
  const sxIds = allocations.filter((a) => a.kind === 'SXACCOUNT').map((a) => a.registryMtrl);
  const [linRows, sxRows] = await Promise.all([
    linIds.length
      ? prisma.softoneLineItem.findMany({ where: { mtrl: { in: linIds } }, select: { mtrl: true, code: true, acnmsk: true } })
      : Promise.resolve([]),
    sxIds.length
      ? prisma.softoneSxAccount.findMany({ where: { mtrl: { in: sxIds } }, select: { mtrl: true, code: true } })
      : Promise.resolve([]),
  ]);
  const byKind: Record<AllocationKind, Map<number, { code: string; acnmsk?: string | null }>> = {
    LINEITEM: new Map(linRows.map((k) => [k.mtrl, k])),
    SXACCOUNT: new Map(sxRows.map((k) => [k.mtrl, { code: k.code }])),
  };
  const missing = allocations.filter((a) => !byKind[a.kind].has(a.registryMtrl));
  if (missing.length > 0) {
    const label = (k: AllocationKind) => (k === 'SXACCOUNT' ? 'λογαριασμός εσόδων/εξόδων' : 'χρεοπίστωση');
    return NextResponse.json(
      {
        message: `Άγνωστη εγγραφή μητρώου: ${missing.map((m) => `${label(m.kind)} ${m.registryMtrl}`).join(', ')}.`
          + ' Συγχρόνισε το μητρώο και δοκίμασε ξανά.',
      },
      { status: 422 },
    );
  }

  const computed = computeAllocationAmounts(allocations, total as number);

  // Αντικατάσταση μέσα σε ΜΙΑ συναλλαγή: ποτέ «μισός» επιμερισμός στη βάση.
  await prisma.$transaction([
    prisma.ocrInvoiceItemAllocation.deleteMany({ where: { itemId: lineId } }),
    prisma.ocrInvoiceItemAllocation.createMany({
      data: computed.map((c) => ({
        itemId: lineId,
        order: c.order,
        registryMtrl: c.registryMtrl,
        kind: c.kind ?? 'LINEITEM',
        // Ο λογαριασμός όπως είναι ΤΩΡΑ: ο κωδικός της εγγραφής ΕΙΝΑΙ ο λογαριασμός, με το
        // `acnmsk` ως εναλλακτική όπου το μητρώο το κρατά ξεχωριστά (χρεοπιστώσεις).
        accountCode: byKind[c.kind ?? 'LINEITEM'].get(c.registryMtrl)?.acnmsk
          ?? byKind[c.kind ?? 'LINEITEM'].get(c.registryMtrl)?.code ?? null,
        percent: c.percent,
        amount: c.amount,
      })),
    }),
  ]);

  /**
   * ΜΝΗΜΗ: «αν το κάνει μια φορά να το θυμάται». Γράφουμε ΜΟΝΟ όταν ο επιμερισμός είναι ΕΝΑΣ
   * λογαριασμός στο 100 % και χρεοπίστωση — τότε η απόφαση είναι ακριβώς ίδια με μια κανονική
   * αντιστοίχιση γραμμής, και η υπάρχουσα μνήμη (`LineMatchRule`) την εκφράζει πιστά.
   *
   * Έναν ΠΡΑΓΜΑΤΙΚΟ επιμερισμό (2+ λογαριασμοί με ποσοστά) ΔΕΝ τον θυμόμαστε: η σημερινή μνήμη
   * κρατά έναν στόχο ανά γραμμή, οπότε θα αποθήκευε τον πρώτο λογαριασμό σαν να ήταν ολόκληρη η
   * απόφαση — και θα πρότεινε 100 % εκεί που ο χρήστης είχε πει 40/60. Καλύτερα καμία πρόταση
   * παρά λάθος πρόταση σε λογιστική εγγραφή.
   */
  const single = computed.length === 1 && computed[0].kind !== 'SXACCOUNT' ? computed[0] : null;
  const pattern = normalizeLineText(line.name);
  if (single && pattern && Math.abs(single.percent - 100) < 0.01) {
    await rememberLineMatch({
      afm: String(line.document?.issuerAfm ?? '').trim(),
      pattern,
      match: {
        mtrl: null, expn: null, lin: single.registryMtrl, isService: false, kind: 'lineitem',
        code: byKind.LINEITEM.get(single.registryMtrl)?.code ?? null,
        name: null,
      },
      analytics: { costCntr: null, prjc: null, prjcStage: null },
      userId: u.id,
    }).catch(() => null);
  }

  await logAudit({
    userId: u.id, userEmail: u.email,
    action: 'ocr.line.allocations.set', resource: 'ocr_line', resourceId: lineId,
    metadata: {
      docId: line.documentId, rowIndex: line.rowIndex, total,
      allocations: computed.map((c) => ({ registryMtrl: c.registryMtrl, kind: c.kind ?? 'LINEITEM', percent: c.percent, amount: c.amount })),
    },
  });

  // Ο ΜΕΤΡΗΤΗΣ ΤΗΣ ΛΙΣΤΑΣ. Ο επιμερισμός είναι αντιστοίχιση — αλλιώς το παραστατικό έμενε
  // «1 χωρίς αντιστοίχιση · Λύσε» ενώ η καταχώριση δεν είχε κανένα εμπόδιο.
  await refreshDocTallies([line.documentId]);

  const saved = await prisma.ocrInvoiceItemAllocation.findMany({
    where: { itemId: lineId }, orderBy: { order: 'asc' },
    select: { order: true, registryMtrl: true, kind: true, accountCode: true, percent: true, amount: true },
  });
  return NextResponse.json({
    ok: true,
    allocations: saved.map((s) => ({
      order: s.order, registryMtrl: s.registryMtrl, kind: s.kind, accountCode: s.accountCode,
      percent: Number(s.percent), amount: Number(s.amount),
    })),
  });
}
