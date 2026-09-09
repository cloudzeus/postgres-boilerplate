import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { PostError, postDocumentToSoftone } from '@/lib/ocr/post-softone';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST → push the extracted OCR document to SoftOne (FINDOC / PURDOC).
 * The work lives in lib/ocr/post-softone.ts so the template runner posts through the same path.
 * A BLOCK_POSTING rule is enforced HERE (not in the lib, which stays generic): the runner leaves its
 * reasons on the document's `reviewFlags.blocked`, and a manual post must respect them too.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.post');
  const { id } = await params;

  const doc = await prisma.ocrDocument.findUnique({ where: { id }, select: { reviewFlags: true } });
  const blocked = (doc?.reviewFlags as { blocked?: string[] } | null)?.blocked ?? [];
  if (blocked.length > 0) {
    return NextResponse.json({ error: 'blocked', message: 'Η ανάρτηση είναι μπλοκαρισμένη από κανόνα προτύπου' }, { status: 422 });
  }

  try {
    const { ref } = await postDocumentToSoftone(id);
    return NextResponse.json({ ok: true, ref });
  } catch (err) {
    if (err instanceof PostError) {
      return NextResponse.json({ error: err.message }, { status: err.code === 'not_found' ? 404 : 422 });
    }
    return NextResponse.json({ error: String((err as Error)?.message ?? err) }, { status: 502 });
  }
}
