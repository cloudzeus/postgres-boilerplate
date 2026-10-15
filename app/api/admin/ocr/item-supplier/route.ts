import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { applyItemSupplier, planForItem, readItemSuppliers } from '@/lib/softone-sync/item-supplier';
import { decideLineUnits } from '@/lib/ocr/line-units';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Η γραμμή, το είδος της και ο προμηθευτής του παραστατικού — η βάση κάθε πρότασης. */
async function lineContext(lineId: string) {
  const line = await prisma.ocrInvoiceItem.findUnique({
    where: { id: lineId },
    select: {
      rowIndex: true, code: true, name: true, quantity: true, price: true, total: true, softoneMtrl: true,
      document: { select: { id: true, softoneTrdr: true, softoneName: true, document: true } },
    },
  });
  if (!line) return { error: 'Η γραμμή δεν βρέθηκε.' } as const;
  if (line.softoneMtrl == null) return { error: 'Η γραμμή δεν έχει αντιστοιχιστεί σε είδος.' } as const;
  if (line.document.softoneTrdr == null) return { error: 'Το παραστατικό δεν έχει συνδεθεί με προμηθευτή.' } as const;
  const item = await prisma.softoneItem.findUnique({
    where: { mtrl: line.softoneMtrl }, select: { mtrl: true, code: true, name: true, isService: true, unit1: true, unitBuy: true, buyRatio: true },
  });
  // Τιμή ΑΝΑ ΒΑΣΙΚΗ ΜΟΝΑΔΑ, καθαρή μετά την έκπτωση: αξία γραμμής / ποσότητα, και αν η ποσότητα
  // είναι σε μονάδα αγορών (κιβώτιο των 100), ÷ σχέση.
  const qty = line.quantity == null ? null : Number(line.quantity);
  const net = line.total == null ? null : Number(line.total);
  const perUnit = qty && net != null ? net / qty : line.price == null ? null : Number(line.price);
  const units = item ? await prisma.softoneLookup.findMany({ where: { kind: 'MTRUNIT' }, select: { code: true, name: true } }) : [];
  const docLine = ((line.document.document ?? {}) as { lines?: { unit?: string | null; qtyIn?: string | null }[] }).lines?.[line.rowIndex];
  const d = item ? decideLineUnits(item, docLine, units) : null;
  const ratio = d && !d.qtyInBase ? d.buyRatio : 1;
  const basePrice = perUnit == null ? null : Math.round((perUnit / ratio) * 10000) / 10000;
  const unitName = (c: string | null | undefined) => units.find((u) => u.code === c)?.name ?? null;
  return {
    line, item, trdr: line.document.softoneTrdr, supplierName: line.document.softoneName ?? `TRDR ${line.document.softoneTrdr}`,
    suggestion: { code: line.code?.trim() || null, name: line.name?.trim() || null, price: basePrice, baseUnit: unitName(item?.unit1) },
  } as const;
}

async function supplierNames(trdrs: number[]) {
  const rows = await prisma.softoneTrader.findMany({ where: { trdr: { in: [...new Set(trdrs)] } }, select: { trdr: true, name: true, code: true } });
  return Object.fromEntries(rows.map((r) => [r.trdr, `${r.name}${r.code ? ` (${r.code})` : ''}`]));
}

// GET ?lineId= — τι ξέρει ΤΩΡΑ η SoftOne για το είδος (κωδικοί/τιμές όλων των προμηθευτών) + πρόταση.
export async function GET(req: Request) {
  await requirePermission('ocr.categorize');
  const lineId = new URL(req.url).searchParams.get('lineId') ?? '';
  const ctx = await lineContext(lineId);
  if ('error' in ctx) return NextResponse.json({ error: 'invalid_line', message: ctx.error }, { status: 422 });
  try {
    const state = await readItemSuppliers(ctx.line.softoneMtrl!);
    const names = await supplierNames([...state.codes.map((r) => r.trdr), ...state.prices.map((r) => r.trdr), ctx.trdr]);
    return NextResponse.json({ item: ctx.item, trdr: ctx.trdr, supplierName: ctx.supplierName, suggestion: ctx.suggestion, state, names });
  } catch (e) {
    return NextResponse.json({ error: 'softone_unreachable', message: `Η SoftOne δεν απάντησε: ${(e as Error).message}` }, { status: 502 });
  }
}

const Body = z.object({
  lineId: z.string().min(1),
  code: z.string().trim().max(50).nullable().optional(),
  name: z.string().trim().max(128).nullable().optional(),
  price: z.number().min(0).max(1e9).nullable().optional(),
  disc1: z.number().min(0).max(100).nullable().optional(),
  dryRun: z.boolean().optional(),
});

// POST — dryRun: το ακριβές setData· αλλιώς εγγραφή στη SoftOne με ανάγνωση πίσω.
export async function POST(req: Request) {
  const u = await requirePermission('ocr.categorize');
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const b = parsed.data;
  const ctx = await lineContext(b.lineId);
  if ('error' in ctx) return NextResponse.json({ error: 'invalid_line', message: ctx.error }, { status: 422 });
  const change = { trdr: ctx.trdr, code: b.code ?? null, name: b.name ?? null, price: b.price ?? null, disc1: b.disc1 ?? null };
  try {
    if (b.dryRun) {
      const { plan } = await planForItem(ctx.line.softoneMtrl!, change, ctx.supplierName);
      return NextResponse.json({ dryRun: true, changes: plan.changes, payload: plan.payload ? { service: 'setData', ...plan.payload } : null });
    }
    const { plan, state } = await applyItemSupplier(ctx.line.softoneMtrl!, change, ctx.supplierName);
    if (plan.payload) {
      await logAudit({
        userId: u.id, userEmail: u.email, action: 'softone.item.supplier', resource: 'softone_item',
        resourceId: String(ctx.line.softoneMtrl), metadata: { trdr: ctx.trdr, code: change.code, price: change.price, changes: plan.changes },
      }).catch(() => null);
    }
    const names = await supplierNames([...state.codes.map((r) => r.trdr), ...state.prices.map((r) => r.trdr)]);
    return NextResponse.json({ ok: true, changes: plan.changes, nothingToDo: !plan.payload, state, names });
  } catch (e) {
    return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status: 502 });
  }
}
