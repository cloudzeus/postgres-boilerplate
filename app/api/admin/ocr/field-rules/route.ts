import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  await requirePermission('ocr.read');
  const rules = await prisma.supplierFieldRule.findMany({
    orderBy: [{ supplierName: 'asc' }, { vatNumber: 'asc' }, { docType: 'asc' }, { label: 'asc' }],
  });
  return NextResponse.json({ data: rules });
}
