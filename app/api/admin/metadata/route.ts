import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

export async function GET() {
  await requirePermission('metadata.read');
  const [legalTypes, gemiOffices, companyStatuses, prefectures, municipalities] = await Promise.all([
    prisma.legalType.aggregate({ _count: { _all: true }, _max: { lastUpdated: true } }),
    prisma.gemiOfficeRef.aggregate({ _count: { _all: true }, _max: { lastUpdated: true } }),
    prisma.companyStatusRef.aggregate({ _count: { _all: true }, _max: { lastUpdated: true } }),
    prisma.prefecture.aggregate({ _count: { _all: true }, _max: { lastUpdated: true } }),
    prisma.municipality.aggregate({ _count: { _all: true }, _max: { lastUpdated: true } }),
  ]);
  return NextResponse.json({
    counts: {
      legalTypes: legalTypes._count._all,
      gemiOffices: gemiOffices._count._all,
      companyStatuses: companyStatuses._count._all,
      prefectures: prefectures._count._all,
      municipalities: municipalities._count._all,
    },
    lastUpdated: {
      legalTypes: legalTypes._max.lastUpdated,
      gemiOffices: gemiOffices._max.lastUpdated,
      companyStatuses: companyStatuses._max.lastUpdated,
      prefectures: prefectures._max.lastUpdated,
      municipalities: municipalities._max.lastUpdated,
    },
  });
}
