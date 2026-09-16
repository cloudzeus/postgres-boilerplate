import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { syncMyDataClasses, syncFailureResponse, withResyncLock } from '@/lib/softone-sync/resync';

// Οι δύο λίστες χαρακτηρισμού myDATA (MYDATACLTYPE / MYDATACLCATEGORY) — ζεύγος.
// ΜΟΝΟ ΑΝΑΓΝΩΣΗ από το SoftOne. Η λογική ζει στο `lib/softone-sync/resync.ts` — ΜΙΑ υλοποίηση, ίδια
// με αυτήν που τρέχει το «Συγχρονισμός όλων», και ίδια κλειδαριά.
export async function POST() {
  const u = await requirePermission('metadata.manage');
  try {
    const r = await withResyncLock(u, ['mydataclasses'], () => syncMyDataClasses(u));
    return NextResponse.json({ ok: true, total: r.total, created: r.created, updated: r.updated, skipped: r.skipped, ...r.detail, syncedAt: r.syncedAt });
  } catch (e) {
    const { status, body } = syncFailureResponse(e);
    return NextResponse.json(body, { status });
  }
}
