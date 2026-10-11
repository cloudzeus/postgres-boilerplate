import { NextResponse } from 'next/server';
import { customAlphabet } from 'nanoid';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { bunnyDownload, bunnyUploadPrivate } from '@/lib/bunny';
import { renderPage } from '@/lib/ocr/rasterize';
import { planSplit, cropRegion } from '@/lib/ocr/split-regions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const slug = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8);

/**
 * ΔΙΑΧΩΡΙΣΜΟΣ ΜΙΑΣ ΣΕΛΙΔΑΣ ΣΕ ΔΥΟ ΠΑΡΑΣΤΑΤΙΚΑ (δύο αποδείξεις δίπλα-δίπλα ή η μία κάτω από την άλλη).
 *
 * `{ apply: false }` (προεπιλογή) = μόνο το σχέδιο: πού θα κοπεί και πόσο φαρδιά είναι η λευκή
 * λωρίδα. `{ apply: true }` = κόβει, φτιάχνει δύο νέα παραστατικά σε αναμονή εξαγωγής.
 *
 * ΤΟ ΠΡΩΤΟΤΥΠΟ ΔΕΝ ΧΑΝΕΤΑΙ. Γίνεται «πηγή» ενός φακέλου (`OcrBatch.sourceKey`) — το ίδιο μοντέλο
 * με τον διαχωρισμό PDF ανά σελίδα — και τα δύο κομμάτια ανήκουν σε αυτόν. Η γραμμή του αρχικού
 * παραστατικού φεύγει από τη λίστα, γιατί αλλιώς το ίδιο ποσό θα μετρούσε τρεις φορές· το αρχείο
 * του μένει στη θέση του, προσβάσιμο από τον φάκελο.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requirePermission('ocr.create');
  const { id } = await params;
  const apply = ((await req.json().catch(() => ({}))) as { apply?: unknown }).apply === true;

  const doc = await prisma.ocrDocument.findUnique({ where: { id } });
  if (!doc) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (doc.postStatus === 'POSTED') {
    return NextResponse.json({ error: 'posted', message: 'Αναρτημένο παραστατικό δεν διαχωρίζεται.' }, { status: 409 });
  }

  let page: Buffer;
  try {
    const file = await bunnyDownload(doc.storageKey);
    page = await renderPage(Buffer.isBuffer(file) ? file : Buffer.from(file), doc.mimeType, 0);
  } catch (e) {
    return NextResponse.json({ error: 'file_unavailable', message: (e as Error).message }, { status: 502 });
  }

  const plan = await planSplit(page);
  if (plan.axis === 'none') {
    return NextResponse.json({
      error: 'no_gap', plan,
      message: 'Δεν βρέθηκε καθαρή λευκή λωρίδα ανάμεσα σε δύο παραστατικά — η σελίδα φαίνεται να είναι ένα.',
    }, { status: 422 });
  }
  if (!apply) return NextResponse.json({ plan });

  const base = doc.fileName.replace(/\.[^./]+$/, '');
  const batch = await prisma.ocrBatch.create({
    data: {
      name: base, docType: doc.docType, language: doc.language ?? 'el', createdById: u.id,
      sourceKey: doc.storageKey, sourceName: doc.fileName, sourcePages: 1,
    },
  });

  const created: { id: string; fileName: string }[] = [];
  for (const [i, r] of plan.regions.entries()) {
    const png = await cropRegion(page, r);
    const storageKey = `ocr/batches/${batch.id}/${slug()}-${i + 1}.png`;
    await bunnyUploadPrivate({ key: storageKey, body: png, contentType: 'image/png' });
    const fileName = `${base} — ${i + 1} από ${plan.regions.length}.png`;
    const child = await prisma.ocrDocument.create({
      data: {
        fileName, originalName: doc.fileName, storageKey, publicUrl: `bunny:${storageKey}`,
        mimeType: 'image/png', size: png.length, docType: doc.docType, language: doc.language,
        status: 'PENDING', batchId: batch.id, createdById: u.id,
      },
    });
    created.push({ id: child.id, fileName });
  }

  await prisma.ocrDocument.delete({ where: { id: doc.id } });
  await logAudit({
    userId: u.id, userEmail: u.email,
    action: 'ocr.document.split_regions', resource: 'ocr_document', resourceId: doc.id,
    metadata: { fileName: doc.fileName, batchId: batch.id, axis: plan.axis, gapRatio: plan.gapRatio, children: created.map((c) => c.id) },
  }).catch(() => null);

  return NextResponse.json({ plan, batchId: batch.id, documents: created });
}
