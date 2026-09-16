import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { ISSUER_SODTYPES } from '@/lib/softone';

// Manually links a scanned document to the SoftOne trader that issued it (TRDR):
// προμηθευτής (12), πιστωτής (16) ή χρεώστης (15) — το είδος το λέει το μητρώο, όχι το route.
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

  await prisma.ocrDocument.update({
    where: { id },
    data: {
      softoneTrdr: sup.trdr, softoneCode: sup.code, softoneName: sup.name,
      softoneKind: sup.kind ?? 'Προμηθευτής', softoneChecked: new Date(),
    },
  });
  return NextResponse.json({ ok: true, match: { trdr: sup.trdr, code: sup.code, name: sup.name } });
}
