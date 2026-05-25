import { FiUsers } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';
import { UsersTable } from './users-table';
import { NewUserButton } from './new-user-button';

export default async function AdminUsersPage() {
  await requirePermission('users.read');
  const [users, roles] = await Promise.all([
    prisma.user.findMany({ include: { role: true }, orderBy: { createdAt: 'desc' } }),
    prisma.role.findMany({ orderBy: { order: 'asc' } }),
  ]);

  const rows = users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name ?? '',
    roleId: u.roleId,
    roleName: u.role.name,
    isActive: u.isActive,
    preferredLocales: u.preferredLocales,
    emailVerified: u.emailVerified?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  }));

  const roleOptions = roles.map((r) => ({ id: r.id, name: r.name }));

  return (
    <div className="w-full">
      <PageHeader
        icon={<FiUsers />}
        title="Χρήστες"
        description="Διαχείριση χρηστών, ανάθεση ρόλων και κατάσταση λογαριασμού."
        actions={<NewUserButton roles={roleOptions} />}
      />
      <UsersTable rows={rows} roles={roleOptions} />
    </div>
  );
}
