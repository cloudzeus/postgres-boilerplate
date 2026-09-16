import { FiDatabase } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission, hasPermission } from '@/lib/rbac';
import { getSetting } from '@/lib/settings';
import { PageHeader } from '@/components/admin/page-header';
import { ReferenceDataClient } from './reference-data-client';

export const dynamic = 'force-dynamic';

export default async function ReferenceDataPage() {
  await requirePermission('metadata.read');
  const [legalTypes, gemiOffices, companyStatuses, prefectures, municipalities, vatCategories, purchaseDocTypes, tradersCount, lookupsCount, kadCount, kadLicenseTotal, kadLicenseRoots] = await Promise.all([
    prisma.legalType.aggregate({ _count: { _all: true }, _max: { lastUpdated: true } }),
    prisma.gemiOfficeRef.aggregate({ _count: { _all: true }, _max: { lastUpdated: true } }),
    prisma.companyStatusRef.aggregate({ _count: { _all: true }, _max: { lastUpdated: true } }),
    prisma.prefecture.aggregate({ _count: { _all: true }, _max: { lastUpdated: true } }),
    prisma.municipality.aggregate({ _count: { _all: true }, _max: { lastUpdated: true } }),
    prisma.vatCategory.count(),
    prisma.purchaseDocType.count(),
    prisma.softoneTrader.count(),
    prisma.softoneLookup.count(),
    prisma.kadCode.count(),
    prisma.kadLicenseRequirement.count({ where: { licenseType: 'OPERATING_LICENSE' } }),
    prisma.kadLicenseRequirement.count({ where: { licenseType: 'OPERATING_LICENSE', inherited: false } }),
  ]);
  const canManage = await hasPermission('metadata.manage');
  const vatLastSync = await getSetting<string>('integrations.softoneVatLastSync');
  const purdocLastSync = await getSetting<string>('integrations.softonePurdocLastSync');
  const docSeriesLastSync = await getSetting<string>('integrations.softoneDocSeriesLastSync');
  const docSeriesCount = await prisma.softoneDocSeries.count();
  const expensesCount = await prisma.softoneExpense.count();
  const expensesLastSync = await getSetting<string>('integrations.softoneExpensesLastSync');
  const tradersLastSync = await getSetting<string>('integrations.softoneTradersLastSync');
  const lookupsLastSync = await getSetting<string>('integrations.softoneLookupsLastSync');

  return (
    <div className="w-full">
      <PageHeader
        icon={<FiDatabase />}
        title="Μητρώα αναφοράς"
        description="Lookup tables που τροφοδοτούν αναζητήσεις και autocomplete. Τα ΓΕΜΗ metadata ανανεώνονται από Open Data ΓΕΜΗ."
        helpAnchor="softone-resync"
      />
      <ReferenceDataClient
        canManage={canManage}
        stats={[
          { key: 'legalTypes', label: 'Νομικές μορφές', count: legalTypes._count._all, lastUpdated: legalTypes._max.lastUpdated?.toISOString() ?? null, source: 'ΓΕΜΗ', syncKind: 'gemi' },
          { key: 'gemiOffices', label: 'Υπηρεσίες ΓΕΜΗ', count: gemiOffices._count._all, lastUpdated: gemiOffices._max.lastUpdated?.toISOString() ?? null, source: 'ΓΕΜΗ', syncKind: 'gemi' },
          { key: 'companyStatuses', label: 'Καταστάσεις εταιρίας', count: companyStatuses._count._all, lastUpdated: companyStatuses._max.lastUpdated?.toISOString() ?? null, source: 'ΓΕΜΗ', syncKind: 'gemi' },
          { key: 'prefectures', label: 'Νομοί', count: prefectures._count._all, lastUpdated: prefectures._max.lastUpdated?.toISOString() ?? null, source: 'ΓΕΜΗ', viewHref: '/admin/regions', syncKind: 'gemi' },
          { key: 'municipalities', label: 'Δήμοι', count: municipalities._count._all, lastUpdated: municipalities._max.lastUpdated?.toISOString() ?? null, source: 'ΓΕΜΗ', viewHref: '/admin/regions', syncKind: 'gemi' },
          { key: 'vatCategories', label: 'Κατηγορίες ΦΠΑ', count: vatCategories, lastUpdated: vatLastSync ?? null, source: vatLastSync ? 'SoftOne' : 'Manual', syncKind: 'vat' },
          { key: 'purchaseDocTypes', label: 'Τύποι παραστατικών αγορών', count: purchaseDocTypes, lastUpdated: purdocLastSync ?? null, source: 'SoftOne', syncKind: 'purdoc' },
          { key: 'docSeries', label: 'Σειρές παραστατικών (έξοδα, εισπράξεις, πληρωμές…)', count: docSeriesCount, lastUpdated: docSeriesLastSync ?? null, source: 'SoftOne', syncKind: 'docseries', viewHref: '/admin/doc-series' },
          { key: 'traders', label: 'Συναλλασσόμενοι (πελάτες, προμηθευτές, χρεώστες, πιστωτές)', count: tradersCount, lastUpdated: tradersLastSync ?? null, source: 'SoftOne', syncKind: 'traders', viewHref: '/admin/traders' },
          { key: 'expenses', label: 'Έξοδα SoftOne (EXPN)', count: expensesCount, lastUpdated: expensesLastSync ?? null, source: 'SoftOne', syncKind: 'expenses' },
          { key: 'lookups', label: 'Βοηθητικοί πίνακες (ΦΠΑ/μονάδες/ομάδες…)', count: lookupsCount, lastUpdated: lookupsLastSync ?? null, source: 'SoftOne', syncKind: 'lookups' },
          { key: 'kadCodes', label: 'Μητρώο ΚΑΔ', count: kadCount, lastUpdated: null, source: 'Auto (από lookups)', viewHref: '/admin/kad-codes' },
          { key: 'kadLicense', label: `ΚΑΔ με άδεια λειτουργίας (από ${kadLicenseRoots} ρίζες)`, count: kadLicenseTotal, lastUpdated: null, source: 'NF BUSNESS.xlsx', viewHref: '/admin/kad-codes' },
        ]}
      />
    </div>
  );
}
