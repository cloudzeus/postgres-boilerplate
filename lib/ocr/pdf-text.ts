// lib/ocr/pdf-text.ts — SERVER-ONLY. Το κείμενο ΑΝΑ ΣΕΛΙΔΑ ενός PDF.
//
// Το `lib/ocr/extract.ts` ενώνει όλες τις σελίδες σε ένα κείμενο — σωστό για την εξαγωγή πεδίων,
// άχρηστο για τον διαχωρισμό: εκεί η ερώτηση είναι ακριβώς «τι λέει Η ΚΑΘΕ σελίδα».
//
// ΓΙΑΤΙ PDFIUM ΚΑΙ ΟΧΙ PDFJS: ο pdfjs στο Node φορτώνει τον worker του με δυναμικό import, που
// κάτω από το Turbopack γίνεται «Cannot find package '[project]'» — δηλαδή ΚΑΘΕ ψηφιακό PDF θα
// φαινόταν σαρωμένο και η πρόταση διαχωρισμού θα κατέρρεε σε «ένα ανά σελίδα». Το PDFium (WASM)
// είναι ήδη η μηχανή που ρασταροποιεί τις σελίδες εδώ μέσα και δεν έχει worker καθόλου.
//
// ΠΟΤΕ δεν πετάει: ένα σαρωμένο PDF δεν έχει text layer, και αυτό ΔΕΝ είναι σφάλμα — είναι η
// απάντηση «καμία ένδειξη», που ο `suggestSplits` μεταφράζει σε «ένα παραστατικό ανά σελίδα».
import { getPdfiumLibrary } from '@/lib/ocr/rasterize';

/** Κείμενο ανά σελίδα. Κενό string για σελίδα χωρίς text layer (σαρωμένη). */
export async function extractPageTexts(buffer: Buffer, maxPages = 200): Promise<string[]> {
  try {
    const library = await getPdfiumLibrary();
    const doc = await library.loadDocument(new Uint8Array(buffer));
    try {
      const pages = Math.min(doc.getPageCount(), maxPages);
      const out: string[] = [];
      for (let i = 0; i < pages; i++) {
        try {
          out.push(String(doc.getPage(i).getText() ?? '').replace(/[ \t]+/g, ' ').trim());
        } catch {
          // Μια σελίδα που δεν διαβάζεται δεν ακυρώνει τις υπόλοιπες — μετράει ως «χωρίς ένδειξη».
          out.push('');
        }
      }
      return out;
    } finally {
      doc.destroy();
    }
  } catch (err) {
    // Δεν είναι μοιραίο — απλώς «καμία ένδειξη». Το λέμε όμως δυνατά: αν το text layer υπάρχει και
    // δεν το διαβάσαμε, ο χρήστης θα δει πρόταση «ένα ανά σελίδα» χωρίς να ξέρει γιατί.
    console.error('[ocr] extractPageTexts', (err as Error)?.message ?? err);
    return [];
  }
}
