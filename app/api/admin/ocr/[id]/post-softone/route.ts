import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { POST_ERROR_TEXT, PostError, postDocumentToSoftone } from '@/lib/ocr/post-softone';
import { canPost } from '@/lib/templates/run-logic';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST → push the extracted OCR document to SoftOne (FINDOC / PURDOC).
 * The work lives in lib/ocr/post-softone.ts so the template runner posts through the same path.
 * A BLOCK_POSTING reason is enforced HERE (not in the lib, which stays generic): the runner leaves its
 * reasons on the document's `reviewFlags.blocked`, and a manual post must respect them too — through
 * the same `canPost` predicate the runner uses, so the two can never drift apart.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.post');
  const { id } = await params;

  const doc = await prisma.ocrDocument.findUnique({ where: { id }, select: { reviewFlags: true } });
  const blocked = (doc?.reviewFlags as { blocked?: string[] } | null)?.blocked ?? [];
  if (!canPost('MANUAL', { blocked })) {
    return NextResponse.json({ error: 'blocked', message: 'Η ανάρτηση είναι μπλοκαρισμένη από κανόνα προτύπου' }, { status: 422 });
  }

  try {
    const { ref } = await postDocumentToSoftone(id, { syncTemplateRun: true });
    return NextResponse.json({ ok: true, ref });
  } catch (err) {
    if (err instanceof PostError) {
      return NextResponse.json({ error: err.code, message: POST_ERROR_TEXT[err.code] ?? err.message }, { status: err.code === 'not_found' ? 404 : 422 });
    }
    return NextResponse.json({ error: String((err as Error)?.message ?? err) }, { status: 502 });
  }
}
