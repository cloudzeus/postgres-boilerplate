import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { softoneFetchDocSeries } from '@/lib/softone';
import { setSetting } from '@/lib/settings';
import { logAudit } from '@/lib/audit';

// Pulls every active document series (SERIES) from SoftOne for all ενότητες
// except purchases and upserts them into SoftoneDocSeries, keyed by
// (SOSOURCE, SERIES). Series no longer returned as active are pruned.
export async function POST() {
  const u = await requirePermission('metadata.manage');

  let rows;
  try {
    rows = await softoneFetchDocSeries();
  } catch (e) {
    return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status: 502 });
  }

  const existing = new Set(
    (await prisma.softoneDocSeries.findMany({ select: { sosource: true, code: true } }))
      .map((v) => `${v.sosource}:${v.code}`),
  );

  let created = 0;
  let updated = 0;
  for (const r of rows) {
    const orderNum = Number.isFinite(Number(r.code)) ? Number(r.code) : 0;
    await prisma.softoneDocSeries.upsert({
      where: { sosource_code: { sosource: r.sosource, code: r.code } },
      update: { family: r.family, abbrev: r.abbrev, name: r.name, section: r.section, isActive: true, order: orderNum },
      create: { sosource: r.sosource, family: r.family, code: r.code, abbrev: r.abbrev, name: r.name, section: r.section, isActive: true, order: orderNum },
    });
    if (existing.has(`${r.sosource}:${r.code}`)) updated++; else created++;
  }
  const total = created + updated;

  // Prune stale rows. Guard: never wipe the registry on an empty SoftOne answer.
  let removed = 0;
  if (rows.length > 0) {
    const keep = new Set(rows.map((r) => `${r.sosource}:${r.code}`));
    const all = await prisma.softoneDocSeries.findMany({ select: { id: true, sosource: true, code: true } });
    const staleIds = all.filter((v) => !keep.has(`${v.sosource}:${v.code}`)).map((v) => v.id);
    if (staleIds.length > 0) {
      const res = await prisma.softoneDocSeries.deleteMany({ where: { id: { in: staleIds } } });
      removed = res.count;
    }
  }

  const families = Array.from(new Set(rows.map((r) => r.family))).sort();
  const now = new Date().toISOString();
  await setSetting('integrations.softoneDocSeriesLastSync', now, u.id);

  await logAudit({
    userId: u.id, userEmail: u.email,
    action: 'metadata.docseries.sync_softone', resource: 'setting',
    metadata: { total, created, updated, removed, families },
  });

  return NextResponse.json({ ok: true, total, created, updated, removed, families, syncedAt: now });
}
