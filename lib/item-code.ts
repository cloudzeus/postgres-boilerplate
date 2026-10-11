/**
 * Κωδικός **είδους / υπηρεσίας / εξόδου / χρεοπίστωσης** — η ίδια μηχανή με τον συναλλασσόμενο
 * ({@link nextCode}), με έναν επιπλέον κανόνα που ισχύει μόνο εδώ: **ο κωδικός του προμηθευτή**.
 *
 * Γιατί: η γραμμή του τιμολογίου συχνά κουβαλά τον κωδικό που δίνει ο ίδιος ο προμηθευτής στο
 * είδος. Αν είναι ΕΛΕΥΘΕΡΟΣ, το να τον κρατήσουμε είναι πραγματικό κέρδος — η επόμενη γραμμή του
 * ίδιου προμηθευτή ταιριάζει αμέσως με `code`. Αν είναι πιασμένος, δεν τον «παραλλάσσουμε»:
 * πέφτουμε στη ΔΙΚΗ μας αρίθμηση.
 *
 * Ό,τι ΔΕΝ κάνουμε ποτέ: πρόταση από την **περιγραφή** της γραμμής. Ένα slug της περιγραφής
 * («ΧΡΕΩΣΗ-ΠΡΟΜΗΘΕΙΑΣ-ΡΕ») δεν είναι αρίθμηση, δεν ελέγχεται για μοναδικότητα και, κομμένο στους
 * 20 χαρακτήρες, δύο διαφορετικές μακριές περιγραφές παράγουν τον ΙΔΙΟ κωδικό.
 */

import { erpMaskAccepts } from '@/lib/erp-mask';
import { nextCode, isCodeTaken, type NextCodeResult } from '@/lib/next-code';

/**
 * Τα μητρώα που αριθμούμε. Ίδιες τιμές με το `MatchKind` της ουράς, επίτηδες: η κατηγορία που
 * διάλεξε ο χρήστης στο panel ΕΙΝΑΙ το μητρώο στο οποίο θα γραφτεί η εγγραφή.
 *
 *  • `product`  → `MTRL` SODTYPE 51 (είδη)
 *  • `service`  → `MTRL` SODTYPE 52 (υπηρεσίες)
 *  • `expense`  → `EXPN` (έξοδα)
 *  • `lineitem` → `MTRL` SODTYPE 53 (χρεοπιστώσεις)
 */
export type ItemCodeKind = 'product' | 'service' | 'expense' | 'lineitem';

export const ITEM_CODE_KINDS: readonly ItemCodeKind[] = ['product', 'service', 'expense', 'lineitem'];

export const isItemCodeKind = (v: unknown): v is ItemCodeKind =>
  typeof v === 'string' && (ITEM_CODE_KINDS as readonly string[]).includes(v);

/**
 * Το κλειδί ρύθμισης με τη **μάσκα** κωδικού του μητρώου (δες `SETTING_CATALOG`), κατ' αναλογία
 * με το `softone.traderCodeMask.*`. Χρησιμοποιείται ΜΟΝΟ όταν το μητρώο είναι άδειο και δεν
 * υπάρχει τίποτα να συμπεραθεί.
 */
export const itemCodeMaskKey = (kind: ItemCodeKind) => `softone.itemCodeMask.${kind}`;

/** Ελληνική γενική του μητρώου — για τα μηνύματα του UI («κωδικοί υπηρεσιών»). */
export const ITEM_KIND_GENITIVE: Record<ItemCodeKind, string> = {
  product: 'ειδών',
  service: 'υπηρεσιών',
  expense: 'εξόδων',
  lineitem: 'χρεοπιστώσεων',
};

/** Από πού προέκυψε ο προτεινόμενος κωδικός είδους. */
export type ItemCodeSource = NextCodeResult['source'] | 'supplier';

export interface ItemCodeProposal extends Omit<NextCodeResult, 'source'> {
  source: ItemCodeSource;
  /**
   * `true` όταν η γραμμή ΕΙΧΕ κωδικό προμηθευτή αλλά αυτός είναι ήδη πιασμένος στο μητρώο —
   * ο λόγος που η πρόταση γύρισε στη δική μας αρίθμηση. Το UI το λέει ρητά.
   */
  supplierCodeTaken: boolean;
  /** Ο κωδικός του προμηθευτή όπως ήρθε από τη γραμμή (καθαρισμένος) — `null` όταν δεν υπάρχει. */
  supplierCode: string | null;
}

/**
 * Η πρόταση κωδικού για ΜΙΑ νέα εγγραφή μητρώου. Καθαρή λογική: τα `existing` τα φέρνει ο
 * καλών (SoftOne, με τον τοπικό καθρέφτη ως εφεδρεία).
 *
 * Σειρά κανόνων — και οι δύο γυρίζουν ΠΑΝΤΑ ελεύθερο κωδικό:
 *  1. **Κωδικός προμηθευτή**, αν υπάρχει πάνω στη γραμμή και είναι ελεύθερος.
 *  2. **Επόμενος ελεύθερος** της δικής μας αρίθμησης (σχήμα από τα υπάρχοντα, αλλιώς μάσκα).
 *
 * Χωρίς κανέναν υπάρχοντα κωδικό ΚΑΙ χωρίς μάσκα: `code: null` — το πεδίο μένει κενό με εξήγηση.
 */
