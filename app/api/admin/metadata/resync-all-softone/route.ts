import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { resyncAllSoftone, SYNC_STEPS, type SyncTable } from '@/lib/softone/resync';

// «Συγχρονισμός όλων των βοηθητικών πινάκων»: τρέχει σειριακά τους ίδιους επτά συγχρονισμούς που
// τρέχουν και τα μεμονωμένα `sync-*-softone` routes, με την ίδια άδεια. Μια αποτυχία δεν σταματά
// τους υπόλοιπους — η απάντηση λέει ανά πίνακα τι έγινε.
//
// Ο βαρύς πίνακας των συναλλασσομένων και αυτός των ειδών μπορούν μαζί να ξεπεράσουν το
// προεπιλεγμένο όριο του runtime, γι' αυτό το `maxDuration` ανεβαίνει ρητά.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600;

/** Η σειρά εκτέλεσης, για να μπορεί το UI να δείξει πρόοδο πριν καν ξεκινήσει. */
export async function GET() {
  await requirePermission('metadata.manage');
  return NextResponse.json({ steps: SYNC_STEPS.map((s) => ({ table: s.table, label: s.label })) });
}

export async function POST(req: Request) {
  const u = await requirePermission('metadata.manage');

  // Προαιρετικό `{ only: ['traders', …] }` — ώστε το UI να μπορεί να ξαναδοκιμάσει ΜΟΝΟ όσους
  // πίνακες απέτυχαν, χωρίς να ξανακατεβάσει τους υπόλοιπους.
  let only: SyncTable[] | undefined;
  try {
    const body = await req.json();
    if (body && Array.isArray(body.only)) {
      const known = new Set(SYNC_STEPS.map((s) => s.table as string));
      only = body.only.filter((t: unknown): t is SyncTable => typeof t === 'string' && known.has(t));
    }
  } catch { /* κενό σώμα = όλοι οι πίνακες */ }

  const report = await resyncAllSoftone(u, { only });
  return NextResponse.json(report);
}
