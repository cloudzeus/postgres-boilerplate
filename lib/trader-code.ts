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
