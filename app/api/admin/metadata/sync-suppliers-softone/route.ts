import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { softoneFetchSuppliers } from '@/lib/softone';
import { setSetting } from '@/lib/settings';
import { logAudit } from '@/lib/audit';

// Pulls all suppliers from SoftOne (TRDR SODTYPE=12) via GetTable and fully
// replaces the SoftoneSupplier mirror registry.
export async function POST() {
  const u = await requirePermission('metadata.manage');

  let rows;
  try {
    rows = await softoneFetchSuppliers();
  } catch (e) {
    return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status: 502 });
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: 'softone_error', message: 'Δεν επιστράφηκαν προμηθευτές' }, { status: 502 });
  }

  const data = rows.map((r) => ({
    trdr: r.trdr, code: r.code, name: r.name || r.code, kind: r.kind, afm: r.afm, doy: r.doy, profession: r.profession,
    address: r.address, district: r.district, zip: r.zip, city: r.city,
    phone: r.phone, phone2: r.phone2, fax: r.fax, email: r.email, webpage: r.webpage, isActive: r.isActive,
  }));

  const total = await prisma.$transaction(async (tx) => {
    await tx.softoneSupplier.deleteMany({});
    let n = 0;
    for (let i = 0; i < data.length; i += 1000) {
      const res = await tx.softoneSupplier.createMany({ data: data.slice(i, i + 1000) });
      n += res.count;
    }
    return n;
  }, { timeout: 30000 });

  const now = new Date().toISOString();
  await setSetting('integrations.softoneSuppliersLastSync', now, u.id);
  await logAudit({
    userId: u.id, userEmail: u.email,
    action: 'metadata.suppliers.sync_softone', resource: 'setting', metadata: { total },
  });

  return NextResponse.json({ ok: true, total, syncedAt: now });
}
