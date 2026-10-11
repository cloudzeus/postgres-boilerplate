import { requirePermission, hasPermission } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';
import { loadChartRows, loadMissingAccounts, loadUtilityGaps } from '@/lib/ocr/accounts-overview';
import { AccountsClient } from './accounts-client';

export const dynamic = 'force-dynamic';

/**
 * ΛΟΓΙΣΤΙΚΟ ΣΧΕΔΙΟ — τι λείπει για να καταχωριστούν τα ανοιχτά παραστατικά, ποιες χρεώσεις
 * λογαριασμών κοινής ωφέλειας δεν έχουν ακόμη χρεοπίστωση, και ολόκληρο το σχέδιο του SoftOne.
 */
export default async function AccountsPage() {
  await requirePermission('metadata.read');
  const [missing, gaps, chart, canSync] = await Promise.all([
    loadMissingAccounts(), loadUtilityGaps(), loadChartRows(), hasPermission('metadata.manage'),
  ]);
  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title="Λογιστικό σχέδιο"
        description="Λογαριασμοί που λείπουν για τα ανοιχτά παραστατικά, χρεώσεις χωρίς χρεοπίστωση και όλο το σχέδιο του SoftOne."
        helpAnchor="accounts-chart"
      />
      <AccountsClient
        missing={missing.rows}
        chartSynced={missing.chartSynced}
        gaps={gaps}
        chart={chart.rows}
        syncedAt={chart.syncedAt?.toISOString() ?? null}
        canSync={canSync}
      />
    </div>
  );
}
