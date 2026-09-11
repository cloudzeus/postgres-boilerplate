import { FiBox } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission, hasPermission } from '@/lib/rbac';
import { getSetting } from '@/lib/settings';
import { PageHeader } from '@/components/admin/page-header';
import { ItemsTabs } from './items-tabs';

export const dynamic = 'force-dynamic';

export default async function ItemsPage() {
  await requirePermission('metadata.read');
  const [items, expenses, canManage, itemsLastSync, expensesLastSync] = await Promise.all([
    prisma.softoneItem.findMany({ orderBy: { name: 'asc' } }),
    prisma.softoneExpense.findMany({ orderBy: { name: 'asc' } }),
    hasPermission('metadata.manage'),
    getSetting<string>('integrations.softoneItemsLastSync'),
    getSetting<string>('integrations.softoneExpensesLastSync'),
  ]);
  const products = items.filter((i) => !i.isService);
  const services = items.filter((i) => i.isService);

  return (
    <div className="w-full">
      <PageHeader
        icon={<FiBox />}
        title="Είδη"
        description={`Μητρώα SoftOne: ${products.length.toLocaleString('el-GR')} είδη, ${services.length.toLocaleString('el-GR')} υπηρεσίες, ${expenses.length.toLocaleString('el-GR')} έξοδα.`}
        helpAnchor="items"
      />
      <ItemsTabs
        products={products}
        services={services}
        expenses={expenses.map((e) => ({ expn: e.expn, code: e.code, name: e.name, vat: e.vat, isActive: e.isActive }))}
        canManage={canManage}
        itemsLastSync={itemsLastSync ?? null}
        expensesLastSync={expensesLastSync ?? null}
      />
    </div>
  );
}
