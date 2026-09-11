import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { loadTraderQueue } from '@/lib/ocr/queues';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET — η ουρά «Νέοι συναλλασσόμενοι» (spec 2026-09-11 §2): ολοκληρωμένα έγγραφα
// χωρίς TRDR, ομαδοποιημένα κατά ΑΦΜ εκδότη. `?ignored=1` επιστρέφει και τους
// αγνοημένους εκδότες (φίλτρο «Αγνοημένοι»).
export async function GET(req: Request) {
  await requirePermission('ocr.read');
  const includeIgnored = new URL(req.url).searchParams.get('ignored') === '1';
  const { groups, ignored } = await loadTraderQueue({ includeIgnored });
  return NextResponse.json({ groups, ignored });
}
