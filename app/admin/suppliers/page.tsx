import { FiTruck } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission, hasPermission } from '@/lib/rbac';
import { getSetting } from '@/lib/settings';
import { PageHeader } from '@/components/admin/page-header';
import { TrdrTableClient } from '@/components/admin/trdr-table-client';

export const dynamic = 'force-dynamic';

export default async function SuppliersPage() {
  await requirePermission('metadata.read');
  const [rows, canManage, lastSync] = await Promise.all([
    prisma.softoneSupplier.findMany({ orderBy: { name: 'asc' } }),
    hasPermission('metadata.manage'),
    getSetting<string>('integrations.softoneSuppliersLastSync'),
  ]);

  return (
    <div className="w-full">
      <PageHeader
        icon={<FiTruck />}
        title="Προμηθευτές"
        description={`Μητρώο προμηθευτών από SoftOne (${rows.length.toLocaleString('el-GR')} ενεργοί).`}
        helpAnchor="suppliers"
      />
      <TrdrTableClient
        rows={rows}
        syncEntity="suppliers"
        canManage={canManage}
        lastSync={lastSync ?? null}
      />
    </div>
  );
}
