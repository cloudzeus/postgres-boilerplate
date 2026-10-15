import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyDelete, bunnyUploadPrivate } from '@/lib/bunny';
import { extractPageTexts } from '@/lib/ocr/pdf-text';
import { pdfPageCount } from '@/lib/ocr/split-pdf';
import { suggestSplits, suggestSplitsFromSignals, mergeSignals, textSignalOf, MAX_SPLIT_PAGES } from '@/lib/ocr/split';
import { analyzePagesForSplit, type PageInfo } from '@/lib/ocr/split-vision';
import { MAX_SPLIT_BYTES, MAX_SPLIT_MB } from '@/lib/ocr/limits';
import { isPdfBuffer } from '@/lib/ocr/rasterize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Ανέβασμα + καταμέτρηση σελίδων + εξαγωγή κειμένου· καμία κλήση σε μοντέλο, αλλά ένα PDF 100
// σελίδων θέλει χρόνο.
export const maxDuration = 300;

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

  // ΠΡΙΝ διαβαστεί το σώμα: ένα αρχείο 300 MB δεν έχει λόγο να ταξιδέψει ολόκληρο και να μπει
  // στη μνήμη μόνο για να απορριφθεί. Το `content-length` μπορεί να λείπει (chunked) — τότε
  // πέφτουμε στον έλεγχο μεγέθους του ίδιου του αρχείου παρακάτω.
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_SPLIT_BYTES * 1.05) {
    return NextResponse.json({ error: `Το αρχείο ξεπερνά τα ${MAX_SPLIT_MB} MB.` }, { status: 413 });
  }

  const form = await req.formData();
  const file = form.get('file');
  const language = String(form.get('language') ?? 'el');
  /**
   * `auto`: το κάλεσε το απλό ανέβασμα, όχι ο χρήστης. Αν το αρχείο είναι ΕΝΑ παραστατικό, η απάντηση
   * είναι σκέτο `{ single: true }` — χωρίς φάκελο, χωρίς προεπισκόπηση — και το ανέβασμα συνεχίζει
   * κανονικά. Πριν, ο διαχωρισμός γινόταν ΜΟΝΟ αν ο χρήστης άναβε από πριν «πολλά παραστατικά»
   * (κρυμμένο σε κλειστή φόρμα): ένα PDF με 4 τιμολόγια διαβαζόταν ως ένα, με το πρώτο μόνο.
   */
  const auto = String(form.get('auto') ?? '') === '1';

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required (multipart/form-data)' }, { status: 400 });
  }
  if (file.size > MAX_SPLIT_BYTES) {
    return NextResponse.json({ error: `Το αρχείο ξεπερνά τα ${MAX_SPLIT_MB} MB.` }, { status: 413 });
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
  // Μία σελίδα = ένα παραστατικό· τίποτα να αναλυθεί.
  if (auto && pageCount === 1) return NextResponse.json({ single: true, pageCount });
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

  // Το text layer δίνει τα σήματα του διαχωρισμού δωρεάν. Όταν λείπει έστω και από μία σελίδα
  // (σαρωμένο PDF), ΜΙΑ κλήση στο μοντέλο αναλύει όλες τις σελίδες (`lib/ocr/split-vision.ts`) και
  // τα σήματά της συμπληρώνουν όσα δεν δίνει το κείμενο. Αν η ανάλυση αποτύχει, μένει η παλιά
  // πρόταση (κείμενο, ή «ένα ανά σελίδα»), που το λέμε ρητά στη διεπαφή.
  const texts = await extractPageTexts(buffer, pageCount);
  const pages = Array.from({ length: pageCount }, (_, i) => ({ text: texts[i] ?? '' }));
  const hasTextLayer = pages.some((p) => p.text.trim() !== '');
  const fullTextLayer = pages.every((p) => p.text.trim().length >= 40);

  let suggested = suggestSplits(pages);
  let method: 'text' | 'vision' | 'per_page' = hasTextLayer ? 'text' : 'per_page';
  let info: PageInfo[] | null = null;
  let visionError: string | null = null;
  if (!fullTextLayer && pageCount > 1) {
    const vision = await analyzePagesForSplit(buffer, pageCount);
    if (vision && 'signals' in vision) {
      suggested = suggestSplitsFromSignals(pages.map((p, i) => mergeSignals(textSignalOf(p.text), vision.signals[i])));
      method = 'vision';
      info = vision.info;
    } else if (vision && 'error' in vision) {
      visionError = vision.error;
    }
  }

  // Αυτόματος έλεγχος που βρήκε ΕΝΑ παραστατικό: ο φάκελος δεν χρειάζεται — σβήνεται, για να μη
  // γεμίζει η λίστα φακέλων με άδειους από κάθε πολυσέλιδο τιμολόγιο.
  if (auto && suggested.length <= 1) {
    await bunnyDelete([sourceKey]).catch(() => null);
    await prisma.ocrBatch.delete({ where: { id: batch.id } }).catch(() => null);
    return NextResponse.json({ single: true, pageCount, method, visionError });
  }

  return NextResponse.json({
    batchId: batch.id,
    pageCount,
    hasTextLayer,
    suggested,
    method,
    visionError,
    pages: pages.map((_, index) => ({
      index,
      info: info?.[index] ?? null,
      // Η μικρογραφία φτιάχνεται ΤΕΜΠΕΛΙΚΑ, όταν ο browser ζητήσει την εικόνα: 100 renders μέσα
      // στο ίδιο αίτημα θα κρατούσαν τον χρήστη να κοιτάει έναν φορτωτή για λεπτά.
      thumbUrl: `/api/admin/ocr/batches/${batch.id}/page-image?page=${index}&scale=2`,
    })),
  });
}
