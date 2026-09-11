import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyUploadPrivate } from '@/lib/bunny';
import { extractPageTexts } from '@/lib/ocr/pdf-text';
import { pdfPageCount } from '@/lib/ocr/split-pdf';
import { suggestSplits, MAX_SPLIT_PAGES } from '@/lib/ocr/split';
import { isPdfBuffer } from '@/lib/ocr/rasterize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Ανέβασμα + καταμέτρηση σελίδων + εξαγωγή κειμένου· καμία κλήση σε μοντέλο, αλλά ένα PDF 100
// σελίδων θέλει χρόνο.
export const maxDuration = 300;

// ΤΟ ΙΔΙΟ όριο με το κανονικό ανέβασμα (`app/api/admin/ocr/route.ts`) — και το ίδιο που λέει η
// περιοχή drop. Δύο διαφορετικά όρια στην ίδια οθόνη είναι απλώς μια υπόσχεση που δεν τηρείται.
const MAX_SPLIT_BYTES = 25 * 1024 * 1024;

/**
 * ΒΗΜΑ 1 του διαχωρισμού: ανεβάζει ΜΙΑ φορά το πρωτότυπο PDF, μετράει σελίδες και προτείνει
 * κοψίματα. Δεν δημιουργεί κανένα έγγραφο και δεν καλεί κανένα μοντέλο — ό,τι στοιχίζει γίνεται
 * στο βήμα 2, αφού ο άνθρωπος δει τις σελίδες και επιβεβαιώσει.
 *
 * Ο φάκελος (`OcrBatch`) φτιάχνεται ΕΔΩ, ώστε το πρωτότυπο να έχει μόνιμη θέση
 * (`ocr/batches/{id}/source.pdf`) και το βήμα 2 να μη χρειάζεται να εμπιστευτεί κλειδί αποθήκευσης
 * που του δίνει ο browser. Ένας φάκελος που ο χρήστης εγκατέλειψε μένει άδειος — ακριβώς όπως και
 * στο ανέβασμα φακέλου, που δημιουργεί κι αυτό τον φάκελο πριν από τα αρχεία του.
 */
export async function POST(req: Request) {
  const user = await requirePermission('ocr.create');

  const form = await req.formData();
  const file = form.get('file');
  const language = String(form.get('language') ?? 'el');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required (multipart/form-data)' }, { status: 400 });
  }
  if (file.size > MAX_SPLIT_BYTES) {
    return NextResponse.json(
      { error: `Το αρχείο ξεπερνά τα ${MAX_SPLIT_BYTES / (1024 * 1024)} MB.` },
      { status: 413 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!isPdfBuffer(buffer)) {
    return NextResponse.json(
      { error: 'Ο διαχωρισμός αφορά μόνο αρχεία PDF. Για εικόνες ανέβασε κάθε παραστατικό ξεχωριστά.' },
      { status: 415 },
    );
  }

  let pageCount: number;
  try {
    pageCount = await pdfPageCount(buffer);
  } catch (err: any) {
    return NextResponse.json(
      { error: `Το PDF δεν διαβάζεται: ${String(err?.message ?? err).slice(0, 200)}` },
      { status: 422 },
    );
  }
  if (pageCount < 1) {
    return NextResponse.json({ error: 'Το PDF δεν έχει σελίδες.' }, { status: 422 });
  }
  if (pageCount > MAX_SPLIT_PAGES) {
    return NextResponse.json(
      {
        error: `Το PDF έχει ${pageCount} σελίδες — ο διαχωρισμός υποστηρίζει έως ${MAX_SPLIT_PAGES}. `
          + 'Χώρισέ το σε μικρότερα αρχεία και ξαναδοκίμασε.',
      },
      { status: 422 },
    );
  }

  const batch = await prisma.ocrBatch.create({
    data: {
      name: (file.name || 'Πολλαπλά παραστατικά').slice(0, 120),
      docType: 'INVOICE',
      language,
      createdById: user.id,
    },
  });
  const sourceKey = `ocr/batches/${batch.id}/source.pdf`;
  await bunnyUploadPrivate({ key: sourceKey, body: buffer, contentType: 'application/pdf' });
  await prisma.ocrBatch.update({
    where: { id: batch.id },
    data: { sourceKey, sourceName: file.name || 'source.pdf', sourcePages: pageCount },
  });

  // Το text layer δίνει τα σήματα του διαχωρισμού. Σαρωμένο PDF δεν έχει — και τότε η πρόταση
  // γίνεται «ένα παραστατικό ανά σελίδα», που το λέμε ρητά στη διεπαφή.
  const texts = await extractPageTexts(buffer, pageCount);
  const pages = Array.from({ length: pageCount }, (_, i) => ({ text: texts[i] ?? '' }));
  const hasTextLayer = pages.some((p) => p.text.trim() !== '');
  const suggested = suggestSplits(pages);

  return NextResponse.json({
    batchId: batch.id,
    pageCount,
    hasTextLayer,
    suggested,
    pages: pages.map((_, index) => ({
      index,
      // Η μικρογραφία φτιάχνεται ΤΕΜΠΕΛΙΚΑ, όταν ο browser ζητήσει την εικόνα: 100 renders μέσα
      // στο ίδιο αίτημα θα κρατούσαν τον χρήστη να κοιτάει έναν φορτωτή για λεπτά.
      thumbUrl: `/api/admin/ocr/batches/${batch.id}/page-image?page=${index}&scale=2`,
    })),
  });
}
