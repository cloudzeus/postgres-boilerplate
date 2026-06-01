import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { softoneFetchVatCategories } from '@/lib/softone';
import { setSetting } from '@/lib/settings';
import { logAudit } from '@/lib/audit';

// Pulls all VAT categories from SoftOne (object VAT) and upserts them into the
// VatCategory reference registry, keyed by the SoftOne VAT code.
export async function POST() {
  const u = await requirePermission('metadata.manage');

  let rows;
  try {
    rows = await softoneFetchVatCategories();
  } catch (e) {
    return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status: 502 });
  }

  // Snapshot current registry (with company-reference counts) before syncing.
  const before = await prisma.vatCategory.findMany({
    select: { code: true, _count: { select: { companies: true } } },
  });
  const existingCodes = new Set(before.map((v) => v.code));
  const activeCodes = new Set(rows.map((r) => r.code).filter(Boolean));

  let created = 0;
  let updated = 0;
  for (const r of rows) {
    if (!r.code) continue;
    const orderNum = Number.isFinite(Number(r.code)) ? Number(r.code) : 0;
    await prisma.vatCategory.upsert({
      where: { code: r.code },
      update: { descr: r.name || r.code, rate: r.percent, isActive: true, order: orderNum },
      create: { code: r.code, descr: r.name || r.code, rate: r.percent, isActive: true, order: orderNum },
    });
    if (existingCodes.has(r.code)) updated++; else created++;
  }
  const total = created + updated;

  // Prune everything that is no longer an active SoftOne category:
  // delete if unused, soft-disable if a company still references it.
  let removed = 0;
  let disabled = 0;
  for (const v of before) {
    if (activeCodes.has(v.code)) continue;
    if (v._count.companies === 0) {
      await prisma.vatCategory.delete({ where: { code: v.code } });
      removed++;
    } else {
      await prisma.vatCategory.update({ where: { code: v.code }, data: { isActive: false } });
      disabled++;
    }
  }

  const now = new Date().toISOString();
  await setSetting('integrations.softoneVatLastSync', now, u.id);

  await logAudit({
    userId: u.id, userEmail: u.email,
    action: 'metadata.vat.sync_softone', resource: 'setting',
    metadata: { total, created, updated, removed, disabled },
  });

  return NextResponse.json({ ok: true, total, created, updated, removed, disabled, syncedAt: now });
}
