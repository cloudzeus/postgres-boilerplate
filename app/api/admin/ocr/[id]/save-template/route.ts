import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { upsertSupplierTemplate } from '@/lib/ocr/templates-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  fieldHints: z.record(z.string(), z.any()).optional(), // { field: { page, bbox, note } }
});

const docEnumToType = {
  INVOICE: 'invoice',
  RECEIPT: 'receipt',
  GENERAL_TEXT: 'general_text',
} as const;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.create');
  const { id } = await params;
  const { fieldHints } = Body.parse(await req.json().catch(() => ({})));

  const doc = await prisma.ocrDocument.findUnique({ where: { id } });
  if (!doc) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (doc.docType === 'GENERAL_TEXT') {
    return NextResponse.json(
      { error: 'Τα πρότυπα υποστηρίζονται μόνο για τιμολόγια/αποδείξεις.' },
      { status: 422 },
    );
  }

  const data = (doc.extractedData ?? {}) as any;
  const afm = String(data?.vatNumber ?? '').replace(/\D+/g, '');
  if (!/^\d{9}$/.test(afm)) {
    return NextResponse.json(
      { error: 'Δεν υπάρχει έγκυρο ΑΦΜ εκδότη για να αποθηκευτεί πρότυπο.' },
      { status: 422 },
    );
  }

  const tpl = await upsertSupplierTemplate({
    vatNumber: afm,
    docType: docEnumToType[doc.docType],
    supplierName: data?.companyName ?? data?.storeName ?? null,
    example: data,
    fieldHints: fieldHints ?? null,
    sampleDocId: doc.id,
    thumbUrl: doc.thumbUrl ?? null,
  });

  return NextResponse.json({
    ok: true,
    template: { id: tpl.id, vatNumber: tpl.vatNumber, docType: tpl.docType },
  });
}
