import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { softoneFetchExpenses } from '@/lib/softone';
import { setSetting } from '@/lib/settings';
import { logAudit } from '@/lib/audit';

// Pulls the active expenses (object EXPENSES → table EXPN) from SoftOne and upserts
// them into the SoftoneExpense mirror. Rows that SoftOne no longer returns as active
// are deactivated locally (never deleted — invoice lines may still point at them).
export async function POST() {
  const u = await requirePermission('metadata.manage');

  let rows;
  try {
    rows = await softoneFetchExpenses();
  } catch (e) {
    return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status: 502 });
  }
  if (rows.length === 0) {
    return NextResponse.json({ error: 'softone_error', message: 'Δεν επιστράφηκαν έξοδα' }, { status: 502 });
  }

  const existing = new Set(
    (await prisma.softoneExpense.findMany({ select: { expn: true } })).map((v) => v.expn),
  );
  const activeExpn = rows.map((r) => r.expn);

  let created = 0;
  let updated = 0;
  const now = new Date();
  for (const r of rows) {
    await prisma.softoneExpense.upsert({
      where: { expn: r.expn },
      update: { code: r.code, name: r.name || r.code, vat: r.vat, isActive: true, syncedAt: now },
      create: { expn: r.expn, code: r.code, name: r.name || r.code, vat: r.vat, isActive: true, syncedAt: now },
    });
    if (existing.has(r.expn)) updated++; else created++;
  }
  const total = created + updated;

  // Deactivate whatever SoftOne stopped returning as active.
  const deactivated = (await prisma.softoneExpense.updateMany({
    where: { expn: { notIn: activeExpn }, isActive: true },
    data: { isActive: false },
  })).count;

  const syncedAt = now.toISOString();
  await setSetting('integrations.softoneExpensesLastSync', syncedAt, u.id);

  await logAudit({
    userId: u.id, userEmail: u.email,
    action: 'metadata.expenses.sync_softone', resource: 'setting',
    metadata: { total, created, updated, deactivated },
  });

  return NextResponse.json({ ok: true, total, created, updated, deactivated, syncedAt });
}
