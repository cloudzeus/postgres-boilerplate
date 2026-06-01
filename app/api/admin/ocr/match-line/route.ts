import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

// Manually links an invoice line to a SoftOne item (or clears it).
// POST { lineId, mtrl }  (mtrl null → clear)
export async function POST(req: Request) {
  await requirePermission('ocr.categorize');
  const { lineId, mtrl } = await req.json().catch(() => ({}));
  if (!lineId) return NextResponse.json({ error: 'missing_lineId' }, { status: 400 });

  if (mtrl == null) {
    await prisma.ocrInvoiceItem.update({
      where: { id: String(lineId) },
      data: { softoneMtrl: null, softoneCode: null, softoneName: null, softoneIsService: null, softoneMatchedBy: null },
    });
    return NextResponse.json({ ok: true, cleared: true });
  }

  const item = await prisma.softoneItem.findUnique({ where: { mtrl: Number(mtrl) } });
  if (!item) return NextResponse.json({ error: 'item_not_found' }, { status: 404 });

  await prisma.ocrInvoiceItem.update({
    where: { id: String(lineId) },
    data: {
      softoneMtrl: item.mtrl, softoneCode: item.code, softoneName: item.name,
      softoneIsService: item.isService, softoneMatchedBy: 'manual',
    },
  });
  return NextResponse.json({ ok: true, match: { mtrl: item.mtrl, code: item.code, name: item.name, isService: item.isService } });
}
