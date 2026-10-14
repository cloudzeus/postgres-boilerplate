import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/rbac';
import { suggestPurposeWithAi } from '@/lib/ocr/purpose-ai';
import { TILE_ORDER } from '@/lib/ocr/purchase-purpose';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  lineId: z.string().trim().min(1).max(60),
  /** Οι κατηγορίες που δέχεται η σειρά του παραστατικού — το μοντέλο διαλέγει ΜΟΝΟ από αυτές. */
  allowed: z.array(z.enum(TILE_ORDER as [string, ...string[]])).min(1).max(TILE_ORDER.length),
});

// POST — «Τι αφορά αυτή η γραμμή;» με AI. Μόνο με κλικ του χρήστη, ποτέ αυτόματα.
export async function POST(req: Request) {
  await requirePermission('ocr.categorize');
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const r = await suggestPurposeWithAi(parsed.data as Parameters<typeof suggestPurposeWithAi>[0]);
  if (!r) return NextResponse.json({ error: 'no_answer', message: 'Το μοντέλο δεν έδωσε πρόταση αυτή τη στιγμή — διάλεξε εσύ ή δοκίμασε ξανά.' }, { status: 503 });
  return NextResponse.json(r);
}
