import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { changeSoftoneItem, ItemMaintenanceError } from '@/lib/softone-sync/item-maintenance';

const Body = z.union([
  z.object({ code: z.string().min(1).max(50) }),
  z.object({ deactivate: z.literal(true) }),
]);

// Διόρθωση υπάρχοντος είδους/υπηρεσίας στο SoftOne: νέος κωδικός ή αδρανοποίηση (ποτέ διαγραφή).
export async function PATCH(req: Request, { params }: { params: Promise<{ mtrl: string }> }) {
  const u = await requirePermission('metadata.manage');
  const mtrl = Number((await params).mtrl);
  if (!Number.isInteger(mtrl) || mtrl <= 0) return NextResponse.json({ error: 'invalid_mtrl', message: 'Άκυρη εγγραφή.' }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', message: 'Δώσε κωδικό ή αδρανοποίηση.' }, { status: 400 });
  try {
    const r = await changeSoftoneItem(mtrl, parsed.data);
    await logAudit({
      userId: u.id, userEmail: u.email, action: 'softone.item.update', resource: 'softone_item', resourceId: String(mtrl),
      metadata: { object: r.object, before: r.before, after: r.after },
    }).catch(() => null);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof ItemMaintenanceError) return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
    return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status: 502 });
  }
}
