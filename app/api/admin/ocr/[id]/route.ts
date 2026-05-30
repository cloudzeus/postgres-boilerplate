import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyDelete } from '@/lib/bunny';

const ItemSchema = z.object({
  code: z.string().nullable().optional(), name: z.string(),
  quantity: z.number().nullable().optional(), price: z.number().nullable().optional(),
  discount: z.number().nullable().optional(), vatRate: z.number().nullable().optional(),
  total: z.number().nullable().optional(),
});
const PatchSchema = z.object({
  category: z.enum(['EXPENSE','INVOICE_IN','INVOICE_OUT','RECEIPT','CREDIT_NOTE','PAYROLL','TAX','OTHER']).nullable().optional(),
  docType: z.enum(['INVOICE','RECEIPT','GENERAL_TEXT']).optional(),
  notes: z.string().max(4000).nullable().optional(),
  extractedData: z.record(z.string(), z.any()).optional(),
  items: z.array(ItemSchema).optional(),
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.read');
  const { id } = await params;
  const doc = await prisma.ocrDocument.findUnique({
    where: { id },
    include: { items: { orderBy: { rowIndex: 'asc' } } },
  });
  if (!doc) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(doc);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.categorize');
  const { id } = await params;
  const body = PatchSchema.parse(await req.json());
  const { items, ...scalar } = body;

  const doc = await prisma.ocrDocument.update({ where: { id }, data: scalar as any });

  if (items) {
    await prisma.$transaction([
      prisma.ocrInvoiceItem.deleteMany({ where: { documentId: id } }),
      prisma.ocrInvoiceItem.createMany({
        data: items.map((it, i) => ({
          documentId: id, rowIndex: i, code: it.code ?? null, name: it.name,
          quantity: it.quantity ?? null, price: it.price ?? null, discount: it.discount ?? null,
          vatRate: it.vatRate ?? null, total: it.total ?? null,
        })),
      }),
    ]);
  }
  const fresh = await prisma.ocrDocument.findUnique({ where: { id }, include: { items: { orderBy: { rowIndex: 'asc' } } } });
  return NextResponse.json(fresh ?? doc);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.delete');
  const { id } = await params;
  const doc = await prisma.ocrDocument.findUnique({ where: { id } });
  if (!doc) return NextResponse.json({ error: 'not found' }, { status: 404 });
  try { await bunnyDelete([doc.storageKey]); } catch { /* best effort */ }
  await prisma.ocrDocument.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
