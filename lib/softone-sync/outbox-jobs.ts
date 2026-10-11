// lib/softone-sync/outbox-jobs.ts — SERVER. Τι ΣΗΜΑΙΝΕΙ κάθε είδος εργασίας της ουράς.
//
// ΓΙΑΤΙ ΥΠΑΡΧΕΙ ΑΥΤΟ ΤΟ ΑΡΧΕΙΟ. Η πρώτη εκδοχή της ουράς αποθήκευε το ΩΜΟ `setData` και το
// ξανάστελνε αυτούσιο στην επανασύνδεση. Αυτό θα ήταν μισή δουλειά: η δημιουργία ενός
// συναλλασσομένου ΔΕΝ είναι μόνο το `setData` — είναι και η επαλήθευση με ανάγνωση, και ο τοπικός
// καθρέφτης, και το γράψιμο του νέου TRDR σε ΟΛΑ τα παραστατικά του ΑΦΜ. Αν η ουρά έκανε μόνο το
// πρώτο, ο χρήστης θα έβλεπε «ολοκληρώθηκε» και το παραστατικό θα έμενε ασύνδετο.
//
// Εδώ η εργασία κρατά τα ΟΡΙΣΜΑΤΑ και εκτελεί την ΙΔΙΑ συνάρτηση που θα έτρεχε και αν η σύνδεση
// ήταν όρθια. Μία υλοποίηση, δύο δρόμοι προς αυτήν.
import 'server-only';

/** Ένα είδος εργασίας: παίρνει τα ορίσματα που αποθηκεύτηκαν και κάνει ΟΛΗ τη δουλειά. */
export type OutboxJob = (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;

/**
 * Τα είδη εργασίας που ξέρει η ουρά.
 *
 * Τα imports είναι ΔΥΝΑΜΙΚΑ: το `outbox.ts` φορτώνεται από τη λωρίδα κατάστασης σε κάθε σελίδα,
 * και δεν υπάρχει λόγος να σέρνει μαζί του όλη τη λογική του OCR.
 */
export const OUTBOX_JOBS: Record<string, OutboxJob> = {
  'trader.create': async (payload) => {
    const { createTraderInSoftone, parseCreateTraderJob } = await import('@/lib/ocr/create-trader');
    return createTraderInSoftone(parseCreateTraderJob(payload)) as unknown as Record<string, unknown>;
  },
};
