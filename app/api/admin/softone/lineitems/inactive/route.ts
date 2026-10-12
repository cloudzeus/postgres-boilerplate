import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { fetchInactiveLineItems } from '@/lib/softone-sync/lineitem-activate';

export const dynamic = 'force-dynamic';

// Οι ανενεργές χρεοπιστώσεις του SoftOne (το GetTable τις κρύβει· η λίστα του LINEITEM όχι). Μόνο ανάγνωση.
export async function GET() {
  await requirePermission('metadata.read');
  try {
    return NextResponse.json({ items: await fetchInactiveLineItems() });
  } catch (e) {
    return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status: 502 });
  }
}
