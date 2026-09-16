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
}): ItemCodeProposal {
  const existing = opts.existing.map((c) => String(c ?? '').trim()).filter(Boolean);
  const supplierCode = String(opts.supplierCode ?? '').trim() || null;

  if (supplierCode && !isCodeTaken(existing, supplierCode)) {
    return {
      code: supplierCode,
      source: 'supplier',
      // Ίδια μέτρηση με το `nextCode`: διακριτοί κωδικοί, χωρίς διάκριση κεφαλαίων/πεζών.
      taken: new Set(existing.map((c) => c.toUpperCase())).size,
      supplierCodeTaken: false,
      supplierCode,
    };
  }

  const next = nextCode(existing, { mask: opts.mask });
  return { ...next, supplierCodeTaken: supplierCode != null, supplierCode };
}
