import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { resyncAllSoftone, syncFailureResponse, SYNC_STEPS, type SyncTable } from '@/lib/softone/resync';

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
  //
  // Προαιρετικά επίσης `{ runId, pass: [...] }`: το UI τρέχει έναν πίνακα ανά αίτημα για να δείχνει
  // πρόοδο, οπότε ΜΟΝΟ αυτό ξέρει ότι τα επτά αιτήματα είναι ΕΝΑ πέρασμα. Με το κοινό `runId` και
  // τη λίστα `pass`, ο server κλείνει τον κύκλο και γράφει τη συγκεντρωτική εγγραφή ελέγχου.
  const known = new Set(SYNC_STEPS.map((s) => s.table as string));
  const tables = (v: unknown): SyncTable[] | undefined =>
    Array.isArray(v) ? v.filter((t: unknown): t is SyncTable => typeof t === 'string' && known.has(t)) : undefined;

  let only: SyncTable[] | undefined;
  let run: { id: string; tables?: SyncTable[] } | undefined;
  try {
    const body = await req.json();
    if (body && typeof body === 'object') {
      only = tables(body.only);
      if (typeof body.runId === 'string' && body.runId) run = { id: body.runId, tables: tables(body.pass) };
    }
  } catch { /* κενό σώμα = όλοι οι πίνακες */ }

  try {
    const report = await resyncAllSoftone(u, { only, run });
    return NextResponse.json(report);
  } catch (e) {
    // Εδώ φτάνει μόνο ό,τι ΔΕΝ είναι αποτυχία βήματος (π.χ. «τρέχει ήδη συγχρονισμός»): οι
    // αποτυχίες των πινάκων ζουν μέσα στον απολογισμό και επιστρέφουν 200.
    const { status, body } = syncFailureResponse(e);
    return NextResponse.json(body, { status });
  }
}
