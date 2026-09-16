import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { syncLineCategories } from '@/lib/softone-registry-sync';

// Διαβάζει τις κατηγορίες δαπανών (LINCATEGORY → MTRCATEGORY SODTYPE 53) στον καθρέφτη
// `SoftoneLineCategory`. ΜΟΝΟ ανάγνωση από το SoftOne.
export async function POST() {
  const u = await requirePermission('metadata.manage');
  try {
    const r = await syncLineCategories(u.id);
    await logAudit({
      userId: u.id, userEmail: u.email,
      action: 'metadata.linecategories.sync_softone', resource: 'setting',
      metadata: { total: r.total, created: r.created, updated: r.updated, deactivated: r.deactivated },
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status: 502 });
  }
}
