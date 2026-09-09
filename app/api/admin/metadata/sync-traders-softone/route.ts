import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { softoneFetchTraders } from '@/lib/softone';
import { setSetting } from '@/lib/settings';
import { logAudit } from '@/lib/audit';

// Pulls every συναλλασσόμενος (TRDR SODTYPE 12–16) of the session company from
// SoftOne and fully replaces the SoftoneTrader mirror. Hidden entries
// («(Α)», «ΥΠΟ ΕΚΚΑΘΑΡΙΣΗ») are already dropped by the fetcher.
export async function POST() {
  const u = await requirePermission('metadata.manage');

  let rows;
  try {
    rows = await softoneFetchTraders();
  } catch (e) {
    return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status: 502 });
  }
  if (rows.length === 0) {
    return NextResponse.json({ error: 'softone_error', message: 'Δεν επιστράφηκαν συναλλασσόμενοι' }, { status: 502 });
  }

  const data = rows.map((r) => ({
    trdr: r.trdr, sodtype: r.sodtype, kind: r.kind, code: r.code, name: r.name || r.code,
    afm: r.afm, doy: r.doy, profession: r.profession,
    address: r.address, district: r.district, zip: r.zip, city: r.city,
    phone: r.phone, phone2: r.phone2, fax: r.fax, email: r.email, webpage: r.webpage, isActive: r.isActive,
  }));

  const total = await prisma.$transaction(async (tx) => {
    await tx.softoneTrader.deleteMany({});
    let n = 0;
    for (let i = 0; i < data.length; i += 1000) {
      const res = await tx.softoneTrader.createMany({ data: data.slice(i, i + 1000) });
      n += res.count;
    }
    return n;
  }, { timeout: 60000 });

  const byType: Record<string, number> = {};
  for (const r of rows) byType[r.kind] = (byType[r.kind] ?? 0) + 1;

  const now = new Date().toISOString();
  await setSetting('integrations.softoneTradersLastSync', now, u.id);
  await logAudit({
    userId: u.id, userEmail: u.email,
    action: 'metadata.traders.sync_softone', resource: 'setting', metadata: { total, byType },
  });

  return NextResponse.json({ ok: true, total, byType, syncedAt: now });
}
