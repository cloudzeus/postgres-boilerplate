import { FiUserCheck } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission, hasPermission } from '@/lib/rbac';
import { getSetting } from '@/lib/settings';
import { PageHeader } from '@/components/admin/page-header';
import { TrdrTableClient } from '@/components/admin/trdr-table-client';

export const dynamic = 'force-dynamic';

export default async function CustomersPage() {
  await requirePermission('metadata.read');
  const [rows, canManage, lastSync] = await Promise.all([
    prisma.softoneCustomer.findMany({ orderBy: { name: 'asc' } }),
    hasPermission('metadata.manage'),
    getSetting<string>('integrations.softoneCustomersLastSync'),
  ]);

  return (
    <div className="w-full">
      <PageHeader
        icon={<FiUserCheck />}
        title="Πελάτες"
        description={`Μητρώο πελατών από SoftOne (${rows.length.toLocaleString('el-GR')} ενεργοί).`}
        helpAnchor="customers"
      />
      <TrdrTableClient
        rows={rows}
        syncEntity="customers"
        canManage={canManage}
        lastSync={lastSync ?? null}
      />
    </div>
  );
}
