import { FiList } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission, hasPermission } from '@/lib/rbac';
import { getSetting } from '@/lib/settings';
import { PageHeader } from '@/components/admin/page-header';
import { DocSeriesTabs, type DocSeriesRecord } from '@/components/admin/doc-series-tabs';

export const dynamic = 'force-dynamic';

// Σειρές παραστατικών SoftOne (πίνακας SERIES) για όλες τις ενότητες — ένα tab ανά ενότητα.
export default async function DocSeriesPage() {
  await requirePermission('metadata.read');
  const [rows, purchases, canManage, lastSync] = await Promise.all([
    prisma.softoneDocSeries.findMany({ orderBy: [{ sosource: 'asc' }, { order: 'asc' }, { code: 'asc' }] }),
    prisma.purchaseDocType.findMany({ orderBy: [{ order: 'asc' }, { code: 'asc' }] }),
    hasPermission('metadata.manage'),
    getSetting<string>('integrations.softoneDocSeriesLastSync'),
  ]);

  // Purchase series live in their own registry (PurchaseDocType, SOSOURCE 1251) because the
  // OCR posting flow depends on it; surface them here too so «Αγορές» shows every series.
  const records: DocSeriesRecord[] = [
    ...purchases.map((r) => ({
      id: r.id,
      source: 'purchase' as const,
      sosource: 1251,
      family: 'Παραστατικά αγορών',
      code: r.code,
      abbrev: r.abbrev,
      name: r.name,
      section: r.section,
      isActive: r.isActive,
      enabled: r.enabled,
    })),
    ...rows.map((r) => ({
      id: r.id,
      source: 'series' as const,
      sosource: r.sosource,
      family: r.family,
      code: r.code,
      abbrev: r.abbrev,
      name: r.name,
      section: r.section,
      isActive: r.isActive,
      enabled: r.enabled,
    })),
  ].sort((a, b) => a.sosource - b.sosource || a.code.localeCompare(b.code, 'el', { numeric: true }));
  const families = new Set(records.map((r) => r.sosource)).size;

  const enabledCount = records.filter((r) => r.enabled).length;

  return (
    <div className="w-full">
      <PageHeader
        icon={<FiList />}
        title="Σειρές παραστατικών"
        description={`${records.length.toLocaleString('el-GR')} σειρές SoftOne σε ${families} ενότητες · ${enabledCount.toLocaleString('el-GR')} σε χρήση.`}
        helpAnchor="doc-series"
      />
      <DocSeriesTabs rows={records} canManage={canManage} lastSync={lastSync ?? null} />
    </div>
  );
}
