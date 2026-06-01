import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { softoneFetchPurchaseDocTypes } from '@/lib/softone';
import { setSetting } from '@/lib/settings';
import { logAudit } from '@/lib/audit';

// Pulls active purchase-document SERIES from SoftOne and upserts them into the
// PurchaseDocType reference registry, keyed by the SoftOne SERIES code.
export async function POST() {
  const u = await requirePermission('metadata.manage');

  let rows;
  try {
    rows = await softoneFetchPurchaseDocTypes();
  } catch (e) {
    return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status: 502 });
  }

  const existingCodes = new Set(
    (await prisma.purchaseDocType.findMany({ select: { code: true } })).map((v) => v.code),
  );
  const activeCodes = new Set(rows.map((r) => r.code).filter(Boolean));

  let created = 0;
  let updated = 0;
  for (const r of rows) {
    if (!r.code) continue;
    const orderNum = Number.isFinite(Number(r.code)) ? Number(r.code) : 0;
    await prisma.purchaseDocType.upsert({
      where: { code: r.code },
      update: { abbrev: r.abbrev, name: r.name || r.code, section: r.section, isActive: true, order: orderNum },
      create: { code: r.code, abbrev: r.abbrev, name: r.name || r.code, section: r.section, isActive: true, order: orderNum },
    });
    if (existingCodes.has(r.code)) updated++; else created++;
  }
  const total = created + updated;

  // Prune anything no longer returned as an active purchase series.
  // Guard: skip pruning if SoftOne returned nothing (avoids wiping the registry).
  let removed = 0;
  if (activeCodes.size > 0) {
    const res = await prisma.purchaseDocType.deleteMany({
      where: { code: { notIn: Array.from(activeCodes) } },
    });
    removed = res.count;
  }

  const now = new Date().toISOString();
  await setSetting('integrations.softonePurdocLastSync', now, u.id);

  await logAudit({
    userId: u.id, userEmail: u.email,
    action: 'metadata.purdoc.sync_softone', resource: 'setting',
    metadata: { total, created, updated, removed },
  });

  return NextResponse.json({ ok: true, total, created, updated, removed, syncedAt: now });
}
