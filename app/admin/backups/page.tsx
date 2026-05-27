import { FiDatabase } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { getSetting } from '@/lib/settings';
import { PageHeader } from '@/components/admin/page-header';
import { BackupsClient } from './backups-client';

export const dynamic = 'force-dynamic';

export default async function BackupsPage() {
  await requirePermission('system.backups');
  const rows = await prisma.dbBackup.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  const retention = Number((await getSetting<number>('backups.retentionDays')) ?? 30);
  const enabled = (await getSetting<boolean>('backups.enabled')) ?? true;

  const backups = rows.map((b) => ({
    id: b.id,
    filename: b.filename,
    sizeBytes: Number(b.sizeBytes),
    status: b.status,
    trigger: b.trigger,
    errorMessage: b.errorMessage,
    createdAt: b.createdAt.toISOString(),
  }));

  return (
    <div className="w-full max-w-5xl">
      <PageHeader
        icon={<FiDatabase />}
        title="Database backups"
        description={`Ημερήσιο αυτόματο backup PostgreSQL → BunnyCDN. Διατήρηση: ${retention} αρχεία. Αυτόματο: ${enabled ? 'ενεργό' : 'ανενεργό'}.`}
      />
      <BackupsClient backups={backups} retention={retention} />
    </div>
  );
}
