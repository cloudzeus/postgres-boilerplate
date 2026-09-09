import { FiUserCheck } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission, hasPermission } from '@/lib/rbac';
import { getSetting } from '@/lib/settings';
import { PageHeader } from '@/components/admin/page-header';
import { TradersView } from '@/components/admin/traders-view';

export const dynamic = 'force-dynamic';

// Συναλλασσόμενοι — ένα μητρώο για πελάτες, προμηθευτές, χρεώστες, πιστωτές και
// χρηματικούς λογαριασμούς (TRDR SODTYPE 12–16), όπως στο SoftOne.
export default async function TradersPage() {
  await requirePermission('metadata.read');
  const [rows, canManage, lastSync] = await Promise.all([
    prisma.softoneTrader.findMany({ orderBy: { name: 'asc' } }),
    hasPermission('metadata.manage'),
    getSetting<string>('integrations.softoneTradersLastSync'),
  ]);

  return (
    <div className="w-full">
      <PageHeader
        icon={<FiUserCheck />}
        title="Συναλλασσόμενοι"
        description={`Μητρώο συναλλασσομένων από SoftOne (${rows.length.toLocaleString('el-GR')} εγγραφές).`}
        helpAnchor="traders"
      />
      <TradersView rows={rows} canManage={canManage} lastSync={lastSync ?? null} />
    </div>
  );
}
