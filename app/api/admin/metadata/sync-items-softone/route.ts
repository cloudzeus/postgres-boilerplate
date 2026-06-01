import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { softoneFetchItems } from '@/lib/softone';
import { setSetting } from '@/lib/settings';
import { logAudit } from '@/lib/audit';

// Pulls all items (MTRL SODTYPE=51) + services (52) from SoftOne via GetTable and
// fully replaces the SoftoneItem mirror registry.
export async function POST() {
  const u = await requirePermission('metadata.manage');

  let rows;
  try {
    rows = await softoneFetchItems();
  } catch (e) {
    return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status: 502 });
  }
  if (rows.length === 0) {
    return NextResponse.json({ error: 'softone_error', message: 'Δεν επιστράφηκαν είδη' }, { status: 502 });
  }

  const data = rows.map((r) => ({
    mtrl: r.mtrl, code: r.code, code1: r.code1, code2: r.code2,
    name: r.name || r.code, name2: r.name2, price: r.price, isService: r.isService, isActive: r.isActive,
  }));

  const result = await prisma.$transaction(async (tx) => {
    await tx.softoneItem.deleteMany({});
    let n = 0;
    for (let i = 0; i < data.length; i += 1000) {
      const res = await tx.softoneItem.createMany({ data: data.slice(i, i + 1000) });
      n += res.count;
    }
    return n;
  }, { timeout: 30000 });

  const products = data.filter((d) => !d.isService).length;
  const services = data.length - products;
  const now = new Date().toISOString();
  await setSetting('integrations.softoneItemsLastSync', now, u.id);
  await logAudit({
    userId: u.id, userEmail: u.email,
    action: 'metadata.items.sync_softone', resource: 'setting', metadata: { total: result, products, services },
  });

  return NextResponse.json({ ok: true, total: result, products, services, syncedAt: now });
}
