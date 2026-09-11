import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyDownload } from '@/lib/bunny';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Το ΠΡΩΤΟΤΥΠΟ PDF ενός φακέλου που προέκυψε από διαχωρισμό. Υπάρχει ώστε ο χρήστης να μπορεί
 * πάντα να δει τη στοίβα όπως σαρώθηκε — κυρίως όταν τα κοψίματα βγήκαν λάθος.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.read');
  const { id } = await params;
  const batch = await prisma.ocrBatch.findUnique({
    where: { id }, select: { sourceKey: true, sourceName: true },
  });
  if (!batch?.sourceKey) return new Response('not found', { status: 404 });
  const buf = await bunnyDownload(batch.sourceKey);
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${encodeURIComponent(batch.sourceName ?? 'source.pdf')}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
