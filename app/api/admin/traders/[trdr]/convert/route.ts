import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/rbac';
import { SoftoneError } from '@/lib/softone';
import { convertTrader, previewTraderConversion } from '@/lib/softone-sync/trader-convert';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idOf = async (params: Promise<{ trdr: string }>) => {
  const n = Number((await params).trdr);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// GET — τι θα γίνει: η καρτέλα-πηγή όπως είναι ΤΩΡΑ στη SoftOne, ο νέος τύπος, ο προτεινόμενος
// κωδικός, αν υπάρχει ΗΔΗ καρτέλα του νέου τύπου στον ΑΦΜ και πόσα εκκρεμή παραστατικά την αφορούν.
// Μόνο αναγνώσεις.
export async function GET(_req: Request, { params }: { params: Promise<{ trdr: string }> }) {
  await requirePermission('metadata.manage');
  const trdr = await idOf(params);
  if (!trdr) return NextResponse.json({ error: 'invalid_trdr' }, { status: 400 });
  try {
    return NextResponse.json(await previewTraderConversion(trdr));
  } catch (e) {
    const status = e instanceof SoftoneError ? 422 : 502;
    return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status });
  }
}

const Body = z.object({
  code: z.string().trim().max(25).nullable().optional(),
  deactivateSource: z.boolean().optional(),
});

// POST { code, deactivateSource } — νέα καρτέλα του άλλου τύπου στη SoftOne (ή σύνδεση σε όση
// υπάρχει ήδη), σύνδεση των εκκρεμών παραστατικών, προαιρετικά απενεργοποίηση της πηγής.
export async function POST(req: Request, { params }: { params: Promise<{ trdr: string }> }) {
  const u = await requirePermission('metadata.manage');
  const trdr = await idOf(params);
  if (!trdr) return NextResponse.json({ error: 'invalid_trdr' }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  try {
    const out = await convertTrader(trdr, {
      code: parsed.data.code || null,
      deactivateSource: parsed.data.deactivateSource ?? false,
      actor: { id: u.id, email: u.email },
    });
    return NextResponse.json(out);
  } catch (e) {
    const status = e instanceof SoftoneError ? 422 : 502;
    return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status });
  }
}
