import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { syncMyDataClasses } from '@/lib/softone/resync';

// Οι δύο λίστες χαρακτηρισμού myDATA (MYDATACLTYPE / MYDATACLCATEGORY) μαζί — ζεύγος.
export async function POST() {
  const u = await requirePermission('metadata.manage');
  try {
    const r = await syncMyDataClasses(u);
    return NextResponse.json({ ok: true, total: r.total, created: r.created, updated: r.updated, ...r.detail, syncedAt: r.syncedAt });
  } catch (e) {
    return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status: 502 });
  }
}
