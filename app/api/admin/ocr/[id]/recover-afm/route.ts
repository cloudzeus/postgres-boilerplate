import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { recoverIssuerAfm } from '@/lib/ocr/afm-recovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Ανάκτηση του σωστού ΑΦΜ εκδότη από το ίδιο το αρχείο (βλ. `lib/ocr/afm-recovery.ts`).
 *
 * `{ apply: false }` (προεπιλογή) = ΜΟΝΟ έλεγχος: λέει τι βρήκε και αν η ΑΑΔΕ το επιβεβαιώνει,
 * χωρίς να γράψει τίποτα. `{ apply: true }` γράφει — και ΜΟΝΟ αν η ΑΑΔΕ επιβεβαίωσε επωνυμία.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requirePermission('ocr.categorize');
  const { id } = await params;
  // `force`: ο χρήστης ΕΙΔΕ το αρχείο και εγκρίνει εύρημα με αδύναμη απόδειξη (βλ. `evidence`).
  const body = (await req.json().catch(() => ({}))) as { apply?: unknown; force?: unknown };
  const r = await recoverIssuerAfm(id, { apply: body.apply === true, force: body.force === true, actor: { id: u.id, email: u.email } });
  return NextResponse.json(r, { status: r.status === 'no_file' ? 502 : 200 });
}
