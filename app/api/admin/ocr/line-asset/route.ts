import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { assignLineAsset } from '@/lib/ocr/line-asset';

const Body = z.object({ lineId: z.string().min(1), asset: z.number().int().positive().nullable() });

// POST — αντιστοίχιση (ή αφαίρεση) πάγιου σε μία γραμμή. Τοπικά μόνο· τίποτα δεν φεύγει προς το SoftOne.
export async function POST(req: Request) {
  const u = await requirePermission('ocr.categorize');
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  try {
    const r = await assignLineAsset(parsed.data.lineId, parsed.data.asset);
    await logAudit({
      userId: u.id, userEmail: u.email, action: 'ocr.line.asset', resource: 'ocr_invoice_item', resourceId: r.lineId,
      metadata: { asset: r.asset?.mtrl ?? null, docId: r.docId },
    }).catch(() => null);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: 'failed', message: (e as Error).message }, { status: 400 });
  }
}
