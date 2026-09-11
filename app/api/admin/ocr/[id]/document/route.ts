// GET /api/admin/ocr/[id]/document → ο φάκελος του κανονικού JSON εγγράφου (spec §17.1).
// `?download=1` το κατεβάζει ως αρχείο. Ίδιο δικαίωμα με την ανάγνωση του εγγράφου.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { DOCUMENT_VERSION, type DocumentEnvelope } from '@/lib/ocr/canonical';
import { loadDocumentJson } from '@/lib/ocr/document';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `Content-Disposition` με ελληνικό όνομα αρχείου: το ASCII σκέλος είναι η εφεδρεία για παλιούς
 * clients, το `filename*` (RFC 5987) κουβαλάει το πραγματικό. Τα εισαγωγικά και οι αλλαγές γραμμής
 * φεύγουν — ένα όνομα αρχείου δεν επιτρέπεται να σπάσει την κεφαλίδα.
 */
function attachment(name: string): string {
  const safe = name.replace(/[\r\n"\\]/g, '_');
  const ascii = safe.replace(/[^\x20-\x7E]/g, '_') || 'document.json';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.read');
  const { id } = await params;

  const doc = await prisma.ocrDocument.findUnique({
    where: { id },
    select: { id: true, originalName: true, fileName: true, completedAt: true, createdAt: true },
  });
  if (!doc) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Το πρότυπο του φακέλου είναι η ΤΕΛΕΥΤΑΙΑ εκτέλεση που έβγαλε τιμές: μια FAILED δεν πρόλαβε να
  // γράψει τίποτα στο έγγραφο, οπότε δεν είναι αυτή που το εξήγησε. Ίδιο tie-break με την κάρτα.
  const run = await prisma.templateRun.findFirst({
    where: { documentId: id, status: { not: 'FAILED' } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { template: { select: { slug: true } } },
  });

  const file = doc.originalName || doc.fileName;
  const envelope: DocumentEnvelope = {
    template: run?.template.slug ?? null,
    version: DOCUMENT_VERSION,
    extractedAt: (doc.completedAt ?? doc.createdAt).toISOString(),
    file,
    documentId: doc.id,
    document: await loadDocumentJson(id),
  };

  const download = new URL(req.url).searchParams.get('download');
  return NextResponse.json(envelope, {
    headers: download ? { 'Content-Disposition': attachment(`${file}.json`) } : undefined,
  });
}
