import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { loadItemQueue } from '@/lib/ocr/queues';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET — η ουρά «Είδη & έξοδα» (spec 2026-09-11 §3): αταίριαστες γραμμές
// ομαδοποιημένες κατά (ΑΦΜ εκδότη, κανονικοποιημένο κείμενο). Προτάσεις μόνο για
// τις πρώτες ομάδες· οι υπόλοιπες μέσω `GET …/suggest`.
export async function GET(req: Request) {
  await requirePermission('ocr.read');
  const raw = new URL(req.url).searchParams.get('suggestFor');
  const n = Number(raw);
  const suggestFor = Number.isFinite(n) && n >= 0 ? Math.min(n, 200) : undefined;
  const { groups, total, truncated } = await loadItemQueue({ suggestFor });
  // `truncated` = χτύπησε το πλαφόν γραμμών· η σελίδα μπορεί να το αγνοήσει προς το παρόν.
  return NextResponse.json({ groups, total, truncated });
}
