import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { POST_ERROR_TEXT, PostError, postDocumentToSoftone, postingPreview } from '@/lib/ocr/post-softone';
import { canPost } from '@/lib/templates/run-logic';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET ?dryRun=1 → προεπισκόπηση: τι payload θα σταλεί στο SoftOne και τι εμποδίζει την αποστολή.
 * ΔΕΝ αγγίζει το SoftOne και δεν γράφει τίποτα. Τα εμπόδια ΔΕΝ είναι σφάλμα του αιτήματος —
 * επιστρέφονται με 200 ώστε η κάρτα να τα δείξει ως λίστα αντί για κόκκινο toast.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.post');
  const { id } = await params;
  const dryRun = new URL(req.url).searchParams.get('dryRun');
  if (dryRun !== '1') {
    return NextResponse.json({ error: 'bad_request', message: 'Χρησιμοποιήστε ?dryRun=1' }, { status: 400 });
  }
  try {
    const preview = await postingPreview(id);
    // Ένα BLOCK_POSTING του προτύπου είναι κι αυτό εμπόδιο — ο χρήστης πρέπει να το βλέπει εδώ,
    // αλλιώς η κάρτα θα έλεγε «έτοιμο» για έγγραφο που το κουμπί αρνείται να στείλει.
    const doc = await prisma.ocrDocument.findUnique({ where: { id }, select: { reviewFlags: true } });
    const blocked = (doc?.reviewFlags as { blocked?: string[] } | null)?.blocked ?? [];
    const ruleBlockers = canPost('MANUAL', { blocked })
      ? []
      : blocked.map((message) => ({ code: 'rule_blocked' as const, message }));
    return NextResponse.json({ ...preview, blockers: [...preview.blockers, ...ruleBlockers] });
  } catch (err) {
    if (err instanceof PostError) {
      return NextResponse.json({ error: err.code, message: err.message || POST_ERROR_TEXT[err.code] }, { status: err.code === 'not_found' ? 404 : 422 });
    }
    return NextResponse.json({ error: String((err as Error)?.message ?? err) }, { status: 502 });
  }
}

/**
 * POST → push the extracted OCR document to SoftOne (PURDOC).
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
      const status = err.code === 'not_found' ? 404 : err.code === 'posting_disabled' ? 409 : 422;
      return NextResponse.json({ error: err.code, message: err.message || POST_ERROR_TEXT[err.code] }, { status });
    }
    return NextResponse.json({ error: String((err as Error)?.message ?? err) }, { status: 502 });
  }
}
