import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { syncProjectStages } from '@/lib/softone/resync';

// Μόνο ΑΝΑΓΝΩΣΗ από το SoftOne. Η λογική ζει στο `lib/softone/resync.ts`.
export async function POST() {
  const u = await requirePermission('metadata.manage');
  try {
    const r = await syncProjectStages(u);
    return NextResponse.json({ ok: true, total: r.total, created: r.created, updated: r.updated, ...r.detail, syncedAt: r.syncedAt });
  } catch (e) {
    return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status: 502 });
  }
}
