import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import {
  probeConnection, softoneReachable, knownTenantKey, mirrorTrust,
  pendingTenantChange, clearTenantChange,
} from '@/lib/softone-sync/connection';
import { outboxSummary } from '@/lib/softone-sync/outbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Η ΚΑΤΑΣΤΑΣΗ ΤΗΣ ΣΥΝΔΕΣΗΣ, με ένα φθηνό αίτημα.
 *
 * `GET` = μόνο «απαντά ο διακομιστής;» (ένα `ping`, χωρίς login) μαζί με ό,τι ξέρουμε ήδη τοπικά.
 * Τρέχει συχνά, από λωρίδα που βλέπει ο χρήστης — δεν επιτρέπεται να καίει session σε κάθε φόρτωση.
 */
export async function GET() {
  await requirePermission('metadata.manage');
  const [health, tenantKey, mirrors, pending, outbox] = await Promise.all([
    softoneReachable(), knownTenantKey(), mirrorTrust(), pendingTenantChange(), outboxSummary(),
  ]);
  return NextResponse.json({
    reachable: health.reachable,
    endpoint: health.endpoint,
    message: health.message,
    tenantKey,
    tenantChange: pending,
    mirrors,
    foreignMirrors: mirrors.filter((m) => m.provenance === 'foreign').map((m) => m.table),
    // Χωριστά από τα «ξένα»: εδώ δεν ξέρουμε από πού ήρθαν, και το μήνυμα πρέπει να το λέει
    // ακριβώς αυτό αντί να ισχυριστεί κάτι που δεν ξέρουμε.
    unstampedMirrors: mirrors.filter((m) => m.provenance === 'unknown').map((m) => m.table),
    outbox,
  });
}

/**
 * `{ action: 'probe' }` — πλήρης έλεγχος (login → authenticate → ταυτότητα). Εδώ ανιχνεύεται
 * η αλλαγή εγκατάστασης.
 * `{ action: 'acknowledge' }` — ο χρήστης είδε την αλλαγή και την αποδέχεται· η σημαία πέφτει.
 * Η σημαία ΔΕΝ πέφτει μόνη της: η αποδοχή είναι ανθρώπινη απόφαση, γιατί σημαίνει «ξέρω ότι
 * τα παλιά μητρώα δεν ισχύουν».
 */
export async function POST(req: Request) {
  const u = await requirePermission('metadata.manage');
  const body = await req.json().catch(() => ({}));
  const action = (body as { action?: unknown }).action;

  if (action === 'acknowledge') {
    const pending = await pendingTenantChange();
    await clearTenantChange();
    await logAudit({
      userId: u.id, userEmail: u.email,
      action: 'softone.tenant.acknowledge', resource: 'softone_connection', resourceId: pending?.to ?? '—',
      metadata: { from: pending?.from ?? null, to: pending?.to ?? null },
    }).catch(() => null);
    return NextResponse.json({ ok: true, acknowledged: pending });
  }

  const probe = await probeConnection();
  await logAudit({
    userId: u.id, userEmail: u.email,
    action: 'softone.connection.probe', resource: 'softone_connection', resourceId: probe.tenantKey ?? '—',
    metadata: { ok: probe.ok, failure: probe.failure, endpoint: probe.endpoint, serialNo: probe.serialNo },
  }).catch(() => null);
  const pending = await pendingTenantChange();
  return NextResponse.json({ ...probe, tenantChange: pending }, { status: probe.ok ? 200 : 502 });
}
