import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAnyPermission } from '@/lib/rbac';

// Combo-box options for the create-item form, from the local SoftoneLookup registry.
export async function GET() {
  await requireAnyPermission('ocr.read', 'ocr.categorize', 'metadata.read');
  const rows = await prisma.softoneLookup.findMany({ orderBy: { order: 'asc' }, select: { kind: true, code: true, name: true } });
  const group = (kind: string) => rows.filter((r) => r.kind === kind).map((r) => ({ id: r.code, name: r.name }));
  return NextResponse.json({
    vats: group('VAT'),
    units: group('MTRUNIT'),
    groups: group('MTRGROUP'),
    categories: group('MTRCATEGORY'),
    manufacturers: group('MTRMANFCTR'),
    brands: group('MTRMARK'),
  });
}
