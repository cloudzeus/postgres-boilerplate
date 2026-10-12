import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { cachedInactiveLineItems, findInactiveLineItems } from '@/lib/softone-sync/lineitem-activate';

export const dynamic = 'force-dynamic';

// Οι ανενεργές χρεοπιστώσεις του SoftOne (το GetTable τις κρύβει· η λίστα του LINEITEM όχι). Μόνο ανάγνωση.
// Χωρίς παραμέτρους: όλες. Με `account` / `code` / `q`: μόνο όσες αξίζει να προταθούν.
export async function GET(req: Request) {
  await requirePermission('metadata.read');
  const sp = new URL(req.url).searchParams;
  const by = { account: sp.get('account'), code: sp.get('code'), q: sp.get('q') };
  try {
    if (by.account || by.code || by.q) return NextResponse.json({ items: await findInactiveLineItems(by) });
    return NextResponse.json({ items: await cachedInactiveLineItems() });
  } catch (e) {
    return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status: 502 });
  }
}
