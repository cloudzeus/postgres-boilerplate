import { NextResponse } from 'next/server';
import { customAlphabet } from 'nanoid';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyDownload, bunnyUploadPrivate } from '@/lib/bunny';
import { buildSegmentPdf, segmentFileName } from '@/lib/ocr/split-pdf';
import { normalizeCuts, segmentsOf, MAX_SPLIT_PAGES } from '@/lib/ocr/split';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Κόψιμο + ανέβασμα ανά παιδί. Καμία κλήση σε μοντέλο εδώ (βλ. σχόλιο παρακάτω).
export const maxDuration = 300;

const slug = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8);

/**
 * ΒΗΜΑ 2 του διαχωρισμού: φτιάχνει ένα ΠΡΑΓΜΑΤΙΚΟ PDF ανά τμήμα και μία γραμμή `OcrDocument` για
 * το καθένα, σε κατάσταση PENDING.
 *
 * ΓΙΑΤΙ ΔΕΝ ΔΙΑΒΑΖΕΙ ΕΔΩ: η ανάγνωση ενός παραστατικού διαρκεί 5–25 δευτερόλεπτα. Είκοσι
 * παραστατικά είναι 5–8 λεπτά — πολύ πάνω από το `maxDuration` οποιουδήποτε αιτήματος, και ο
 * χρήστης θα κοίταζε έναν φορτωτή χωρίς να ξέρει τι προχωράει. Αντί γι' αυτό, τα έγγραφα
 * δημιουργούνται αμέσως (γρήγορο, χωρίς μοντέλο) και ο client τα διαβάζει ΕΝΑ-ΕΝΑ με
 * `POST /api/admin/ocr/{id}/extract`, δείχνοντας πρόοδο. Ό,τι μείνει PENDING (κλειστή καρτέλα,
 * πεσμένο δίκτυο) διαβάζεται αργότερα από τη λίστα — δεν χάνεται τίποτα.
 */
export async function POST(req: Request) {
  const user = await requirePermission('ocr.create');

  const body = await req.json().catch(() => null) as { batchId?: unknown; cuts?: unknown } | null;
  const batchId = typeof body?.batchId === 'string' ? body.batchId : '';
  if (!batchId) {
    return NextResponse.json({ error: 'batchId is required' }, { status: 400 });
  }
  if (!Array.isArray(body?.cuts)) {
    return NextResponse.json({ error: 'cuts must be an array of page indexes' }, { status: 400 });
  }

  const batch = await prisma.ocrBatch.findUnique({ where: { id: batchId } });
  if (!batch?.sourceKey) {
    return NextResponse.json({ error: 'Ο φάκελος δεν έχει πρωτότυπο αρχείο.' }, { status: 404 });
  }
  const existing = await prisma.ocrDocument.count({ where: { batchId } });
  if (existing > 0) {
    return NextResponse.json({ error: 'Ο φάκελος έχει ήδη διαχωριστεί.' }, { status: 409 });
  }

  const pageCount = batch.sourcePages ?? 0;
  if (pageCount < 1 || pageCount > MAX_SPLIT_PAGES) {
    return NextResponse.json({ error: 'Άκυρος αριθμός σελίδων πρωτοτύπου.' }, { status: 422 });
  }

  // Κάθε δείκτης εκτός ορίων είναι λάθος του client, όχι κάτι που «καθαρίζουμε» σιωπηλά: αν το
  // δεχόμασταν, ο χρήστης θα έπαιρνε άλλα παραστατικά από αυτά που είδε στην οθόνη.
  const raw = (body.cuts as unknown[]).map((c) => Math.trunc(Number(c)));
  if (raw.some((c) => !Number.isFinite(c) || c < 0 || c >= pageCount)) {
    return NextResponse.json({ error: 'Λίστα κοψιμάτων εκτός ορίων σελίδων.' }, { status: 400 });
  }
  const cuts = normalizeCuts(raw, pageCount);
  const segments = segmentsOf(cuts, pageCount);
  if (segments.length === 0) {
    return NextResponse.json({ error: 'Δεν προέκυψε κανένα παραστατικό.' }, { status: 400 });
  }

  let source: Buffer;
  try {
    const dl = await bunnyDownload(batch.sourceKey);
    source = Buffer.isBuffer(dl) ? dl : Buffer.from(dl as ArrayBuffer);
  } catch {
    return NextResponse.json({ error: 'Το πρωτότυπο αρχείο δεν είναι διαθέσιμο.' }, { status: 502 });
  }

  const sourceName = batch.sourceName ?? batch.name;
  const created: { id: string; fileName: string; from: number; to: number }[] = [];

  for (const [i, seg] of segments.entries()) {
    const child = await buildSegmentPdf(source, seg.from, seg.to);
    const fileName = segmentFileName(sourceName, i + 1, seg.from, seg.to);
    const storageKey = `ocr/batches/${batch.id}/${slug()}-${i + 1}.pdf`;
    await bunnyUploadPrivate({ key: storageKey, body: child, contentType: 'application/pdf' });

    const doc = await prisma.ocrDocument.create({
      data: {
        fileName,
        originalName: sourceName,
        storageKey,
        publicUrl: `bunny:${storageKey}`,
        mimeType: 'application/pdf',
        size: child.length,
        // Προσωρινό είδος: το πραγματικό το αποφασίζει η ανάγνωση (`document.kind`).
        docType: 'INVOICE',
        language: batch.language,
        status: 'PENDING',
        batchId: batch.id,
        createdById: user.id,
      },
    });
    created.push({ id: doc.id, fileName, from: seg.from, to: seg.to });
  }

  return NextResponse.json({ batchId: batch.id, documents: created });
}
