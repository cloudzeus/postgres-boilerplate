import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST → push the extracted OCR document to SoftOne (FINDOC / PURDOC).
 * Stub: currently flags the row as POSTED with a synthetic ref. Wire to lib/softone
 * once the target object/series mapping per OcrCategory is finalized.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.post');
  const { id } = await params;

  const doc = await prisma.ocrDocument.findUnique({ where: { id }, include: { items: true } });
  if (!doc) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (doc.status !== 'COMPLETED') {
    return NextResponse.json({ error: 'OCR document is not in COMPLETED state' }, { status: 422 });
  }
  if (!doc.category) {
    return NextResponse.json({ error: 'Set a category before posting (EXPENSE / INVOICE_IN / …).' }, { status: 422 });
  }

  await prisma.ocrDocument.update({ where: { id }, data: { postStatus: 'PENDING' } });

  try {
    // TODO: route by doc.category to the correct SoftOne object:
    //   EXPENSE / INVOICE_IN  → setData on PURDOC
    //   INVOICE_OUT / RECEIPT → setData on SODOC
    //   CREDIT_NOTE           → PURDOC/SODOC with negative SERIES
    // For now we mark it as POSTED with a synthetic ref so the UI is wired end-to-end.
    const ref = `OCR-${doc.id.slice(0, 8).toUpperCase()}`;

    await prisma.ocrDocument.update({
      where: { id },
      data: { postStatus: 'POSTED', postedAt: new Date(), postedRef: ref, postError: null },
    });
    return NextResponse.json({ ok: true, ref });
  } catch (err: any) {
    await prisma.ocrDocument.update({
      where: { id },
      data: { postStatus: 'FAILED', postError: String(err?.message ?? err).slice(0, 2000) },
    });
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 502 });
  }
}
