// lib/ocr/pipeline.ts — SERVER-ONLY. Η ΜΙΑ διαδρομή «διάβασε ένα αρχείο και γράψε το έγγραφο».
//
// Ζούσε μέσα στο route του ανεβάσματος. Από τη στιγμή που το ίδιο πράγμα πρέπει να γίνει και για
// κάθε κομμάτι ενός διαχωρισμένου PDF (και για ένα έγγραφο που έμεινε PENDING), αντιγραφή δεν
// χωράει: θα ήταν δύο διαδρομές που αποκλίνουν σιωπηλά — η μία με έλεγχο διπλοεγγραφής, η άλλη
// χωρίς· η μία με ταξινόμηση σειράς, η άλλη όχι.
import { prisma } from '@/lib/db';
import { extractDocument, type PdfSource } from '@/lib/ocr/extract';
import { buildSoftoneMatch, matchDocItems, buildDuplicateCheck } from '@/lib/ocr/softone-match';
import { ensureOcrThumbnail } from '@/lib/ocr/thumbnail';
import { saveDocumentJson } from '@/lib/ocr/document';
import { docTypeFromKind } from '@/lib/ocr/canonical';
import { classifyDocument } from '@/lib/ocr/doc-type';
import { runMatchingTemplate } from '@/lib/templates/run';
import type { ExtractDocType, SupportedLang } from '@/lib/ocr/templates';
import type { RunOutcome, RunTrigger } from '@/lib/templates/schema';

export interface ExtractAndPersistInput {
  documentId: string;
  buffer: Buffer;
  mimeType: string;
  docType: ExtractDocType;
  language: SupportedLang;
  pdfSource?: PdfSource;
  trigger: RunTrigger;
  /** Παράδειγμα αναφοράς του ίδιου εκδότη, όταν το ΑΦΜ είναι ήδη γνωστό (βλ. `example-lookup`). */
  example?: unknown;
}

export interface ExtractAndPersistResult {
  data: unknown;
  durationMs: number;
  templateRun: RunOutcome | null;
}

/**
 * Διαβάζει το αρχείο, γράφει το κανονικό έγγραφο και ΟΛΑ τα παράγωγά του, και αφήνει το
 * `OcrDocument` COMPLETED. Ο καλών έχει ήδη δημιουργήσει τη γραμμή και είναι υπεύθυνος να τη
 * γυρίσει σε FAILED αν εδώ πεταχτεί σφάλμα — έτσι το μήνυμα λάθους φτάνει στον χρήστη που περιμένει.
 */
export async function extractAndPersist(input: ExtractAndPersistInput): Promise<ExtractAndPersistResult> {
  const { documentId, buffer, mimeType, docType, language, pdfSource, trigger, example } = input;

  const result = await extractDocument({
    buffer, mimeType, docType, language,
    pdfSource: mimeType === 'application/pdf' ? pdfSource : undefined,
    example,
  });

  // Το είδος το λέει ΤΟ ΙΔΙΟ ΤΟ ΕΓΓΡΑΦΟ (`document.kind`): στο «auto» είναι η απάντηση του
  // μοντέλου, στις ρητές επιλογές το ίδιο `kind` που έχει ήδη επιβληθεί από το `coerceDocument`.
  const resolvedDocType = docTypeFromKind(result.document.kind);

  // Tag with the SoftOne supplier (issuer ΑΦΜ → TRDR SODTYPE=12). Best-effort.
  const softone = await buildSoftoneMatch(result.document.issuer.vat);

  // Το κανονικό έγγραφο και ΟΛΑ τα παράγωγά του (`extractedData`, `issuerAfm`, γραμμές) σε ένα
  // transaction, από τον έναν γραφέα. Πρώτα τα δεδομένα και μετά το `COMPLETED`: αν σκάσει το
  // γράψιμο, το έγγραφο μένει PROCESSING και πιάνεται από τον καλούντα — ποτέ «ολοκληρωμένο κενό».
  await saveDocumentJson(documentId, result.document, { replaceItems: true });

  await prisma.ocrDocument.update({
    where: { id: documentId },
    data: {
      status: 'COMPLETED',
      docType: resolvedDocType,
      rawText: result.rawText,
      model: result.model,
      tokensUsed: result.tokensUsed,
      durationMs: result.durationMs,
      completedAt: new Date(),
      errorMessage: null,
      ...softone,
      // Reflect the path actually taken: rawText present ⇒ digital, otherwise scanned.
      pdfSource: mimeType === 'application/pdf' ? (result.rawText ? 'DIGITAL' : 'SCANNED') : null,
    },
  });

  // Auto-match invoice lines to SoftOne items (cheap local lookup; manual matches preserved).
  await matchDocItems(documentId).catch(() => null);

  // PURDOC duplicate check (supplier + αριθμός παραστατικού + ημ/νία). Best-effort.
  if (softone.softoneTrdr) {
    const dup = await buildDuplicateCheck(softone.softoneTrdr, result.document.type, result.document.date);
    await prisma.ocrDocument.update({ where: { id: documentId }, data: dup }).catch(() => null);
  }

  // Σειρά παραστατικού από τις ενεργοποιημένες σειρές αγορών/πιστωτών (spec 2026-09-11 §1). Best-effort.
  await classifyDocument(documentId);

  // Extraction template linked to this issuer (spec §15.1). Best-effort; failures become a FAILED run.
  const templateRun = await runMatchingTemplate(documentId, result.document.issuer.vat, trigger);

  // Best-effort thumbnail generation (don't fail the request if it errors).
  ensureOcrThumbnail(documentId).catch(() => null);

  return { data: result.data, durationMs: result.durationMs, templateRun };
}
