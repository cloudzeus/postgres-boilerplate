import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { softoneFetchLookups } from '@/lib/softone';
import { setSetting } from '@/lib/settings';
import { logAudit } from '@/lib/audit';

// Pulls all SoftOne aux/classification tables (VAT, units, groups, categories,
// manufacturers, brands) into the SoftoneLookup registry for general reuse.
export async function POST() {
  const u = await requirePermission('metadata.manage');

  let rows;
  try {
    rows = await softoneFetchLookups();
  } catch (e) {
    return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status: 502 });
  }
  if (rows.length === 0) {
    return NextResponse.json({ error: 'softone_error', message: 'Δεν επιστράφηκαν πίνακες' }, { status: 502 });
  }

  const data = rows.map((r, i) => ({ kind: r.kind, code: r.code, name: r.name, order: i }));
  const total = await prisma.$transaction(async (tx) => {
    await tx.softoneLookup.deleteMany({});
    let n = 0;
    for (let i = 0; i < data.length; i += 1000) {
      const res = await tx.softoneLookup.createMany({ data: data.slice(i, i + 1000) });
      n += res.count;
    }
    return n;
  }, { timeout: 30000 });

  const byKind = rows.reduce<Record<string, number>>((a, r) => { a[r.kind] = (a[r.kind] ?? 0) + 1; return a; }, {});
  const now = new Date().toISOString();
  await setSetting('integrations.softoneLookupsLastSync', now, u.id);
  await logAudit({ userId: u.id, userEmail: u.email, action: 'metadata.lookups.sync_softone', resource: 'setting', metadata: { total, byKind } });

  return NextResponse.json({ ok: true, total, byKind, syncedAt: now });
}
