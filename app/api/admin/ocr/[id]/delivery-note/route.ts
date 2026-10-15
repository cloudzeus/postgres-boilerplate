import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { canPost } from '@/lib/templates/run-logic';
import { POST_ERROR_TEXT, PostError } from '@/lib/ocr/post-softone';
import { compareWithNotes, convertFromNotes, deliveryNoteOverview } from '@/lib/ocr/delivery-note-convert';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fail = (err: unknown) => {
  if (err instanceof PostError) {
    const status = err.code === 'not_found' ? 404 : err.code === 'posting_disabled' ? 409 : 422;
    return NextResponse.json({ error: err.code, message: err.message || POST_ERROR_TEXT[err.code] }, { status });
  }
  return NextResponse.json({ error: 'softone_error', message: String((err as Error)?.message ?? err) }, { status: 502 });
};

// GET — τα ανοιχτά δελτία αποστολής του προμηθευτή, η πρόταση και η σύγκρισή της. Μόνο αναγνώσεις.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.post');
  const { id } = await params;
  try { return NextResponse.json(await deliveryNoteOverview(id)); } catch (e) { return fail(e); }
}

const Body = z.object({
  action: z.enum(['compare', 'convert']),
  findocs: z.array(z.number().int().positive()).min(1).max(20),
  acceptPartial: z.boolean().optional(),
});

// POST { action:'compare', findocs } — σύγκριση (ανάγνωση).
// POST { action:'convert', findocs, acceptPartial } — μετασχηματισμός σε τιμολόγιο (ΕΓΓΡΑΦΗ στη SoftOne).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('ocr.post');
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  const b = parsed.data;
  try {
    if (b.action === 'compare') return NextResponse.json(await compareWithNotes(id, b.findocs));

    // Ίδιος κανόνας με την απλή καταχώριση: ένα BLOCK_POSTING προτύπου μπλοκάρει και τον μετασχηματισμό.
    const doc = await prisma.ocrDocument.findUnique({ where: { id }, select: { reviewFlags: true } });
    const blocked = (doc?.reviewFlags as { blocked?: string[] } | null)?.blocked ?? [];
    if (!canPost('MANUAL', { blocked })) {
      return NextResponse.json({ error: 'blocked', message: 'Η ανάρτηση είναι μπλοκαρισμένη από κανόνα προτύπου' }, { status: 422 });
    }
    const out = await convertFromNotes(id, b.findocs, { acceptPartial: b.acceptPartial === true, userId: user.id });
    await logAudit({
      userId: user.id, action: 'ocr.delivery_note_convert', resource: 'OcrDocument', resourceId: id,
      metadata: { findocs: b.findocs, ref: out.ref, warning: out.warning ?? null },
    }).catch(() => null);
    return NextResponse.json({ ok: true, ...out });
  } catch (e) { return fail(e); }
}
