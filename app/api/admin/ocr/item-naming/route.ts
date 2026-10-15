import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/rbac';
import { loadItemNaming, resolveItemNames } from '@/lib/item-naming-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET — οι ρυθμίσεις «Αρχικοποίηση εφαρμογής» για ονόματα ειδών (πεζά/κεφαλαία, αυτόματη μετάφραση).
export async function GET() {
  await requirePermission('ocr.read');
  return NextResponse.json(await loadItemNaming());
}

const Body = z.object({
  name: z.string().trim().min(1).max(200),
  original: z.string().trim().max(500).nullable().optional(),
  lineId: z.string().max(64).optional(),
});

// POST { name, original } — προεπισκόπηση: τι ΑΚΡΙΒΩΣ θα γραφτεί σε NAME/NAME1 (δεν γράφεται τίποτα).
// Χωρίς μετάφραση εδώ: τη μετάφραση στη φόρμα την κάνει (και την αναιρεί) ο χρήστης.
export async function POST(req: Request) {
  await requirePermission('ocr.categorize');
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const b = parsed.data;
  const out = await resolveItemNames({ name: b.name, original: b.original ?? null, ref: b.lineId ?? null });
  return NextResponse.json({ name: out.name, name1: out.name1 });
}
