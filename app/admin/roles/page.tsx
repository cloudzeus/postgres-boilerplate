import { FiShield, FiPlus } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';
import { RolesList } from './roles-list';

export default async function RolesPage() {
  await requirePermission('roles.read');
  const [roles, permissions] = await Promise.all([
    prisma.role.findMany({
      orderBy: { order: 'asc' },
      include: {
        _count: { select: { users: true, permissions: true } },
        permissions: { select: { permissionId: true } },
      },
    }),
    prisma.permission.findMany({ orderBy: [{ resource: 'asc' }, { order: 'asc' }] }),
  ]);

  const items = roles.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description ?? '',
    isSystem: r.isSystem,
    order: r.order,
    userCount: r._count.users,
    permissionCount: r._count.permissions,
    permissionIds: r.permissions.map((p) => p.permissionId),
  }));

  return (
    <div className="w-full">
      <PageHeader
        icon={<FiShield />}
        title="Ρόλοι"
        description="Σύρε για να αλλάξεις την σειρά προτεραιότητας. Πάτα έναν ρόλο για διαχείριση δικαιωμάτων."
      />
      <RolesList items={items} permissions={permissions.map((p) => ({
        id: p.id, key: p.key, resource: p.resource, action: p.action, description: p.description,
      }))} />
    </div>
  );
}
