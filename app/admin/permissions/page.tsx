import { FiKey } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';
import { PermissionsList } from './permissions-list';

export default async function PermissionsPage() {
  await requirePermission('permissions.read');
  const permissions = await prisma.permission.findMany({
    orderBy: [{ resource: 'asc' }, { order: 'asc' }],
    include: { _count: { select: { roles: true } } },
  });

  const items = permissions.map((p) => ({
    id: p.id, key: p.key, resource: p.resource, action: p.action,
    description: p.description ?? '', order: p.order, roleCount: p._count.roles,
  }));

  return (
    <div className="w-full">
      <PageHeader
        icon={<FiKey />}
        title="Δικαιώματα"
        description="Όλα τα δικαιώματα του συστήματος, ομαδοποιημένα ανά πόρο. Σύρε για αναδιάταξη."
      />
      <PermissionsList items={items} />
    </div>
  );
}
