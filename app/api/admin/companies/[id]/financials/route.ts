import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requirePermission('ocr.read');
  const { id: companyId } = await params;

  const values = await prisma.companyFinancialValue.findMany({
    where: { companyId },
    orderBy: [{ fieldKey: 'asc' }, { year: 'desc' }],
  });

  return NextResponse.json(values);
}
