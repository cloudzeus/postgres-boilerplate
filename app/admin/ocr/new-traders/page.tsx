import { FiUsers } from 'react-icons/fi';
import { requirePermission, hasPermission } from '@/lib/rbac';
import { loadTraderQueue } from '@/lib/ocr/queues';
import { softoneFetchTaxOffices } from '@/lib/softone';
import { PageHeader } from '@/components/admin/page-header';
import { NewTradersClient } from './queue-client';

export const dynamic = 'force-dynamic';

/**
 * «Νέοι συναλλασσόμενοι» (spec 2026-09-11 §2): οι εκδότες των ολοκληρωμένων
 * εγγράφων που δεν βρέθηκαν στο SoftOne, ομαδοποιημένοι κατά ΑΦΜ. Ο χρήστης
 * δημιουργεί προμηθευτή/πιστωτή, συνδέει με υπάρχοντα ή αγνοεί τον εκδότη.
 */
export default async function NewTradersPage() {
  await requirePermission('ocr.read');

  const [{ groups, ignored, truncated }, canManage, taxOffices] = await Promise.all([
    loadTraderQueue({ includeIgnored: true }),
    hasPermission('ocr.categorize'),
    // Best-effort: χωρίς SoftOne η σελίδα δουλεύει, απλώς το πεδίο Δ.Ο.Υ. μένει κενό.
    softoneFetchTaxOffices().catch(() => [] as { code: string; name: string }[]),
  ]);

  return (
    <NewTradersClient
      // Ο `PageHeader` φέρνει το `?` της wiki με έλεγχο δικαιωμάτων (server
      // component) — γι' αυτό φτιάχνεται εδώ και περνά έτοιμος στο client shell.
      header={
        <PageHeader
          icon={<FiUsers />}
          title="Νέοι συναλλασσόμενοι"
          description={`Εκδότες παραστατικών που δεν βρέθηκαν στο SoftOne (${groups.length} εκκρεμείς).`}
          helpAnchor="new-traders"
        />
      }
      groups={groups}
      ignored={ignored}
      truncated={truncated}
      taxOffices={taxOffices}
      canManage={canManage}
    />
  );
}
