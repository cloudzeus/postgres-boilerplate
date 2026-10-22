import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/rbac';
import { rescanEligibility } from '@/lib/ocr/reextract-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ ids: z.array(z.string().min(1)).min(1).max(500) });

// POST { ids } — ποια ξαναδιαβάζονται με ασφάλεια σε μαζική επανασάρωση και γιατί όχι τα άλλα. Μόνο ανάγνωση.
export async function POST(req: Request) {
  await requirePermission('ocr.create');
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  return NextResponse.json({ docs: await rescanEligibility(parsed.data.ids) });
}
