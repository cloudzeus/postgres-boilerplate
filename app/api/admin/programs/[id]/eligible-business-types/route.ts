import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { eligibleBusinessTypeIds } from '@/lib/programs/eligible-business-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('programs.read');
  const { id } = await params;
  const [forms, catalog] = await Promise.all([
    prisma.programEligibleLegalForm.findMany({ where: { programId: id }, select: { name: true } }),
    prisma.businessType.findMany({ where: { active: true }, orderBy: [{ order: 'asc' }, { name: 'asc' }], select: { id: true, code: true, name: true } }),
  ]);
  const eligibleIds = eligibleBusinessTypeIds(forms.map((f) => f.name), catalog);
  // If the scan produced no recognisable forms, fall back to the whole active catalog.
  const options = eligibleIds.size ? catalog.filter((b) => eligibleIds.has(b.id)) : catalog;
  return NextResponse.json({ data: options, derivedFromScan: eligibleIds.size > 0 });
}
