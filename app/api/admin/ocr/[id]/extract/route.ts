import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyDownload } from '@/lib/bunny';
import { extractAndPersist } from '@/lib/ocr/pipeline';
import { isExtractDocType, type ExtractDocType } from '@/lib/ocr/templates';
import type { SupportedLang } from '@/lib/ocr/templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Μία ανάγνωση (και η εκτέλεση προτύπου που ακολουθεί) ξεπερνάει άνετα τα 60s του προεπιλεγμένου.
export const maxDuration = 300;

/**
 * Διαβάζει ΕΝΑ έγγραφο που υπάρχει ήδη ως αρχείο αλλά δεν έχει διαβαστεί ακόμη — τα παιδιά ενός
 * διαχωρισμένου PDF, και οτιδήποτε έμεινε PENDING ή FAILED. Ίδια διαδρομή με το ανέβασμα
 * (`extractAndPersist`), ίδιο μοντέλο, ίδιες παρενέργειες.
 *
 * Ένα ήδη COMPLETED έγγραφο ΔΕΝ ξαναδιαβάζεται από εδώ: αυτό είναι δουλειά του `reextract`, που
 * ζητάει ρητή επιβεβαίωση γιατί σβήνει την προηγούμενη ανάγνωση.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.create');
  const { id } = await params;

  const body = await req.json().catch(() => null) as { docType?: unknown } | null;
  const requested = body?.docType;
  if (requested !== undefined && !isExtractDocType(requested)) {
    return NextResponse.json({ error: `Invalid docType: ${String(requested)}` }, { status: 400 });
  }
  const docType: ExtractDocType = (requested as ExtractDocType | undefined) ?? 'auto';

  const doc = await prisma.ocrDocument.findUnique({ where: { id } });
  if (!doc) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (doc.status === 'COMPLETED') {
    return NextResponse.json({ error: 'Το έγγραφο έχει ήδη διαβαστεί.' }, { status: 409 });
  }
  if (doc.status === 'PROCESSING') {
    return NextResponse.json({ error: 'Η ανάγνωση είναι ήδη σε εξέλιξη.' }, { status: 409 });
  }

  await prisma.ocrDocument.update({
    where: { id },
    data: { status: 'PROCESSING', errorMessage: null },
  });

  try {
    const buffer = await bunnyDownload(doc.storageKey);
    const { data, durationMs, templateRun } = await extractAndPersist({
      documentId: id,
      buffer: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer as ArrayBuffer),
      mimeType: doc.mimeType,
      docType,
      language: doc.language as SupportedLang,
      pdfSource: 'auto',
      trigger: 'upload',
    });
    return NextResponse.json({ id, data, durationMs, templateRun });
  } catch (err: any) {
    await prisma.ocrDocument.update({
      where: { id },
      data: { status: 'FAILED', errorMessage: String(err?.message ?? err).slice(0, 2000) },
    });
    return NextResponse.json({ id, error: String(err?.message ?? err) }, { status: 422 });
  }
}
