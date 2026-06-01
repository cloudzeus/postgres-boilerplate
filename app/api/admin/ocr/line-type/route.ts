import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

export const runtime = 'nodejs';

// Reclassifies an unmatched OCR line as product/service. Stored on the line's
// softoneIsService override (the matching page falls back to the document kind
// when this is null). POST { lineId, isService }
export async function POST(req: Request) {
  await requirePermission('ocr.categorize');
  const b = await req.json().catch(() => ({}));
  const lineId = String(b?.lineId ?? '').trim();
  const isService = !!b?.isService;
  if (!lineId) return NextResponse.json({ error: 'missing_lineId' }, { status: 400 });

  try {
    await prisma.ocrInvoiceItem.update({ where: { id: lineId }, data: { softoneIsService: isService } });
  } catch {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, isService });
}
