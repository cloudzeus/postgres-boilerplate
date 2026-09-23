/**
 * Κωδικός **συναλλασσομένου** — λεπτό περιτύλιγμα πάνω από τον κοινό μηχανισμό
 * {@link nextCode} (`lib/next-code.ts`).
 *
 * Ο μηχανισμός είναι ο ΙΔΙΟΣ για συναλλασσομένους και για είδη/έξοδα/χρεοπιστώσεις: πρόθεμα +
 * μηδενο-συμπληρωμένη αριθμητική ουρά, κυρίαρχο σχήμα, `max + 1`. Εδώ μένει μόνο ό,τι αφορά
 * τον συναλλασσόμενο: οι τρεις τύποι και το κλειδί της μάσκας τους.
 */

import { nextCode, type NextCodeResult } from '@/lib/next-code';

export type {
  CodeShape, CodeSource, NextCodeResult,
} from '@/lib/next-code';
export { parseCodeShape, nextCode, isCodeTaken } from '@/lib/next-code';

/** Οι τρεις τύποι συναλλασσομένου, χωρίς εξάρτηση από το `server-only` lib/softone. */
export type TraderCodeKind = 'supplier' | 'creditor' | 'debtor';

/**
 * Ο επόμενος ελεύθερος κωδικός για έναν τύπο συναλλασσομένου.
 *
 * Το `existing` πρέπει να περιέχει κωδικούς ΜΟΝΟ του ίδιου τύπου: ένας πιστωτής δεν
 * κληρονομεί την αρίθμηση των προμηθευτών ή των λογαριασμών τραπέζης.
 */
export function nextTraderCode(
  existing: readonly string[],
  opts: { mask?: string | null } = {},
): NextCodeResult {
  return nextCode(existing, opts);
}

/**
 * Το κλειδί ρύθμισης με τη **μάσκα** κωδικού του τύπου (δες `SETTING_CATALOG`).
 * Η μάσκα είναι ο ΠΡΩΤΟΣ κωδικός που θα δοθεί όταν δεν υπάρχει κανένας άλλος.
 */
export const traderCodeMaskKey = (kind: TraderCodeKind) => `softone.traderCodeMask.${kind}`;

/** Η κατάσταση του πεδίου «Κωδικός» τη στιγμή που φτάνει νέα πρόταση από τον server. */
export interface CodeProposalState {
  /** Ό,τι κρατά ΑΥΤΗ ΤΗ ΣΤΙΓΜΗ το πεδίο. */
  current: string;
  /** Η τελευταία πρόταση που γράψαμε **εμείς** — `''` όταν δεν έχουμε γράψει καμία. */
  lastProposal: string;
  /** Η νέα πρόταση για τον επιλεγμένο τύπο — `''` όταν ο server δεν μπόρεσε να προτείνει. */
  proposal: string;
}

/**
 * **Γράφεται η νέα πρόταση κωδικού πάνω στο πεδίο;** `null` = όχι, μην το αγγίξεις· αλλιώς η
 * τιμή που πρέπει να μπει.
 *
 * Ο κανόνας είναι ένας: το πεδίο ανήκει στον χρήστη μόλις γράψει κάτι δικό του. Γράφουμε μόνο
 * όταν είναι **άδειο** ή όταν κρατά ακόμη **τη δική μας προηγούμενη πρόταση** — τότε η αλλαγή
 * τύπου πρέπει να φέρει την αρίθμηση του ΝΕΟΥ τύπου (ένας χρεώστης δεν παίρνει ποτέ κωδικό
 * προμηθευτή).
 *
 * Ζει εδώ, ως καθαρή συνάρτηση, επειδή μέσα σε updater του `setState` η ίδια απόφαση είχε
 * σπάσει: ο updater διάβαζε ΚΑΙ έγραφε το ref της τελευταίας πρότασης, ο React τον εκτελεί
 * αργότερα (και σε StrictMode δύο φορές), και το πεδίο έμενε με τον κωδικό του ΠΡΟΗΓΟΥΜΕΝΟΥ
 * τύπου. Η απόφαση πρέπει να παίρνεται μία φορά, έξω από κάθε updater, και να είναι ελέγξιμη.
 */
export function applyCodeProposal({ current, lastProposal, proposal }: CodeProposalState): string | null {
  const cur = current.trim();
  // Δική του τιμή ⇒ καμία αλλαγή, ό,τι κι αν προτείνει ο server.
  if (cur !== '' && cur !== lastProposal) return null;
  return proposal;
}
