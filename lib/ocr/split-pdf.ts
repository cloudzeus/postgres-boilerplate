// lib/ocr/split-pdf.ts — SERVER-ONLY (pdf-lib). Από ένα PDF με πολλά παραστατικά, ένα PDF ανά τμήμα.
//
// Γιατί ΠΡΑΓΜΑΤΙΚΑ παιδιά-αρχεία και όχι «σελίδες από…ώς» πάνω στο πρωτότυπο: όλο το κατάντη
// (μικρογραφία, εικόνα σελίδας, επανεκτέλεση, εκτέλεση προτύπου, ανάρτηση στο SoftOne) δουλεύει
// ήδη πάνω σε ΕΝΑ αρχείο ανά έγγραφο. Ένα εικονικό εύρος σελίδων θα ζητούσε να αλλάξουν όλα αυτά.
import { PDFDocument } from 'pdf-lib';

/**
 * Νέο PDF με τις σελίδες `from`..`to` (0-based, `to` ΜΕΣΑ) του πρωτοτύπου.
 * Πετάει όταν το εύρος δεν υπάρχει — ο καλών έχει ήδη επικυρώσει τα κοψίματα.
 */
export async function buildSegmentPdf(source: Buffer, from: number, to: number): Promise<Buffer> {
  const src = await PDFDocument.load(new Uint8Array(source), { ignoreEncryption: true });
  const count = src.getPageCount();
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to >= count) {
    throw new Error(`buildSegmentPdf: άκυρο εύρος σελίδων ${from}-${to} σε PDF ${count} σελίδων`);
  }
  const out = await PDFDocument.create();
  const indices = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const pages = await out.copyPages(src, indices);
  for (const page of pages) out.addPage(page);
  return Buffer.from(await out.save());
}

/** Ο αριθμός σελίδων ενός PDF, μέσω pdf-lib (ό,τι ακριβώς θα κοπεί). */
export async function pdfPageCount(source: Buffer): Promise<number> {
  const src = await PDFDocument.load(new Uint8Array(source), { ignoreEncryption: true });
  return src.getPageCount();
}

/**
 * Όνομα αρχείου παιδιού: «ΤΙΜΟΛΟΓΙΑ ΙΟΥΝΙΟΥ.pdf» + τμήμα 2 → «ΤΙΜΟΛΟΓΙΑ ΙΟΥΝΙΟΥ — 2 (σελ. 4-6).pdf».
 * Το εύρος σελίδων μπαίνει στο όνομα επίτηδες: όταν κάτι διαβαστεί λάθος, ο χρήστης πρέπει να
 * μπορεί να βρει ΑΜΕΣΩΣ ποιες σελίδες του πρωτοτύπου να κοιτάξει.
 */
export function segmentFileName(sourceName: string, index: number, from: number, to: number): string {
  const base = String(sourceName ?? 'έγγραφο').replace(/\.[A-Za-z0-9]{1,5}$/, '') || 'έγγραφο';
  const pages = from === to ? `σελ. ${from + 1}` : `σελ. ${from + 1}-${to + 1}`;
  return `${base} — ${index} (${pages}).pdf`;
}
