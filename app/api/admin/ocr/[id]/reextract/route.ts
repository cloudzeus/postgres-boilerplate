import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { bunnyDownload } from '@/lib/bunny';
import { extractDocument, UPGRADED_VISION_MODEL } from '@/lib/ocr/extract';
import { buildSoftoneMatch, matchDocItems, buildDuplicateCheck } from '@/lib/ocr/softone-match';
import { loadDocumentJson, saveDocumentJson } from '@/lib/ocr/document';
import { runMatchingTemplate } from '@/lib/templates/run';
import { classifyDocument } from '@/lib/ocr/doc-type';
import { docTypeFromKind, type DocumentJson } from '@/lib/ocr/canonical';
import { isExtractDocType, type ExtractDocType } from '@/lib/ocr/templates';
import { loadIssuerExample } from '@/lib/ocr/example-lookup';
import { normalizeAfm } from '@/lib/ocr/validate';
import { totalsClose } from '@/lib/ocr/invoice-math';
import type { RunOutcome } from '@/lib/templates/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Re-extraction plus a template run (one vision call per region) easily outruns the 60s default.
export const maxDuration = 300;

/** Σύνοψη μιας ανάγνωσης για τη σύγκριση «πριν → μετά» στο UI. */
function summary(d: DocumentJson | null) {
  if (!d) return null;
  const sumLines = Math.round(d.lines.reduce((t, l) => t + (l.net ?? 0), 0) * 100) / 100;
  return {
    lines: d.lines.length, sumLines, net: d.totals.net, vat: d.totals.vatAmount, total: d.totals.total,
    issuer: d.issuer.name, afm: d.issuer.vat, number: d.type.number, date: d.date,
    closes: totalsClose({
      items: d.lines.map((l) => ({ quantity: l.quantity, price: l.unitPrice, discount: l.discount, vatRate: l.vatRate, total: l.net })),
      subtotal: d.totals.net, vatAmount: d.totals.vatAmount, otherCharges: d.totals.fees, totalAmount: d.totals.total,
    }),
  };
}

