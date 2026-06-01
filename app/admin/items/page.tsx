import { FiBox } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission, hasPermission } from '@/lib/rbac';
import { getSetting } from '@/lib/settings';
import { PageHeader } from '@/components/admin/page-header';
import { ItemsTableClient } from '@/components/admin/items-table-client';

export const dynamic = 'force-dynamic';

export default async function ItemsPage() {
  await requirePermission('metadata.read');
  const [rows, canManage, lastSync] = await Promise.all([
    prisma.softoneItem.findMany({ where: { isService: false }, orderBy: { name: 'asc' } }),
    hasPermission('metadata.manage'),
    getSetting<string>('integrations.softoneItemsLastSync'),
  ]);

  return (
    <div className="w-full">
      <PageHeader
        icon={<FiBox />}
        title="Είδη"
        description={`Μητρώο ειδών/προϊόντων από SoftOne (${rows.length.toLocaleString('el-GR')}).`}
        helpAnchor="items"
      />
      <ItemsTableClient rows={rows} variant="products" canManage={canManage} lastSync={lastSync ?? null} />
    </div>
  );
}
