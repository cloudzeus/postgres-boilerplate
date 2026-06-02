import { FiBriefcase } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission, hasPermission } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';
import { BusinessTypesClient, type BusinessTypeRow } from './business-types-client';

export const dynamic = 'force-dynamic';

export default async function BusinessTypesPage() {
  await requirePermission('metadata.read');
  const canManage = await hasPermission('metadata.manage');
  const types = await prisma.businessType.findMany({ orderBy: [{ order: 'asc' }, { name: 'asc' }] });
  const rows: BusinessTypeRow[] = types.map((t) => ({ id: t.id, code: t.code, name: t.name, order: t.order, active: t.active }));
  return (
    <div className="w-full">
      <PageHeader
        icon={<FiBriefcase />}
        title="Νομικές Μορφές"
        description="Κατάλογος νομικών μορφών επιχειρήσεων. Χρησιμοποιείται για να ζητούνται τα σωστά δικαιολογητικά ανά τύπο εταιρίας."
        helpAnchor="business-types"
      />
      <BusinessTypesClient rows={rows} canManage={canManage} />
    </div>
  );
}
