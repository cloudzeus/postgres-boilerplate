// lib/ocr/post-softone.ts — SERVER. One place for "post this document to SoftOne" (route + template runner).
import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { buildReviewFlags } from '@/lib/templates/run-logic';

export class PostError extends Error {
  constructor(public code: 'not_found' | 'not_completed' | 'no_category', message: string) {
    super(message);
    this.name = 'PostError';
  }
}

/**
 * A precondition the poster refuses on, in Greek. Shared on purpose: the runner turns it into the
 * BLOCKED run's reason and the manual post route into the toast, so a user sees the same sentence
 * whichever way the posting was attempted.
 */
export const POST_ERROR_TEXT: Record<PostError['code'], string> = {
  no_category: 'Δεν έχει οριστεί κατηγορία εγγράφου',
  not_completed: 'Το έγγραφο δεν έχει ολοκληρωθεί',
  not_found: 'Το έγγραφο δεν βρέθηκε',
};

/**
 * A manual post settles the run the user was looking at: the latest run that still says «προς έλεγχο»
 * or «μπλοκαρισμένο» becomes POSTED, and the document's cached banner follows it. A FAILED run is
 * skipped — it produced nothing to post, so it stays the failure it was.
 * Best-effort by design: the document IS posted at this point, and a bookkeeping write that fails
 * must not turn a successful post into an error.
 */
async function markLatestRunPosted(documentId: string): Promise<void> {
  const run = await prisma.templateRun.findFirst({
    where: { documentId, status: { not: 'FAILED' } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: { template: { select: { slug: true, name: true } } },
  });
  if (!run || (run.status !== 'REVIEW' && run.status !== 'BLOCKED')) return;

  const flags = (run.flags as { review?: string[]; blocked?: string[] } | null) ?? {};
  const reviewFlags = buildReviewFlags(run.template, 'POSTED', run.id, { review: flags.review ?? [], blocked: flags.blocked ?? [] });
  await prisma.$transaction([
    prisma.templateRun.update({ where: { id: run.id }, data: { status: 'POSTED' } }),
    prisma.ocrDocument.update({ where: { id: documentId }, data: { reviewFlags: reviewFlags as unknown as Prisma.InputJsonValue } }),
  ]);
}

/**
 * Posts the document. Throws PostError for precondition failures; rethrows transport errors after marking FAILED.
 * `syncTemplateRun` is for the MANUAL post only — the runner posts BEFORE it writes its own run row,
 * so letting it sync here would stamp POSTED on the previous run instead of the one it is creating.
 */
export async function postDocumentToSoftone(id: string, opts: { syncTemplateRun?: boolean } = {}): Promise<{ ref: string }> {
  const doc = await prisma.ocrDocument.findUnique({ where: { id }, select: { id: true, status: true, category: true } });
  if (!doc) throw new PostError('not_found', 'not found');
  if (doc.status !== 'COMPLETED') throw new PostError('not_completed', 'OCR document is not in COMPLETED state');
  if (!doc.category) throw new PostError('no_category', 'Set a category before posting (EXPENSE / INVOICE_IN / …).');

  await prisma.ocrDocument.update({ where: { id }, data: { postStatus: 'PENDING' } });
  try {
    // TODO: route by doc.category to the correct SoftOne object:
    //   EXPENSE / INVOICE_IN  → setData on PURDOC
    //   INVOICE_OUT / RECEIPT → setData on SODOC
    //   CREDIT_NOTE           → PURDOC/SODOC with negative SERIES
    // For now we mark it as POSTED with a synthetic ref so the UI is wired end-to-end.
    const ref = `OCR-${doc.id.slice(0, 8).toUpperCase()}`;
    await prisma.ocrDocument.update({
      where: { id },
      data: { postStatus: 'POSTED', postedAt: new Date(), postedRef: ref, postError: null },
    });
    if (opts.syncTemplateRun) {
      await markLatestRunPosted(id).catch((e) => console.error('[ocr] run status not synced after post', id, (e as Error).message));
    }
    return { ref };
  } catch (err) {
    await prisma.ocrDocument.update({
      where: { id },
      data: { postStatus: 'FAILED', postError: String((err as Error)?.message ?? err).slice(0, 2000) },
    });
    throw err;
  }
}
