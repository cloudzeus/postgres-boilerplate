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
  // Hybrid reconciliation lock: null = auto-derived, RESOLVED = ολοκληρώθηκε, IGNORED = αγνοήθηκε.
  reconOverride: z.enum(['RESOLVED', 'IGNORED']).nullable().optional(),
  // Chosen SoftOne document SERIES (PurchaseDocType.code).
  softoneSeries: z.string().max(64).nullable().optional(),
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

  // Χειροκίνητη επιλογή σειράς: κλειδώνει το έγγραφο απέναντι στον αυτόματο ταξινομητή
  // (`seriesBy: 'manual'`, spec 2026-09-11 §1.4). Καθάρισμα της σειράς ξεκλειδώνει.
  const seriesPatch = 'softoneSeries' in body
    ? body.softoneSeries
      ? {
        seriesBy: 'manual', seriesConfidence: 1, seriesReason: 'χειροκίνητη επιλογή',
        seriesSource: await sourceOfSeries(body.softoneSeries),
      }
      : { seriesBy: null, seriesConfidence: null, seriesReason: null, seriesSource: null }
    : {};

  const doc = await prisma.ocrDocument.update({ where: { id }, data: { ...scalar, ...seriesPatch } as any });

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

/** SOSOURCE της σειράς: 1251 όταν είναι σειρά αγορών, αλλιώς η ενότητα της `SoftoneDocSeries`. */
async function sourceOfSeries(code: string): Promise<number | null> {
  const purchase = await prisma.purchaseDocType.findUnique({ where: { code }, select: { id: true } });
  if (purchase) return 1251;
  const other = await prisma.softoneDocSeries.findFirst({ where: { code }, select: { sosource: true }, orderBy: { sosource: 'asc' } });
  return other?.sosource ?? null;
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
