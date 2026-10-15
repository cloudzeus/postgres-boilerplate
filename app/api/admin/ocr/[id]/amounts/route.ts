import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/rbac';
import { applyAmounts, recheckAmounts } from '@/lib/ocr/amounts-recheck';
import { proposalInput } from '@/lib/ocr/amounts-recheck';
import { totalsClose } from '@/lib/ocr/invoice-math';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const num = z.number().nullable();
const Proposal = z.object({
  subtotal: num, vatAmount: num, otherCharges: num, totalAmount: num,
  lines: z.array(z.object({ rowIndex: z.number().int().min(0), quantity: num, price: num, discount: num, total: num, vatRate: num })).max(500),
});
const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('recheck') }),
  z.object({ action: z.literal('apply'), proposal: Proposal, source: z.enum(['recheck', 'plan']) }),
]);

// POST — επανέλεγχος ποσών από το χαρτί (`recheck`, μόνο ανάγνωση) ή εφαρμογή διόρθωσης (`apply`).
// Η εφαρμογή δέχεται ΜΟΝΟ ποσά που κλείνουν — ο ίδιος έλεγχος ξανατρέχει εδώ, στον server.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requirePermission('ocr.categorize');
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  if (parsed.data.action === 'recheck') {
    try {
      return NextResponse.json(await recheckAmounts(id));
    } catch (e) {
      return NextResponse.json({ error: 'recheck_failed', message: `Ο επανέλεγχος απέτυχε: ${(e as Error).message.slice(0, 200)}` }, { status: 502 });
    }
  }
  const { proposal, source } = parsed.data;
  const items = await prisma.ocrInvoiceItem.findMany({
    where: { documentId: id }, orderBy: { rowIndex: 'asc' },
    select: { rowIndex: true, quantity: true, price: true, discount: true, vatRate: true, total: true },
  });
  const current = items.map((i) => ({ rowIndex: i.rowIndex, quantity: Number(i.quantity), price: Number(i.price), discount: i.discount == null ? null : Number(i.discount), vatRate: i.vatRate == null ? null : Number(i.vatRate), total: i.total == null ? null : Number(i.total) }));
  if (!totalsClose(proposalInput(proposal, current))) {
    return NextResponse.json({ error: 'does_not_close', message: 'Τα ποσά δεν κλείνουν — δεν εφαρμόστηκε τίποτα.' }, { status: 422 });
  }
  await applyAmounts(id, proposal, { id: u.id, email: u.email }, source);
  return NextResponse.json({ ok: true });
}
