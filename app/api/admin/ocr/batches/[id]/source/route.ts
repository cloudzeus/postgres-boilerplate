import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { serveStoredFile } from '@/lib/serve-file';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Το ΠΡΩΤΟΤΥΠΟ PDF ενός φακέλου που προέκυψε από διαχωρισμό. Υπάρχει ώστε ο χρήστης να μπορεί
 * πάντα να δει τη στοίβα όπως σαρώθηκε — κυρίως όταν τα κοψίματα βγήκαν λάθος.
 *
 * Ίδια συμπεριφορά με το `ocr/[id]/file`: `Range`/206, `Content-Length`, `ETag`/304, 416.
 * Οι στοίβες σάρωσης είναι τα ΜΕΓΑΛΥΤΕΡΑ αρχεία της εφαρμογής, άρα εδώ μετράει περισσότερο.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.read');
  const { id } = await params;
  const batch = await prisma.ocrBatch.findUnique({
    where: { id }, select: { sourceKey: true, sourceName: true },
  });
  if (!batch?.sourceKey) return new Response('not found', { status: 404 });
  return serveStoredFile(req, {
    key: batch.sourceKey,
    contentType: 'application/pdf',
    fileName: batch.sourceName ?? 'source.pdf',
  });
}
