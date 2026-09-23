import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { ISSUER_SODTYPES } from '@/lib/softone';
import { requiredTraderKind } from '@/lib/ocr/required-trader-kind';
import { TRADER_KIND_TEXT } from '@/lib/ocr/posting-target';

// Manually links a scanned document to the SoftOne trader that issued it (TRDR):
// προμηθευτής (12), πιστωτής (16) ή χρεώστης (15) — το είδος το λέει η ΣΕΙΡΑ του παραστατικού.
// POST { trdr }  (trdr null → clear)
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.categorize');
  const { id } = await ctx.params;
  const { trdr } = await req.json().catch(() => ({}));

  if (trdr == null) {
    await prisma.ocrDocument.update({
      where: { id },
      data: { softoneTrdr: null, softoneCode: null, softoneName: null, softoneKind: null },
    });
    return NextResponse.json({ ok: true, cleared: true });
  }

  const sup = await prisma.softoneTrader.findUnique({ where: { trdr: Number(trdr) } });
  if (!sup || !(ISSUER_SODTYPES as readonly number[]).includes(sup.sodtype)) {
    return NextResponse.json({ error: 'supplier_not_found' }, { status: 404 });
  }

  /**
   * Ο ΤΥΠΟΣ της καρτέλας πρέπει να ταιριάζει με το πεδίο `TRDR` του object καταχώρισης
   * (`LINCREDOC` δέχεται πιστωτή, `PURDOC`/`LINSUPDOC` προμηθευτή, `LINDEBDOC` χρεώστη).
   *
   * Μέχρι τώρα το route δεχόταν **οποιαδήποτε** από τις τρεις: η λωρίδα ελέγχων έδειχνε αμέσως
   * πράσινο «βρέθηκε» και το λάθος έβγαινε μόνο πιο κάτω, ως `trader_kind_mismatch`, αφού ο
   * χρήστης είχε ήδη πιστέψει ότι τελείωσε. Η άρνηση εδώ είναι φθηνότερη από την εξήγηση μετά.
   *
   * **Άγνωστη σειρά ⇒ δεν κρίνουμε**: δεν ξέρουμε πού καταχωρείται, οπότε δεν ξέρουμε ούτε τι
   * καρτέλα θέλει, και μια άρνηση θα ήταν εξίσου αυθαίρετη με μια αποδοχή.
   */
  const doc = await prisma.ocrDocument.findUnique({
    where: { id }, select: { seriesSource: true, softoneSeries: true },
  });
  if (!doc) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const required = await requiredTraderKind(doc);
  if (required && sup.sodtype !== required.sodtype) {
    const want = TRADER_KIND_TEXT[required.kind];
    return NextResponse.json({
      error: 'trader_kind_mismatch',
      required: { kind: required.kind, sodtype: required.sodtype, label: want.nom },
      got: { sodtype: sup.sodtype, kind: sup.kind ?? null, name: sup.name },
      message:
        `Η σειρά του παραστατικού καταχωρείται σε ${required.object} και δέχεται καρτέλα `
        + `${want.nom} (SODTYPE ${required.sodtype}). Η «${sup.name}» είναι ${sup.kind ?? `τύπου ${sup.sodtype}`}. `
        + `Διάλεξε ή δημιούργησε ${want.acc} για το ίδιο ΑΦΜ.`,
    }, { status: 422 });
  }

  await prisma.ocrDocument.update({
    where: { id },
    data: {
      softoneTrdr: sup.trdr, softoneCode: sup.code, softoneName: sup.name,
      softoneKind: sup.kind ?? 'Προμηθευτής', softoneChecked: new Date(),
    },
  });
  return NextResponse.json({ ok: true, match: { trdr: sup.trdr, code: sup.code, name: sup.name, kind: sup.kind } });
}
