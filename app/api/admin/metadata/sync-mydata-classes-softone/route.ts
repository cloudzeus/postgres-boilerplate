import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { syncMyDataClassTypes, syncMyDataClassCategories } from '@/lib/softone-registry-sync';

// Οι δύο λίστες χαρακτηρισμού myDATA (MYDATACLTYPE / MYDATACLCATEGORY) μαζί: είναι ζεύγος και
// εμφανίζονται μαζί. ΜΟΝΟ ανάγνωση από το SoftOne.
export async function POST() {
  const u = await requirePermission('metadata.manage');
  try {
    const [types, categories] = await Promise.all([syncMyDataClassTypes(u.id), syncMyDataClassCategories(u.id)]);
    await logAudit({
      userId: u.id, userEmail: u.email,
      action: 'metadata.mydataclasses.sync_softone', resource: 'setting',
      metadata: { types: types.total, categories: categories.total },
    });
    return NextResponse.json({
      ok: true,
      total: types.total + categories.total,
      created: types.created + categories.created,
      updated: types.updated + categories.updated,
      deactivated: 0,
      types, categories,
      syncedAt: types.syncedAt,
    });
  } catch (e) {
    return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status: 502 });
  }
}
