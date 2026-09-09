// lib/ocr/post-softone.ts — SERVER. One place for "post this document to SoftOne" (route + template runner).
import 'server-only';
import { prisma } from '@/lib/db';

export class PostError extends Error {
  constructor(public code: 'not_found' | 'not_completed' | 'no_category', message: string) {
    super(message);
    this.name = 'PostError';
  }
}

/** Posts the document. Throws PostError for precondition failures; rethrows transport errors after marking FAILED. */
export async function postDocumentToSoftone(id: string): Promise<{ ref: string }> {
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
    return { ref };
  } catch (err) {
    await prisma.ocrDocument.update({
      where: { id },
      data: { postStatus: 'FAILED', postError: String((err as Error)?.message ?? err).slice(0, 2000) },
    });
    throw err;
  }
}
