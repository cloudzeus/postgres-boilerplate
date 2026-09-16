import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { syncLineItems } from '@/lib/softone-registry-sync';

// Διαβάζει τις ενεργές χρεοπιστώσεις (LINEITEM → MTRL SODTYPE 53) και ενημερώνει τον καθρέφτη
// `SoftoneLineItem`. ΜΟΝΟ ανάγνωση από το SoftOne — καμία εγγραφή.
export async function POST() {
  const u = await requirePermission('metadata.manage');
  try {
    const r = await syncLineItems(u.id);
    await logAudit({
      userId: u.id, userEmail: u.email,
      action: 'metadata.lineitems.sync_softone', resource: 'setting',
      metadata: { total: r.total, created: r.created, updated: r.updated, deactivated: r.deactivated },
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status: 502 });
  }
}