/**
 * ΕΠΑΝΑΣΑΡΩΣΗ: ξαναδιαβάζει το αρχείο από την αρχή με την τρέχουσα έκδοση της εφαρμογής (οδηγίες
 * ανάγνωσης, κανόνες) και το ισχυρότερο μοντέλο — για όταν η πρώτη ανάγνωση έχασε κάτι.
 *
 * ΤΙ ΚΡΑΤΙΕΤΑΙ (δουλειά χεριού): η σειρά που διάλεξε ο χρήστης, ο συναλλασσόμενος αν ο ΑΦΜ δεν
 * άλλαξε, η κατηγορία, και ανά γραμμή η αντιστοίχιση SoftOne και τα αναλυτικά (ίδιος κωδικός/
 * περιγραφή). ΤΙ ΧΑΝΕΤΑΙ: οι χειροκίνητες διορθώσεις πεδίων/γραμμών και οι επιμερισμοί — το λέει
 * το παράθυρο πριν από το κλικ. Καταχωρισμένο παραστατικό ΔΕΝ ξαναδιαβάζεται.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('ocr.create');
  const { id } = await params;

  // Ο τύπος της ΔΕΥΤΕΡΗΣ ανάγνωσης. Προεπιλογή «auto»: αν η πρώτη ανάγνωση είχε ταξινομήσει
  // λάθος (π.χ. απόδειξη που ήταν τιμολόγιο), η επανεκτέλεση είναι ακριβώς η στιγμή να το
  // διορθώσει. Παλιοί clients στέλνουν άδειο σώμα — και παίρνουν το ίδιο «auto».
  const body = await req.json().catch(() => null) as { docType?: unknown } | null;
  const requested = body?.docType;
  if (requested !== undefined && !isExtractDocType(requested)) {
    return NextResponse.json({ error: `Invalid docType: ${String(requested)}` }, { status: 400 });
  }
  const docType: ExtractDocType = (requested as ExtractDocType | undefined) ?? 'auto';

  const doc = await prisma.ocrDocument.findUnique({ where: { id } });
  if (!doc) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (doc.postStatus === 'POSTED') {
    return NextResponse.json({ error: 'posted', message: 'Το παραστατικό έχει καταχωριστεί στη SoftOne — δεν ξαναδιαβάζεται. Αν η καταχώριση ήταν λάθος, ακύρωσέ την πρώτα στη SoftOne.' }, { status: 409 });
  }
  if (doc.postStatus === 'PENDING' || doc.status === 'PROCESSING') {
    return NextResponse.json({ error: 'busy', message: 'Το παραστατικό επεξεργάζεται αυτή τη στιγμή — δοκίμασε σε λίγο.' }, { status: 409 });
  }
  const before = await loadDocumentJson(id).catch(() => null);

  // Flag as PROCESSING immediately so the UI can render a progress bar while
  // we hit the LLM. Returns to COMPLETED / FAILED below in the same request.
  await prisma.ocrDocument.update({ where: { id }, data: { status: 'PROCESSING', errorMessage: null } });

  let vat: unknown = null;
  let ok: { model: string; data: unknown; before: ReturnType<typeof summary>; after: ReturnType<typeof summary> } | null = null;
  let failure: string | null = null;

  try {
    const buffer = await bunnyDownload(doc.storageKey);
    const result = await extractDocument({
      buffer,
      mimeType: doc.mimeType,
      docType,
      language: doc.language as never,
      pdfSource: doc.mimeType === 'application/pdf' ? 'scanned' : undefined,
      // ΕΔΩ, και μόνο εδώ, το παράδειγμα είναι δωρεάν: το έγγραφο κουβαλάει ήδη το ΑΦΜ του εκδότη
      // από την πρώτη ανάγνωση, οπότε βρίσκουμε το επιβεβαιωμένο «αδελφάκι» του χωρίς δεύτερη
      // κλήση στο μοντέλο. Σε νέο ανέβασμα ο εκδότης είναι άγνωστος μέχρι να διαβαστεί η σελίδα.
      example: await loadIssuerExample(doc.issuerAfm, { excludeId: id }),
      // Ισχυρότερο μοντέλο ΜΟΝΟ για αυτή την κλήση (όχι αλλαγή της γενικής ρύθμισης).
      visionModel: UPGRADED_VISION_MODEL,
    });

    // ΣΥΝΑΛΛΑΣΣΟΜΕΝΟΣ: αν ο ΑΦΜ δεν άλλαξε και υπάρχει ήδη καρτέλα (ίσως διαλεγμένη με το χέρι),
    // μένει. Νέα αντιστοίχιση μόνο όταν η νέα ανάγνωση βρήκε ΑΛΛΟΝ εκδότη.
    const sameIssuer = doc.softoneTrdr != null && normalizeAfm(result.document.issuer.vat) === doc.issuerAfm;
    const softone = sameIssuer ? {} : await buildSoftoneMatch(result.document.issuer.vat);

    // Ο ΕΝΑΣ γραφέας: κανονικό έγγραφο + παράγωγα + γραμμές. Οι γραμμές ξαναχτίζονται κρατώντας
    // αντιστοίχιση SoftOne και αναλυτικά της παλιάς γραμμής με ίδιο κωδικό/περιγραφή.
    await saveDocumentJson(id, result.document, { replaceItems: true });

    await prisma.ocrDocument.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        // Το είδος ξανακρίνεται από την ίδια την ανάγνωση (βλ. upload route).
        docType: docTypeFromKind(result.document.kind),
        rawText: result.rawText,
        model: result.model,
        tokensUsed: result.tokensUsed,
        durationMs: result.durationMs,
        completedAt: new Date(),
        errorMessage: null,
        // Η ανάγνωση άλλαξε: η «επιβεβαίωση» αφορούσε την παλιά.
        verifiedAt: null,
        verifiedById: null,
        ...softone,
      },
    });

    await matchDocItems(id).catch(() => null);
    const trdr = (softone as { softoneTrdr?: number | null }).softoneTrdr ?? (sameIssuer ? doc.softoneTrdr : null);
    if (trdr) {
      const dup = await buildDuplicateCheck(trdr, result.document.type, result.document.date);
      await prisma.ocrDocument.update({ where: { id }, data: dup }).catch(() => null);
    }
    // Σειρά παραστατικού — ποτέ πάνω από χειροκίνητη επιλογή.
    await classifyDocument(id);

    vat = result.document.issuer.vat;
    ok = { model: result.model, data: result.data, before: summary(before), after: summary(result.document) };
  } catch (err) {
    // Η ΠΑΛΙΑ ανάγνωση είναι ακόμη στη θέση της (δεν γράφτηκε τίποτα): το έγγραφο επιστρέφει
    // ΟΛΟΚΛΗΡΩΜΕΝΟ, όχι «Απέτυχε» — μια αποτυχημένη δεύτερη γνώμη δεν ακυρώνει την πρώτη.
    failure = String((err as Error)?.message ?? err);
    await prisma.ocrDocument.update({
      where: { id },
      data: before ? { status: 'COMPLETED', errorMessage: null } : { status: 'FAILED', errorMessage: failure.slice(0, 2000) },
    });
  }

  await logAudit({
    userId: user.id, userEmail: user.email, action: 'ocr.reextract', resource: 'ocr_document', resourceId: id,
    metadata: { docType, ok: !!ok, error: failure?.slice(0, 300) ?? null, before: ok?.before ?? summary(before), after: ok?.after ?? null },
  }).catch(() => null);

  if (!ok) return NextResponse.json({ error: 'reextract_failed', message: `Η επανασάρωση απέτυχε — η προηγούμενη ανάγνωση έμεινε ως είχε. (${failure?.slice(0, 200)})` }, { status: 422 });

  // Extraction template linked to this issuer (spec §15.1). Best-effort; failures become a FAILED run.
  const templateRun: RunOutcome | null = await runMatchingTemplate(id, vat, 'reextract');
  return NextResponse.json({ ok: true, ...ok, templateRun });
}
