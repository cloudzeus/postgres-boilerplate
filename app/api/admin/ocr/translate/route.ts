import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/rbac';
import { translateItemName } from '@/lib/ocr/translate-ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ text: z.string().trim().min(1).max(500), lineId: z.string().max(64).optional() });

// POST { text } — ελληνική περιγραφή είδους (πρόταση· δεν γράφεται τίποτα).
export async function POST(req: Request) {
  await requirePermission('ocr.categorize');
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const out = await translateItemName(parsed.data.text, parsed.data.lineId);
  if (!out) return NextResponse.json({ error: 'ai_unavailable', message: 'Η μετάφραση δεν είναι διαθέσιμη αυτή τη στιγμή.' }, { status: 503 });
  return NextResponse.json({ text: out });
}
