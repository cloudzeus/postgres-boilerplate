import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { loadDocumentJson, saveDocumentJson } from '@/lib/ocr/document';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ rowIndex: z.number().int().min(0), qtyIn: z.enum(['buy', 'base']).nullable() });

// PATCH { rowIndex, qtyIn } — σε ποια μονάδα είναι η ποσότητα της γραμμής («buy» = μονάδα αγορών του
// είδους, «base» = βασική, null = αυτόματα). Γράφεται στο κανονικό JSON· οι γραμμές της βάσης
// (αντιστοιχίσεις) ΔΕΝ αντικαθίστανται.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await requirePermission('ocr.categorize');
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const { rowIndex, qtyIn } = parsed.data;
  const doc = await loadDocumentJson(id).catch(() => null);
  if (!doc || !doc.lines[rowIndex]) return NextResponse.json({ error: 'not_found', message: 'Η γραμμή δεν βρέθηκε.' }, { status: 404 });
  const lines = doc.lines.map((l, i) => {
    if (i !== rowIndex) return l;
    const { qtyIn: _drop, ...rest } = l as typeof l & { qtyIn?: string };
    return qtyIn ? { ...rest, qtyIn } : rest;
  });
  await saveDocumentJson(id, { ...doc, lines } as typeof doc, { replaceItems: false });
  await logAudit({ userId: u.id, userEmail: u.email, action: 'ocr.line.qty_unit', resource: 'ocr_document', resourceId: id, metadata: { rowIndex, qtyIn } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
