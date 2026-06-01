import { FiFileText } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission, hasPermission } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';
import { DocumentTypesClient, type DocumentTypeRow } from './document-types-client';

export const dynamic = 'force-dynamic';

export default async function DocumentTypesPage() {
  await requirePermission('metadata.read');
  const canManage = await hasPermission('metadata.manage');
  const types = await prisma.documentType.findMany({ orderBy: [{ order: 'asc' }, { name: 'asc' }] });
  const rows: DocumentTypeRow[] = types.map((t) => ({
    id: t.id, name: t.name, description: t.description, category: t.category,
    requiresExpiry: t.requiresExpiry, notifyExpiry: t.notifyExpiry, active: t.active, order: t.order,
  }));
  return (
    <div className="w-full">
      <PageHeader
        icon={<FiFileText />}
        title="Τύποι Δικαιολογητικών"
        description="Κατάλογος τύπων δικαιολογητικών που χρησιμοποιούνται σε όλα τα προγράμματα και τις εταιρίες."
        helpAnchor="document-types"
      />
      <DocumentTypesClient rows={rows} canManage={canManage} />
    </div>
  );
}
