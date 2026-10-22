import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/rbac';
import { checkPostedAmounts, fixPostedAmounts, PostedAmountsError } from '@/lib/ocr/posted-amounts';
import { PostError } from '@/lib/ocr/post-softone';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET — συμφωνούν τα ποσά του καταχωρισμένου παραστατικού στη SoftOne με το χαρτί; Αν όχι, τι θα
// γίνει με τη διόρθωση (υπολογισμένο στη SoftOne χωρίς αποθήκευση). Μόνο αναγνώσεις.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.read');
  const { id } = await params;
  try {
    return NextResponse.json(await checkPostedAmounts(id));
  } catch (e) {
    const known = e instanceof PostedAmountsError || e instanceof PostError;
    return NextResponse.json({ error: 'check_failed', message: (e as Error).message }, { status: known ? 422 : 502 });
  }
}

const Body = z.object({ acknowledgeVat: z.boolean().optional() });

// POST { acknowledgeVat } — ενημερώνει ΤΟ ΙΔΙΟ παραστατικό στη SoftOne με τη σωστή «Αξία» ανά γραμμή.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requirePermission('ocr.post');
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  try {
    const out = await fixPostedAmounts(id, { acknowledgeVat: parsed.data.acknowledgeVat === true, actor: { id: u.id, email: u.email } });
    return NextResponse.json({ ok: true, before: out.before, after: out.after });
  } catch (e) {
    const known = e instanceof PostedAmountsError || e instanceof PostError;
    return NextResponse.json({ error: 'fix_failed', message: (e as Error).message }, { status: known ? 422 : 502 });
  }
}
