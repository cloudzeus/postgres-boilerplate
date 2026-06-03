import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { normalizeAfm } from '@/lib/ocr/validate';

// Consolidated status of the 3 mandatory SoftOne checks for a document:
// duplicate (PURDOC), supplier, items. Powers the <SoftoneChecksStrip>.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.read');
  const { id } = await ctx.params;

  const doc = await prisma.ocrDocument.findUnique({
    where: { id },
    select: {
      extractedData: true,
      softoneDocExists: true, softoneDocRef: true, softoneDocChecked: true,
      softoneTrdr: true, softoneCode: true, softoneName: true, softoneKind: true, softoneChecked: true,
      items: { orderBy: { rowIndex: 'asc' }, select: { id: true, code: true, name: true, softoneMtrl: true } },
    },
  });
  if (!doc) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const ed = (doc.extractedData ?? {}) as Record<string, unknown>;
  const unmatched = doc.items.filter((i) => i.softoneMtrl == null);

  return NextResponse.json({
    duplicate: {
      checked: doc.softoneDocChecked != null,
      exists: doc.softoneDocExists === true,
      ref: doc.softoneDocRef,
    },
    supplier: {
      checked: doc.softoneChecked != null,
      found: doc.softoneTrdr != null,
      name: doc.softoneName, code: doc.softoneCode, kind: doc.softoneKind,
      afm: normalizeAfm(ed.vatNumber) ?? '',
    },
    items: {
      total: doc.items.length,
      matched: doc.items.length - unmatched.length,
      unmatched: unmatched.map((i) => ({ id: i.id, code: i.code, name: i.name })),
    },
  });
}
