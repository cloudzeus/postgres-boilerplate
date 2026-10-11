import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { drainOutbox } from '@/lib/softone-sync/outbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Αδειάζει την ουρά. Καλείται από το κουμπί «Στείλε τώρα» ΚΑΙ αυτόματα όταν η λωρίδα
 * κατάστασης δει ότι ο διακομιστής ξαναήρθε.
 *
 * Στέλνει ΜΟΝΟ `PENDING` — ποτέ `NEEDS_REVIEW`. Αυτές θέλουν ανθρώπινη απόφαση.
 */
export async function POST() {
  const u = await requirePermission('metadata.manage');
  const report = await drainOutbox();
  if (report.attempted > 0) {
    await logAudit({
      userId: u.id, userEmail: u.email,
      action: 'softone.outbox.drain', resource: 'softone_outbox', resourceId: String(report.attempted),
      metadata: { ...report },
    }).catch(() => null);
  }
  return NextResponse.json(report);
}
