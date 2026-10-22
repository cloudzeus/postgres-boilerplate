import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/rbac';
import { creditCandidates, setCreditLink, CreditLinkError } from '@/lib/ocr/credit-link-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET — υποψήφια αρχικά για το πιστωτικό (εφαρμογή + SoftOne), με πρόταση όταν ο τυπωμένος αριθμός ταιριάζει.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.read');
  const { id } = await params;
  try {
    return NextResponse.json(await creditCandidates(id));
  } catch (e) {
    return NextResponse.json({ error: 'credit_link', message: (e as Error).message }, { status: e instanceof CreditLinkError ? 422 : 502 });
  }
}

const Body = z.object({
  findoc: z.number().int().positive().nullable(),
  label: z.string().max(300).nullable().optional(),
  noLink: z.boolean().optional(),
});

// POST { findoc, label } ή { findoc: null, noLink: true } — αποθηκεύει τη σύνδεση στο έγγραφο.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requirePermission('ocr.categorize');
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || (!parsed.data.noLink && parsed.data.findoc == null)) {
    return NextResponse.json({ error: 'invalid_body', message: 'Διάλεξε αρχικό παραστατικό ή «χωρίς αρχικό».' }, { status: 400 });
  }
  try {
    return NextResponse.json({ ok: true, references: await setCreditLink(id, parsed.data, { id: u.id, email: u.email }) });
  } catch (e) {
    return NextResponse.json({ error: 'credit_link', message: (e as Error).message }, { status: e instanceof CreditLinkError ? 422 : 502 });
  }
}
