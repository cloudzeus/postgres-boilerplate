import { FiPackage } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission, hasPermission } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';
import { loadItemQueue } from '@/lib/ocr/queues';
import { NewItemsClient } from './queue-client';

export const dynamic = 'force-dynamic';

/** Πόσες ομάδες παίρνουν προτάσεις στο πρώτο render — οι υπόλοιπες lazy. */
const SUGGEST_FOR = 50;

// Σελίδα «Είδη & έξοδα» (spec 2026-09-11 §3): οι αταίριαστες γραμμές των
// παραστατικών ομαδοποιημένες ανά (εκδότης, κείμενο γραμμής), με προτάσεις
// από τα τοπικά μητρώα SoftOne και δυνατότητα δημιουργίας νέου είδους/εξόδου.
export default async function NewItemsPage() {
  await requirePermission('ocr.read');

  const [queue, canManage, vats, units] = await Promise.all([
    loadItemQueue({ suggestFor: SUGGEST_FOR }),
    // Χωρίς `ocr.categorize` η σελίδα είναι μόνο για ανάγνωση (ίδιο με «Νέοι συναλλασσόμενοι»).
    hasPermission('ocr.categorize'),
    // Ίδια πηγή με τα υπόλοιπα σημεία της εφαρμογής: το μητρώο `VatCategory`
    // (κλειδί = ο κωδικός ΦΠΑ του SoftOne, ό,τι περιμένει το setData).
    prisma.vatCategory.findMany({
      where: { isActive: true },
      orderBy: [{ order: 'asc' }, { code: 'asc' }],
      select: { code: true, descr: true, rate: true },
    }),
    prisma.softoneLookup.findMany({
      where: { kind: 'MTRUNIT' },
      orderBy: { order: 'asc' },
      select: { code: true, name: true },
    }),
  ]);

  return (
    <NewItemsClient
      header={
        <PageHeader
          icon={<FiPackage />}
          title="Είδη & έξοδα"
          description="Γραμμές παραστατικών που δεν βρέθηκαν στο SoftOne — αντιστοίχισέ τες ή δημιούργησε νέο είδος/έξοδο."
          helpAnchor="new-items"
        />
      }
      initialGroups={queue.groups}
      total={queue.total}
      truncated={queue.truncated}
      suggestedFor={SUGGEST_FOR}
      canManage={canManage}
      vats={vats.map((v) => ({ code: v.code, label: v.rate != null ? `${v.descr} (${v.rate}%)` : v.descr, rate: v.rate }))}
      units={units.map((u) => ({ code: u.code, label: u.name }))}
    />
  );
}
