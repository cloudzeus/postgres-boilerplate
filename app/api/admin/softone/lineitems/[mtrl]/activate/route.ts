import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { activateLineItem, LineItemActivateError } from '@/lib/softone-sync/lineitem-activate';

const Body = z.object({ allowCreditors: z.boolean().default(false) });

// Ενεργοποίηση χρεοπίστωσης στο SoftOne (+ προαιρετικά αποδοχή πιστωτών) — βλ. `lineitem-activate.ts`.
export async function POST(req: Request, { params }: { params: Promise<{ mtrl: string }> }) {
  const u = await requirePermission('metadata.manage');
  const mtrl = Number((await params).mtrl);
  if (!Number.isInteger(mtrl) || mtrl <= 0) return NextResponse.json({ error: 'invalid_mtrl', message: 'Άκυρη χρεοπίστωση.' }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', message: 'Άκυρο αίτημα.' }, { status: 400 });
  try {
    const r = await activateLineItem(mtrl, parsed.data);
    await logAudit({
      userId: u.id, userEmail: u.email, action: 'softone.lineitem.activate', resource: 'softone_lineitem', resourceId: String(mtrl),
      metadata: { code: r.code, lisourceType: r.lisourceType, creditorsAdded: r.creditorsAdded },
    }).catch(() => null);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof LineItemActivateError) return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
    return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status: 502 });
  }
}
