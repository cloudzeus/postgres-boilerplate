import { FiDatabase } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission, hasPermission } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';
import { ReferenceDataClient } from './reference-data-client';

export const dynamic = 'force-dynamic';

export default async function ReferenceDataPage() {
  await requirePermission('metadata.read');
  const [legalTypes, gemiOffices, companyStatuses, prefectures, municipalities, vatCategories, kadCount] = await Promise.all([
    prisma.legalType.aggregate({ _count: { _all: true }, _max: { lastUpdated: true } }),
    prisma.gemiOfficeRef.aggregate({ _count: { _all: true }, _max: { lastUpdated: true } }),
    prisma.companyStatusRef.aggregate({ _count: { _all: true }, _max: { lastUpdated: true } }),
    prisma.prefecture.aggregate({ _count: { _all: true }, _max: { lastUpdated: true } }),
    prisma.municipality.aggregate({ _count: { _all: true }, _max: { lastUpdated: true } }),
    prisma.vatCategory.count(),
    prisma.kadCode.count(),
  ]);
  const canManage = await hasPermission('metadata.manage');

  return (
    <div className="w-full">
      <PageHeader
        icon={<FiDatabase />}
        title="Μητρώα αναφοράς"
        description="Lookup tables που τροφοδοτούν αναζητήσεις και autocomplete. Τα ΓΕΜΗ metadata ανανεώνονται από Open Data ΓΕΜΗ."
      />
      <ReferenceDataClient
        canManage={canManage}
        stats={[
          { key: 'legalTypes', label: 'Νομικές μορφές', count: legalTypes._count._all, lastUpdated: legalTypes._max.lastUpdated?.toISOString() ?? null, source: 'ΓΕΜΗ' },
          { key: 'gemiOffices', label: 'Υπηρεσίες ΓΕΜΗ', count: gemiOffices._count._all, lastUpdated: gemiOffices._max.lastUpdated?.toISOString() ?? null, source: 'ΓΕΜΗ' },
          { key: 'companyStatuses', label: 'Καταστάσεις εταιρίας', count: companyStatuses._count._all, lastUpdated: companyStatuses._max.lastUpdated?.toISOString() ?? null, source: 'ΓΕΜΗ' },
          { key: 'prefectures', label: 'Νομοί', count: prefectures._count._all, lastUpdated: prefectures._max.lastUpdated?.toISOString() ?? null, source: 'ΓΕΜΗ' },
          { key: 'municipalities', label: 'Δήμοι', count: municipalities._count._all, lastUpdated: municipalities._max.lastUpdated?.toISOString() ?? null, source: 'ΓΕΜΗ' },
          { key: 'vatCategories', label: 'Κατηγορίες ΦΠΑ', count: vatCategories, lastUpdated: null, source: 'Manual' },
          { key: 'kadCodes', label: 'Μητρώο ΚΑΔ', count: kadCount, lastUpdated: null, source: 'Auto (από lookups)' },
        ]}
      />
    </div>
  );
}
