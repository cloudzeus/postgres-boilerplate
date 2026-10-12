import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/rbac';
import { loadProblemSuggestions } from '@/lib/ocr/problem-suggestions';

const Body = z.object({ ids: z.array(z.string().min(1)).min(1).max(500) });

// POST — προτάσεις λύσης (κατηγορία, επανανάγνωση) για τα παραστατικά μιας ημέρας. Μόνο ανάγνωση.
export async function POST(req: Request) {
  await requirePermission('ocr.read');
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  return NextResponse.json({ suggestions: await loadProblemSuggestions(parsed.data.ids) });
}
