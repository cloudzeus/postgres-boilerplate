import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

// Returns all small lookup tables for autocomplete/selects in forms.
// Large lookups (municipalities ~330) included; callers should debounce-search client-side.
export async function GET() {
  await requirePermission('companies.read');
  const [legalTypes, gemiOffices, companyStatuses, prefectures, municipalities, vatCategories] = await Promise.all([
    prisma.legalType.findMany({ orderBy: { descr: 'asc' }, select: { id: true, descr: true } }),
    prisma.gemiOfficeRef.findMany({ orderBy: { descr: 'asc' }, select: { id: true, descr: true } }),
    prisma.companyStatusRef.findMany({ orderBy: { descr: 'asc' }, select: { id: true, descr: true, isActive: true } }),
    prisma.prefecture.findMany({ orderBy: { descr: 'asc' }, select: { id: true, descr: true } }),
    prisma.municipality.findMany({ orderBy: { descr: 'asc' }, select: { id: true, descr: true, prefectureId: true } }),
    prisma.vatCategory.findMany({ where: { isActive: true }, orderBy: { order: 'asc' }, select: { id: true, code: true, descr: true, rate: true } }),
  ]);
  return NextResponse.json({ legalTypes, gemiOffices, companyStatuses, prefectures, municipalities, vatCategories });
}