export function proposeItemCode(opts: {
  existing: readonly string[];
  /** Ο κωδικός που κουβαλά η γραμμή του τιμολογίου (`OcrInvoiceItem.code`). */
  supplierCode?: string | null;
  /** `softone.itemCodeMask.<kind>` — μόνο για άδειο μητρώο. */
  mask?: string | null;
  /**
   * Η μάσκα που ΕΠΙΒΑΛΛΕΙ το SoftOne (βλ. `lib/erp-mask.ts`). Όταν είναι γνωστή, το μοτίβο
   * βγαίνει ΜΟΝΟ από κωδικούς που την τηρούν, και κωδικός προμηθευτή εκτός μάσκας αγνοείται.
   */
  erpMask?: string | null;
  /**
   * Κωδικοί ΑΛΛΩΝ τύπων του ίδιου πίνακα (όλο το MTRL). Δεν επηρεάζουν το ΜΟΤΙΒΟ — μόνο το «είναι
   * ελεύθερος;». Ο κωδικός στο SoftOne είναι μοναδικός σε όλο τον πίνακα, όχι ανά τύπο.
   */
  takenElsewhere?: readonly string[];
}): ItemCodeProposal {
  const own = opts.existing.map((c) => String(c ?? '').trim()).filter(Boolean);
  // `all` = ό,τι είναι ΠΙΑΣΜΕΝΟ (δικοί + άλλων τύπων)· το μοτίβο βγαίνει μόνο από τους δικούς.
  const all = [...own, ...(opts.takenElsewhere ?? []).map((c) => String(c ?? '').trim()).filter(Boolean)];
  const erpMask = String(opts.erpMask ?? '').trim() || null;
  const fits = (c: string) => erpMaskAccepts(erpMask, c);
  // Η ΚΑΤΑΛΗΨΗ ελέγχεται σε ΟΛΟΥΣ τους κωδικούς· το ΜΟΤΙΒΟ μόνο σε όσους τηρούν τη μάσκα.
  const existing = erpMask ? own.filter(fits) : own;
  const rawSupplier = String(opts.supplierCode ?? '').trim() || null;
  const supplierCode = rawSupplier && fits(rawSupplier) ? rawSupplier : null;

  if (supplierCode && !isCodeTaken(all, supplierCode)) {
    return {
      code: supplierCode,
      source: 'supplier',
      // Ίδια μέτρηση με το `nextCode`: διακριτοί κωδικοί, χωρίς διάκριση κεφαλαίων/πεζών.
      taken: new Set(all.map((c) => c.toUpperCase())).size,
      supplierCodeTaken: false,
      supplierCode,
    };
  }

  let next = nextCode(existing, { mask: opts.mask });
  // Η πρόταση είναι ελεύθερη ανάμεσα στους κωδικούς ΤΟΥ ΤΥΠΟΥ — όχι απαραίτητα σε όλο τον πίνακα.
  // Προχωράμε την ΙΔΙΑ αρίθμηση ώσπου να είναι ελεύθερη παντού (το μοτίβο δεν αλλάζει).
  if (next.code && next.prefix != null && next.width != null) {
    const takenAll = new Set(all.map((c) => c.toUpperCase()));
    let n = Number(next.code.slice(next.prefix.length));
    let cand = next.code;
    for (let i = 0; i < 5000 && Number.isFinite(n) && (takenAll.has(cand.toUpperCase()) || !fits(cand)); i++) {
      n += 1;
      cand = next.prefix + String(n).padStart(next.width, '0');
    }
    if (cand !== next.code) next = { ...next, code: cand };
  }
  // Κανένας υπάρχων κωδικός δεν τηρεί τη μάσκα του ERP (π.χ. όλες οι υπηρεσίες είναι «ΥΠΗΡ-…»
  // ενώ το ERP ζητά ψηφία): ο ΠΡΩΤΟΣ κωδικός βγαίνει από την ίδια τη μάσκα — «nnnnnnnnn» →
  // «000000001» — και προχωρά ώσπου να βρει ελεύθερο ανάμεσα σε ΟΛΟΥΣ τους κωδικούς.
  if (!next.code && erpMask) {
    const first = firstFromErpMask(erpMask, all);
    if (first) next = { code: first, source: 'mask', taken: all.length };
  }
  // Δίχτυ ασφαλείας: πρόταση που το ERP θα απέρριπτε δεν είναι πρόταση.
  // `supplierCodeTaken` = ο κωδικός προμηθευτή ΤΗΡΟΥΣΕ τη μάσκα αλλά ήταν πιασμένος. Κωδικός εκτός
  // μάσκας δεν είναι «πιασμένος» — απλώς δεν μετράει, και `supplierCode` είναι τότε null.
  if (next.code && !fits(next.code)) return { code: null, source: 'none', taken: all.length, supplierCodeTaken: supplierCode != null, supplierCode };
  return { ...next, supplierCodeTaken: supplierCode != null, supplierCode };
}

/** Ο πρώτος ελεύθερος κωδικός που ταιριάζει σε μια μάσκα ERP: οι θέσεις ψηφίων γίνονται αρίθμηση. */
function firstFromErpMask(erpMask: string, taken: readonly string[]): string | null {
  const digitPos = [...erpMask].map((ch, i) => (/[nN9#0]/.test(ch) ? i : -1)).filter((i) => i >= 0);
  if (digitPos.length === 0) return null;
  const used = new Set(taken.map((c) => c.toUpperCase()));
  const width = digitPos.length;
  for (let n = 1; n < 10 ** Math.min(width, 9); n++) {
    const digits = String(n).padStart(width, '0');
    let k = 0;
    const code = [...erpMask].map((ch, i) => (digitPos.includes(i) ? digits[k++] : ch)).join('');
    if (!used.has(code.toUpperCase())) return code;
  }
  return null;
}
