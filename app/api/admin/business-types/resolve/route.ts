import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { resolveBusinessTypeId } from '@/lib/companies/business-type';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Re-resolves businessTypeId for all companies that are NOT manually overridden.
export async function POST() {
  await requirePermission('metadata.manage');
  const catalog = await prisma.businessType.findMany({ select: { id: true, code: true } });
  const companies = await prisma.company.findMany({
    where: { businessTypeOverride: false },
    select: { id: true, legalForm: true, businessTypeId: true, legalTypeRef: { select: { descr: true } } },
  });
  let changed = 0;
  for (const c of companies) {
    const next = resolveBusinessTypeId(
      { legalForm: c.legalForm, legalTypeDescr: c.legalTypeRef?.descr ?? null, businessTypeId: c.businessTypeId, businessTypeOverride: false },
      catalog,
    );
    if (next !== c.businessTypeId) { await prisma.company.update({ where: { id: c.id }, data: { businessTypeId: next } }); changed++; }
  }
  return NextResponse.json({ ok: true, changed });
}
