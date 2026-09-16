import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/rbac';
import { suggestExpensesWithAi, MAX_GROUPS } from '@/lib/ocr/expense-ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  groups: z.array(z.object({
    key: z.string().trim().min(1).max(260),
    afm: z.string().trim().max(20).default(''),
    pattern: z.string().trim().min(1).max(200),
    sample: z.string().trim().max(400).nullish(),
    code: z.string().trim().max(60).nullish(),
  })).min(1).max(MAX_GROUPS),
  categoryId: z.number().int().positive().nullish(),
});

// POST — ΠΡΟΤΑΣΗ δαπάνης με AI, μόνο για τις ομάδες που δεν έλυσε ο φθηνός δρόμος.
// Τρέχει ΜΟΝΟ όταν το ζητήσει ο χρήστης (κουμπί «Πρόταση με AI»), ποτέ αυτόματα.
export async function POST(req: Request) {
  const u = await requirePermission('ocr.categorize');
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  }
  const r = await suggestExpensesWithAi({ ...parsed.data, userId: u.id });
  return NextResponse.json(r);
}
