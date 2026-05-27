import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { formatKadDots, stripKadDots } from '@/lib/kad/resolve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One-shot maintenance:
 *   1. Normalize every CompanyActivity.code to canonical dotted form ("56.10.11.04").
 *   2. Backfill codeWithoutDots whenever missing/empty.
 *   3. Ensure each company has at least one PRIMARY activity (promotes the
 *      lowest-order row if none is flagged).
 * Idempotent — safe to run multiple times.
 */
export async function POST() {
  await requirePermission('kad.manage');

  const rows = await prisma.companyActivity.findMany({
    select: { id: true, companyId: true, code: true, codeWithoutDots: true, kind: true, order: true },
    orderBy: [{ companyId: 'asc' }, { order: 'asc' }],
  });

  let codeUpdated = 0;
  let digitsUpdated = 0;

  for (const r of rows) {
    const patch: { code?: string; codeWithoutDots?: string } = {};
    if (r.code) {
      const dotted = formatKadDots(r.code);
      if (dotted !== r.code) patch.code = dotted;
    }
    const digits = stripKadDots(r.code ?? '');
    if (digits && r.codeWithoutDots !== digits) patch.codeWithoutDots = digits;
    if (Object.keys(patch).length) {
      await prisma.companyActivity.update({ where: { id: r.id }, data: patch });
      if (patch.code) codeUpdated += 1;
      if (patch.codeWithoutDots) digitsUpdated += 1;
    }
  }

  // Ensure PRIMARY per company.
  const byCompany = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = byCompany.get(r.companyId) ?? [];
    arr.push(r);
    byCompany.set(r.companyId, arr);
  }
  let primaryPromoted = 0;
  for (const [, activities] of byCompany) {
    if (activities.length === 0) continue;
    if (activities.some((a) => a.kind === 'PRIMARY')) continue;
    const first = activities[0];
    await prisma.companyActivity.update({
      where: { id: first.id },
      data: { kind: 'PRIMARY' },
    });
    primaryPromoted += 1;
  }

  return NextResponse.json({
    scanned: rows.length,
    codeUpdated,
    digitsUpdated,
    primaryPromoted,
  });
}
