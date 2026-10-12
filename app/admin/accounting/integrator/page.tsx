import { requirePermission, hasPermission } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';
import { loadIntegratorReport } from '@/lib/accounting/integrator';
import { IntegratorClient } from './integrator-client';

export const dynamic = 'force-dynamic';

/**
 * ΑΝΑΦΟΡΑ INTEGRATOR — ζωντανή: θέματα που ζήτησε ο λογιστής, ό,τι η εφαρμογή βλέπει ότι λείπει στο
 * SoftOne και ιστορικό αλλαγών της εγκατάστασης. Υπολογίζεται σε κάθε άνοιγμα (βλ. `lib/accounting/integrator.ts`).
 */
export default async function IntegratorReportPage() {
  await requirePermission('metadata.read');
  const [report, canResolve, canAdd] = await Promise.all([
    loadIntegratorReport(), hasPermission('metadata.manage'), hasPermission('ocr.categorize'),
  ]);
  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title="Αναφορά integrator"
        description="Τι πρέπει να γίνει στο SoftOne: αιτήματα του λογιστή, αυτόματοι έλεγχοι και αλλαγές της εγκατάστασης από την εφαρμογή."
        helpAnchor="integrator-report"
      />
      <IntegratorClient report={report} canResolve={canResolve} canAdd={canAdd} />
    </div>
  );
}
