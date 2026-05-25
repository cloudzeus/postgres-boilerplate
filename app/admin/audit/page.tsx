import { FiActivity } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';
import { AuditTable } from './audit-table';

export default async function AuditPage() {
  await requirePermission('system.audit');
  const entries = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  const rows = entries.map((e) => ({
    id: e.id,
    userEmail: e.userEmail ?? '—',
    action: e.action,
    resource: e.resource,
    resourceId: e.resourceId ?? '',
    metadata: e.metadata ? JSON.stringify(e.metadata) : '',
    ip: e.ip ?? '',
    createdAt: e.createdAt.toISOString(),
  }));
  return (
    <div className="w-full">
      <PageHeader icon={<FiActivity />} title="Audit log" description="Καταγραφή ενεργειών χρηστών (τελευταίες 500)." />
      <AuditTable rows={rows} />
    </div>
  );
}
