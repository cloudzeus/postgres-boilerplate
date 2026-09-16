import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { serveStoredFile } from '@/lib/serve-file';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Το πρωτότυπο αρχείο ενός εγγράφου, για το `<iframe>` του viewer.
 *
 * Τιμά `Range` (206), `Content-Length`, `ETag`/`If-None-Match` (304) και απαντά 416 σε εύρος εκτός
 * αρχείου — δες `lib/serve-file.ts`. Ο έλεγχος δικαιωμάτων προηγείται ΚΑΘΕ διαδρομής.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.read');
  const { id } = await params;
  const doc = await prisma.ocrDocument.findUnique({ where: { id } });
  if (!doc) return new Response('not found', { status: 404 });
  return serveStoredFile(req, {
    key: doc.storageKey,
    contentType: doc.mimeType,
    fileName: doc.fileName,
  });
}
