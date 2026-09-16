import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { syncLineItems, syncFailureResponse, withResyncLock } from '@/lib/softone-sync/resync';

// Χρεοπιστώσεις (LINEITEM → MTRL SODTYPE 53) → `SoftoneLineItem`.
// ΜΟΝΟ ΑΝΑΓΝΩΣΗ από το SoftOne. Η λογική ζει στο `lib/softone-sync/resync.ts` — ΜΙΑ υλοποίηση, ίδια
// με αυτήν που τρέχει το «Συγχρονισμός όλων», και ίδια κλειδαριά.
export async function POST() {
  const u = await requirePermission('metadata.manage');
  try {
    const r = await withResyncLock(u, ['lineitems'], () => syncLineItems(u));
    return NextResponse.json({ ok: true, total: r.total, created: r.created, updated: r.updated, skipped: r.skipped, ...r.detail, syncedAt: r.syncedAt });
  } catch (e) {
    const { status, body } = syncFailureResponse(e);
    return NextResponse.json(body, { status });
  }
}
