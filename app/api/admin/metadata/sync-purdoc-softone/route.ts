import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { syncPurchaseDocTypes } from '@/lib/softone/resync';

// Ενεργές σειρές παραστατικών αγορών → `PurchaseDocType`.
// Η λογική ζει στο `lib/softone/resync.ts` — ΜΙΑ υλοποίηση, που καλεί και το «Συγχρονισμός όλων».
export async function POST() {
  const u = await requirePermission('metadata.manage');
  try {
    const r = await syncPurchaseDocTypes(u);
    return NextResponse.json({ ok: true, total: r.total, created: r.created, updated: r.updated, skipped: r.skipped, ...r.detail, syncedAt: r.syncedAt });
  } catch (e) {
    return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status: 502 });
  }
}
