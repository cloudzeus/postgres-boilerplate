// lib/ocr/purdoc-payload.ts — ΚΑΘΑΡΟ (χωρίς prisma / δίκτυο).
// Ο μεταφραστής «κανονικό έγγραφο (§17.1) → SoftOne setData payload» και οι προϋποθέσεις που
// πρέπει να ισχύουν για να επιτραπεί η καταχώριση. Ζει χωριστά από το `post-softone.ts` ώστε
// να δοκιμάζεται και να εμφανίζεται (dry-run) χωρίς να μπορεί καν να αγγίξει το SoftOne.
//
// Ο ΣΤΟΧΟΣ ΔΕΝ ΕΙΝΑΙ ΣΤΑΘΕΡΟΣ: το object και ο πίνακας γραμμών έρχονται από τη σειρά του
// εγγράφου (`lib/ocr/posting-target.ts`), όχι από το τι ταίριαξε η κάθε γραμμή. Ένα τιμολόγιο
// δαπανών πάει σε `LINSUPDOC`/`LINLINES`, μια αγορά εμπορευμάτων σε `PURDOC`/`ITELINES`, ένα
// παραστατικό χρεώστη σε `LINDEBDOC`/`LINLINES`.
import { normalizeDocRef } from '@/lib/doc-reference';
import { normalizeVatId } from './validate';
import type { DocumentJson } from './canonical';
import { analyzeLine } from './invoice-math';
import {
  accountBlockers, accountWarnings,
  type AccountCheck, type AccountCheckInput, type AccountPath,
} from './account-check';
import {
  LINES_FOR_OBJECT, POST_LINES_LABEL, SODTYPE_FOR_OBJECT,
  type PostLineTable, type PostingTarget,
} from './posting-target';

/** Η πρώτη νέα γραμμή. Το SoftOne θέλει LINENUM που δεν υπάρχει ήδη στο παραστατικό. */
export const FIRST_LINENUM = 9000001;

/** Ό,τι ξέρει η εφαρμογή για μια γραμμή, πέρα από το ίδιο το έγγραφο (από `OcrInvoiceItem`). */
export type PurdocLineCtx = {
  rowIndex: number;
  /** MTRL είδους/υπηρεσίας/παγίου (μητρώο `SoftoneItem`). */
  mtrl?: number | null;
  /** EXPN εξόδου (μητρώο `SoftoneExpense`). */
  expn?: number | null;
  /** MTRL ΧΡΕΟΠΙΣΤΩΣΗΣ (μητρώο `SoftoneLineItem`) — το μόνο που δέχεται γραμμή LINLINES. */
  lin?: number | null;
  /** MTRTYPE της χρεοπίστωσης· η γραμμή LINLINES το απαιτεί. */
  linMtrType?: number | null;
  /** «κωδικός — περιγραφή» της χρεοπίστωσης, για τα μηνύματα του ελέγχου λογαριασμού. */
  linLabel?: string | null;
  /** `MTRL.ACNMSK` της χρεοπίστωσης — ο λογαριασμός γενικής όπου θα γραφτεί η γραμμή. */
  linAcnmsk?: string | null;
  /** `false` = ο λογαριασμός της χρεοπίστωσης δεν έχει διαβαστεί ακόμη από τον συγχρονισμό. */
  linAcnmskKnown?: boolean;
  /** Ο συντελεστής ΦΠΑ της γραμμής (ίδια πηγή με το payload) — για την παρατήρηση ΦΠΑ του ελέγχου. */
  vatRate?: number | null;
  isService?: boolean | null;
  /**
   * MYDATACODE του ΜΗΤΡΩΟΥ στο οποίο ταίριαξε η γραμμή. Στέλνεται μόνο εκεί όπου ο πίνακας
   * γραμμών το έχει (ITELINES / SRVLINES) — το EXPANAL και το LINLINES δεν έχουν
   * πεδίο χαρακτηρισμού, εκεί τον εφαρμόζει το SoftOne από το μητρώο.
   */
  myDataCode?: string | null;
  /** `true` όταν το μητρώο δεν κουβαλά κανέναν χαρακτηρισμό myDATA (προειδοποίηση, όχι εμπόδιο). */
  noClassification?: boolean;
  /**
   * Αναλυτική ανά γραμμή: κέντρο κόστους, έργο, κατηγορία δραστηριότητας. Υπάρχουν σε
   * `ITELINES` / `SRVLINES` / `LINLINES` και ΔΕΝ υπάρχουν στο `EXPANAL` — εκεί απλώς δεν
   * στέλνονται. Είναι ΠΡΟΑΙΡΕΤΙΚΑ στο SoftOne: κενά δεν εμποδίζουν ποτέ την καταχώριση.
   */
  costCntr?: number | null;
  prjc?: number | null;
  prjcStage?: number | null;
  /**
   * ΕΠΙΜΕΡΙΣΜΟΣ σε πολλούς λογαριασμούς. Όταν υπάρχει, ΥΠΕΡΙΣΧΥΕΙ της μονής αντιστοίχισης: η μία
   * γραμμή του παραστατικού γίνεται **N γραμμές `LINLINES`**, μία ανά λογαριασμό.
   *
   * Γιατί N γραμμές και όχι μία με πολλούς λογαριασμούς: η γραμμή `LINLINES` κουβαλά ΕΝΑ `MTRL`
   * και ΕΝΑ ποσό — το ERP δεν εκφράζει τίποτε άλλο (το `EXPANAL` δεν έχει καν πεδίο λογαριασμού).
   */
  allocations?: {
    registryMtrl: number;
    /** `MTRTYPE` της χρεοπίστωσης· η γραμμή `LINLINES` το απαιτεί. */
    mtrType?: number | null;
    /** Το ποσό που αναλογεί — αθροίζει στο σύνολο της γραμμής (υπολογισμένο στον server). */
    amount: number;
    percent: number;
    /** «κωδικός — περιγραφή», για τα μηνύματα των ελέγχων. */
    label?: string | null;
  }[];
};

export type PurdocContext = {
  /** Πού καταχωρείται: object + πίνακας γραμμών, από τη σειρά του εγγράφου. */
  target: PostingTarget;
  /** SoftOne SERIES (αριθμός σειράς). */
  series: number;
  /** SoftOne TRDR του συναλλασσομένου (προμηθευτή, πιστωτή ή χρεώστη). */
  trdr: number;
  /** Προαιρετικό COMPANY — κανονικά το session είναι ήδη δεμένο σε εταιρία. */
  company?: number | null;
  lines: PurdocLineCtx[];
  /** Συντελεστής ΦΠΑ (π.χ. 24) → κωδικός ΦΠΑ SoftOne (`VatCategory.code`). */
  vatIdByRate: Record<number, number>;
  comments?: string | null;
};

/**
 * Η κεφαλίδα. ΙΔΙΑ και στα τέσσερα objects (DB πίνακας FINDOC) — επαληθευμένο στο schema.
 * Στέλνουμε ΜΟΝΟ ό,τι πραγματικά ξέρουμε· τα υπόλοιπα «required» πεδία (FISCPRD, PERIOD, BRANCH,
 * SOCURRENCY, TRDRRATE, GLUPD, …) έχουν defaults στο SoftOne και τα συμπληρώνει το ίδιο.
 * Δεν μαντεύουμε χρήση, υποκατάστημα ή ισοτιμίες.
 *
 * ΤΟ `SERIESNUM` («Αριθμός») ΔΕΝ ΣΤΕΛΝΕΤΑΙ ΠΟΤΕ: είναι ο ΔΙΚΟΣ ΜΑΣ αύξων αριθμός μέσα στη σειρά
 * και τον δίνει το SoftOne. Τα τέσσερα παραστατικά αγορών του πελάτη το έχουν `1` ενώ ο αριθμός
 * του προμηθευτή ζει αλλού — αν τον στέλναμε εμείς, θα χαλούσαμε τη σειριακή αρίθμηση του ERP.
 */
export type PurdocHeader = {
  SERIES: number;
  TRNDATE: string;
  TRDR: number;
  /** «Παραστατικό» — η ΠΛΗΡΗΣ τυπωμένη ταυτότητα του παραστατικού του εκδότη. */
  FINCODE?: string;
  /** «Φορ/κή σειρά» — το τυπωμένο πρόθεμα σειράς του ΕΚΔΟΤΗ. */
  TAXSERIES?: string;
  /** «Φορ/κός αριθμός» — ο τυπωμένος αριθμός του ΕΚΔΟΤΗ. */
  TAXSERIESNUM?: string;
  COMPANY?: number;
  COMMENTS?: string;
  MYDATAMARK?: string;
  MYDATAUID?: string;
};

/** Γραμμή ειδών/υπηρεσιών (DB MTRLINES) σε PURDOC. */
export type PurdocItemLine = {
  LINENUM: number; MTRL: number; QTY1: number; PRICE: number;
  /** Έκπτωση **ΠΟΣΟΣΤΟ**. Δες {@link discountFields}: ποτέ ποσό εδώ μέσα. */
  DISC1PRC?: number;
  /** Έκπτωση **ΠΟΣΟ** σε νόμισμα. */
  DISC1VAL?: number;
  VAT?: number; COMMENTS?: string; MYDATACODE?: string;
  COSTCNTR?: number; PRJC?: number; PRJCSTAGE?: number;
};
/** Γραμμή ανάλυσης εξόδων (EXPANAL) — δεν έχει ποσότητα/τιμή, μόνο αξία. */
export type PurdocExpenseLine = { LINENUM: number; EXPN: number; VAT?: number; EXPVAL: number };
/** Γραμμή ειδικών συναλλαγών (LINLINES): `MTRL` = ΧΡΕΟΠΙΣΤΩΣΗ, με τον τύπο της. */
export type PurdocLinLine = {
  LINENUM: number; MTRL: number; MTRTYPE: number; QTY1: number; PRICE: number;
  /** Έκπτωση ΠΟΣΟΣΤΟ / ΠΟΣΟ — δες {@link discountFields}. */
  DISC1PRC?: number;
  DISC1VAL?: number;
  NETLINEVAL: number; VAT?: number; COMMENTS?: string;
  COSTCNTR?: number; PRJC?: number; PRJCSTAGE?: number;
};

export type PostingObjectName = 'PURDOC' | 'LINSUPDOC' | 'LINCREDOC' | 'LINDEBDOC' | 'SXDOCSEX';

export type PostingPayload = {
  OBJECT: PostingObjectName;
  KEY: '';
  DATA: {
    PURDOC?: PurdocHeader[];
    LINSUPDOC?: PurdocHeader[];
    LINCREDOC?: PurdocHeader[];
    LINDEBDOC?: PurdocHeader[];
    ITELINES?: PurdocItemLine[];
    SRVLINES?: PurdocItemLine[];
    EXPANAL?: PurdocExpenseLine[];
    LINLINES?: PurdocLinLine[];
  };
};
/** Παλιό όνομα, διατηρείται για τους υπάρχοντες καλούντες. */
export type PurdocPayload = PostingPayload;

/** Τα πεδία του `OcrDocument` που κρίνουν αν επιτρέπεται η καταχώριση. */
export type PostingDoc = {
  status: string;
  category: string | null;
  softoneTrdr: number | null;
  softoneSeries: string | null;
  seriesSource: number | null;
  /** `false` όταν η σειρά του εγγράφου ΔΕΝ υπάρχει στο συγχρονισμένο μητρώο σειρών. */
  seriesKnown: boolean;
  /** `false` όταν η σειρά υπάρχει αλλά δεν είναι «σε χρήση». */
  seriesEnabled: boolean;
  /**
   * TRDR.SODTYPE του συναλλασσομένου του εγγράφου (12 προμηθευτής, 16 πιστωτής).
   * `null` = άγνωστο (δεν υπάρχει στον τοπικό καθρέφτη) — τότε ΔΕΝ κρίνουμε.
   */
  traderSodtype: number | null;
};

export type BlockerCode =
  | 'not_completed'
  | 'no_category'
  | 'line_discount_ambiguous'
  | 'no_trader'
  | 'no_trader_afm_missing'
  | 'no_trader_afm_invalid'
  | 'no_series'
  | 'no_date'
  | 'no_number'
  | 'no_lines'
  | 'unmatched_lines'
  | 'no_vat_category'
  | 'totals_mismatch'
  | 'lines_need_mtrl'
  | 'lines_need_expn'
  | 'lines_need_lineitem'
  | 'lines_lineitem_unsupported'
  | 'lines_sxdoc_unsupported'
  | 'lines_no_mtrtype'
  | 'series_unknown'
  | 'series_module_unsupported'
  | 'trader_kind_mismatch'
  // Έλεγχος λογαριασμού γενικής (`lib/ocr/account-check.ts`) — μόνο για γραμμές LINLINES.
  | 'account_missing'
  | 'account_not_in_chart'
  | 'account_is_mask'
  | 'account_not_postable';

/** Μη-αποτρεπτικές παρατηρήσεις: φαίνονται στην προεπισκόπηση, δεν κλειδώνουν το κουμπί. */
export type WarningCode =
  | 'no_mydata_classification' | 'mydata_from_master'
  | 'account_unknown' | 'account_not_covered' | 'account_vat_mismatch'
  | 'shared_code_many_products';

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/**
 * Η έκπτωση της γραμμής στα **σωστά** πεδία του SoftOne.
 *
 * ΤΙ ΠΗΓΕ ΣΤΡΑΒΑ. Γραφόταν πάντα `DISC1PRC: line.discount` — αλλά το `DISC1PRC` είναι **ποσοστό**.
 * Μια γραμμή «350 → 227,50» κουβαλά έκπτωση **122,5 ευρώ**, που ως ποσοστό σημαίνει 122,5 %:
 * το SoftOne υπολόγισε `350 × (1 − 1,225) = −78,75` και κατέγραψε **αρνητικό** παραστατικό.
 * Δέκα παραστατικά μπήκαν έτσι στη demo στις 23/09/2026 πριν το δει άνθρωπος.
 *
 * Η διάκριση υπήρχε ήδη στο `analyzeLine` (`lib/ocr/invoice-math.ts`) και απλώς δεν διαβαζόταν.
 * `unknown` ⇒ **ΔΕΝ μαντεύουμε**: η γραμμή μπλοκάρει την καταχώριση (`line_discount_ambiguous`).
 */
export interface DiscountLine {
  quantity?: unknown; unitPrice?: unknown; discount?: unknown; net?: unknown;
}

export function discountFields(line: DiscountLine): { DISC1PRC?: number; DISC1VAL?: number } {
  const d = num(line.discount, 0);
  if (!d) return {};
  const a = analyzeLine({
    quantity: line.quantity, price: line.unitPrice, discount: line.discount, total: line.net,
  });
  if (a.discountKind === 'percent') return { DISC1PRC: d };
  if (a.discountKind === 'amount') return { DISC1VAL: d };
  return {};
}

/**
 * Η γραμμή **δεν βγαίνει αριθμητικά** — δεν επιτρέπεται να φύγει.
 *
 * Δύο περιπτώσεις, και η δεύτερη είναι αυτή που ξέφυγε την πρώτη φορά:
 *  1. Υπάρχει έκπτωση αλλά καμία ερμηνεία (ποσοστό/ποσό) δεν βγάζει το σύνολο ⇒ ασαφής.
 *  2. **ΔΕΝ υπάρχει έκπτωση** και το σύνολο δεν ισούται με ποσότητα × τιμή. Το SoftOne δεν
 *     παίρνει σύνολο γραμμής: το ΥΠΟΛΟΓΙΖΕΙ. Έτσι μια γραμμή «5 × 450 = 1.316,25» χωρίς
 *     καταγεγραμμένη έκπτωση καταχωρήθηκε ως 2.250 — σωστά κατά το SoftOne, λάθος κατά το
 *     παραστατικό, και κανείς δεν το είδε.
 *
 * Το `analyzeLine` κρίνει ήδη και τις δύο μέσω του `consistent`· ο παλιός έλεγχος απλώς έβγαινε
 * νωρίς όταν η έκπτωση ήταν μηδενική.
 */
export function discountAmbiguous(line: DiscountLine): boolean {
  const a = analyzeLine({
    quantity: line.quantity, price: line.unitPrice, discount: line.discount, total: line.net,
  });
  if (!a.consistent) return true;
  return num(line.discount, 0) !== 0 && a.discountKind === 'unknown';
}
const text = (v: unknown): string | undefined => {
  const s = v == null ? '' : String(v).trim();
  return s === '' ? undefined : s;
};

/**
 * ── Η ΑΝΑΦΟΡΑ ΤΟΥ ΠΑΡΑΣΤΑΤΙΚΟΥ ΤΟΥ ΕΚΔΟΤΗ ────────────────────────────────────────────────────
 *
 * Η κεφαλίδα FINDOC κρατά ΤΕΣΣΕΡΑ διαφορετικά πράγματα, και μόνο τα τρία είναι δικά μας να τα
 * γράψουμε (μεγέθη/ιδιότητες από το cached schema, ίδια και στα τέσσερα objects):
 *
 *  | πεδίο          | λεζάντα         | τι είναι                                   |
 *  |----------------|-----------------|--------------------------------------------|
 *  | `SERIES`       | Σειρά           | η ΔΙΚΗ ΜΑΣ σειρά καταχώρισης                |
 *  | `SERIESNUM`    | Αριθμός         | ο ΔΙΚΟΣ ΜΑΣ αύξων — τον δίνει το SoftOne    |
 *  | `TAXSERIES`    | Φορ/κή σειρά    | η τυπωμένη σειρά ΤΟΥ ΕΚΔΟΤΗ (String 50)     |
 *  | `TAXSERIESNUM` | Φορ/κός αριθμός | ο τυπωμένος αριθμός ΤΟΥ ΕΚΔΟΤΗ (String 50)  |
 *  | `FINCODE`      | Παραστατικό     | η ΠΛΗΡΗΣ τυπωμένη ταυτότητα (String 30)     |
 *
 * Τι κάνει ο ΙΔΙΟΣ ο πελάτης — read-only `GetTable FINDOC`, ΚΑΙ ΟΙ ΤΕΣΣΕΡΙΣ γραμμές αγορών
 * (SOSOURCE 1251) που υπάρχουν, όχι μόνο όσες βολεύουν:
 *
 *   1042: `FINCODE="ΤΙΜ-AA-2455"  TAXSERIES="ΤΙΜ-AA"  TAXSERIESNUM="2455"    SERIESNUM=1`
 *   1044: `FINCODE="ΔΠ-0035656"   TAXSERIES="ΔΠ"      TAXSERIESNUM="0035656" SERIESNUM=1`
 *   1009: `FINCODE="ΤΔΑ"          TAXSERIES="ΤΔΑ"     TAXSERIESNUM="1"       SERIESNUM=1`
 *   1034: `FINCODE="ΔΠ"           TAXSERIES="ΔΠ"      TAXSERIESNUM="1"       SERIESNUM=1`
 *
 * Οι δύο πρώτες κουβαλούν την πλήρη ταυτότητα στο «Παραστατικό». Οι δύο ΤΕΛΕΥΤΑΙΕΣ όμως έχουν
 * `FINCODE` = σκέτο τον κωδικό σειράς, ΧΩΡΙΣ αριθμό, και `TAXSERIESNUM` ίσο με τον δικό μας
 * `SERIESNUM` — δηλαδή είναι απολύτως συμβατές με το «το ERP παράγει το FINCODE από τη μάσκα της
 * σειράς και γεμίζει τον κενό Φορ/κό αριθμό από τον αύξοντα». Δεν μπορούμε να το αποκλείσουμε
 * χωρίς `setData`, οπότε το λέμε όπως είναι:
 *
 *   ΤΟ `FINCODE` ΠΟΥ ΣΤΕΛΝΟΥΜΕ ΕΙΝΑΙ ΣΥΜΒΟΥΛΕΥΤΙΚΟ — μπορεί να το ξαναγράψει η μάσκα της σειράς.
 *   ΤΑ `TAXSERIES`/`TAXSERIESNUM` ΕΙΝΑΙ ΑΥΤΑ ΠΟΥ ΚΡΑΤΑΝΕ ΤΗΝ ΤΑΥΤΟΤΗΤΑ ΤΟΥ ΕΚΔΟΤΗ.
 *
 * Γι' αυτό και η επαλήθευση μετά την εγγραφή δέχεται συμφωνία σε οποιοδήποτε από τα δύο.
 *
 * Δεύτερη πηγή: `docs/superpowers/specs/2026-09-09-extraction-templates-design.md:366` (§14.8, η
 * οθόνη καταχώρισης του πελάτη). Δείχνει «Παραστατικό» με την πλήρη τυπωμένη ταυτότητα
 * (`INV.239124`, `ΤΠΥ 276708`, `ΤΙΜ Α32-000085237`) ΚΑΙ ξεχωριστό «Φορ/κός αριθμός» — δηλαδή
 * τεκμηριώνει ΔΥΟ από τα τρία πεδία· το «Φορ/κή σειρά» ΔΕΝ αναφέρεται εκεί καθόλου και στηρίζεται
 * μόνο στο schema και στις τέσσερις γραμμές παραπάνω.
 *
 * Μέχρι τώρα στέλναμε ΜΟΝΟ `FINCODE = type.number` — δηλαδή τα σκέτα ψηφία, χωρίς το πρόθεμα, και
 * με τα δύο φορολογικά πεδία κενά.
 */
export type DocReference = {
  /** `TAXSERIES` — το τυπωμένο πρόθεμα σειράς του εκδότη, όταν το ξέρουμε. */
  taxSeries?: string;
  /** `TAXSERIESNUM` — ο τυπωμένος αριθμός του εκδότη, χωρίς το πρόθεμα. */
  taxSeriesNum?: string;
  /** `FINCODE` — η πλήρης τυπωμένη ταυτότητα («ΤΠΥ 17»), όχι τα σκέτα ψηφία. */
  fincode?: string;
};

/** Μέγεθος πεδίου στο SoftOne — κόβουμε εμείς αντί να σκάσει το ERP σε overflow. */
const FINCODE_MAX = 30;
const TAXSERIES_MAX = 50;

/**
 * Όταν το πρόθεμα είναι ΗΔΗ μέσα στον αριθμό («ΤΠΥ 17» και σειρά «ΤΠΥ»), επιστρέφει ό,τι μένει
 * («17») — αλλιώς `null`. Κενό string σημαίνει «ο αριθμός ΕΙΝΑΙ το πρόθεμα, δεν περισσεύει τίποτα».
 * Η σύγκριση περνά από το `normalizeDocRef`: αγνοεί κενά/παύλες ΚΑΙ διπλώνει τα ελληνικά ομόγλυφα,
 * ώστε «ΤΙΜ-ΑΑ-2455» (ελληνικά Α) με σειρά «ΤΙΜ-AA» (λατινικά A) να χωρίζεται σωστά αντί να
 * γράψει το πρόθεμα δύο φορές.
 */
function stripSeriesPrefix(number: string, series: string): string | null {
  const want = normalizeDocRef(series);
  if (!want) return null;
  let seen = '';
  for (let i = 0; i < number.length; i++) {
    seen += normalizeDocRef(number[i]);
    if (seen.length < want.length) continue;
    return seen === want ? number.slice(i + 1).replace(/^[^0-9A-ZΑ-Ω]+/i, '') : null;
  }
  return null; // ο αριθμός τελείωσε πριν συμπληρωθεί το πρόθεμα
}

/**
 * Χωρίζει την αναφορά του εκδότη στα τρία πεδία της κεφαλίδας. ΔΕΝ εφευρίσκει τίποτα: αν το
 * κανονικό έγγραφο δεν έχει σειρά, το `TAXSERIES` μένει κενό και ΟΛΗ η τυπωμένη αναφορά πάει στο
 * `TAXSERIESNUM`/`FINCODE` — καλύτερα ένα γεμάτο πεδίο παρά ένα μαντεμένο πρόθεμα.
 *
 * Τρεις περιπτώσεις, και οι τρεις καλυμμένες από tests:
 *  - πρόθεμα χωριστά (`series:'ΤΠΥ'`, `number:'17'`) → ΤΠΥ / 17 / «ΤΠΥ 17»
 *  - πρόθεμα μέσα στον αριθμό (`series:'ΤΠΥ'`, `number:'ΤΠΥ 17'`) → ΤΠΥ / 17 / «ΤΠΥ 17» (όχι «ΤΠΥ ΤΠΥ 17»)
 *  - χωρίς πρόθεμα (`series:null`, `number:'INV.239124'`) → — / INV.239124 / «INV.239124»
 */
export function documentReference(type: { series: string | null; number: string | null }): DocReference {
  const series = text(type.series) ?? '';
  const number = text(type.number) ?? '';
  if (!series && !number) return {};

  let taxSeries = series;
  let taxSeriesNum = number;
  let printed = number;

  if (series && number) {
    const rest = stripSeriesPrefix(number, series);
    if (rest == null) {
      // Ο αριθμός δεν κουβαλά το πρόθεμα: τα ενώνουμε με κενό, όπως τυπώνεται («ΤΠΥ 17»).
      printed = `${series} ${number}`;
    } else {
      // Το κουβαλά: ο τυπωμένος αριθμός ΕΙΝΑΙ η πλήρης ταυτότητα, δεν διπλασιάζουμε το πρόθεμα.
      // ΟΤΑΝ ΔΕΝ ΠΕΡΙΣΣΕΥΕΙ ΤΙΠΟΤΑ (ο αριθμός είναι σκέτο το πρόθεμα, π.χ. «ΤΔΑ»), κρατάμε
      // ΟΛΟΚΛΗΡΟ τον αριθμό ως «Φορ/κό αριθμό» αντί να αφήσουμε το πεδίο κενό: κενό πεδίο σημαίνει
      // ότι το SoftOne θα βάλει εκεί τον ΔΙΚΟ ΜΑΣ αύξοντα (`SERIESNUM`) — έτσι δείχνουν οι
      // γραμμές 1009/1034 του πελάτη — και ότι ο έλεγχος διπλοεγγραφής δεν θα τρέξει καθόλου.
      taxSeriesNum = rest === '' ? number : rest;
      printed = number;
    }
  } else if (!series) {
    taxSeries = '';
  }

  // Το «Παραστατικό» χωράει 30 χαρακτήρες: αν η πλήρης μορφή δεν χωράει, προτιμάμε τον ΑΡΙΘΜΟ
  // (το πιο αναγνωριστικό κομμάτι) από μια κομμένη στη μέση σειρά.
  let fincode = printed;
  if (fincode.length > FINCODE_MAX) fincode = number;
  if (fincode.length > FINCODE_MAX) fincode = fincode.slice(0, FINCODE_MAX);

  return {
    ...(taxSeries ? { taxSeries: taxSeries.slice(0, TAXSERIES_MAX) } : {}),
    ...(taxSeriesNum ? { taxSeriesNum: taxSeriesNum.slice(0, TAXSERIES_MAX) } : {}),
    ...(fincode ? { fincode } : {}),
  };
}

/** Ημερομηνία εγγράφου → `YYYY-MM-DD` (το έγγραφο είναι ήδη κανονικοποιημένο· κόβουμε ώρα αν υπάρχει). */
const trnDate = (date: string | null): string => (date ?? '').slice(0, 10);

/**
 * Κέντρο κόστους / έργο / δραστηριότητα, μόνο όταν έχουν οριστεί. Ποτέ `0` ή κενό: το SoftOne
 * διαβάζει το 0 ως «κανένα», αλλά ένα ρητό 0 σε πεδίο FK είναι θόρυβος στο payload.
 */
const analyticsOf = (m: PurdocLineCtx): { COSTCNTR?: number; PRJC?: number; PRJCSTAGE?: number } => ({
  ...(m.costCntr ? { COSTCNTR: m.costCntr } : {}),
  ...(m.prjc ? { PRJC: m.prjc } : {}),
  ...(m.prjcStage ? { PRJCSTAGE: m.prjcStage } : {}),
});

const vatIdFor = (rate: number | null, map: Record<number, number>): number | undefined => {
  if (rate == null || !Number.isFinite(rate)) return undefined;
  const id = map[rate];
  return typeof id === 'number' && Number.isFinite(id) ? id : undefined;
};

/** Ο πίνακας που θα δεχτεί ΑΥΤΗ τη γραμμή, όταν ο στόχος είναι `AUTO` (μόνο PURDOC). */
const autoTableFor = (m: PurdocLineCtx): 'ITELINES' | 'SRVLINES' | 'EXPANAL' | null => {
  if (m.mtrl != null) return m.isService ? 'SRVLINES' : 'ITELINES';
  if (m.expn != null) return 'EXPANAL';
  return null; // χρεοπίστωση ή τίποτα — δεν χωράει σε PURDOC
};

/**
 * Το «τι ταίριαξε» της γραμμής ταιριάζει με τον πίνακα που ζήτησε η σειρά;
 *
 * **Εξάγεται** ώστε το `KINDS_FOR_LINE_TABLE` του `lib/ocr/resolution-plan.ts` — που προσφέρει
 * στον χρήστη τα μητρώα *πριν* γραφτεί η αντιστοίχιση — να ελέγχεται ότι λέει ΑΚΡΙΒΩΣ το ίδιο με
 * αυτόν εδώ, που κρίνει ό,τι γράφτηκε. Πριν, η ισοδυναμία ζούσε μόνο σε σχόλιο.
 */
export function lineFits(table: PostLineTable, m: PurdocLineCtx): boolean {
  // Ο επιμερισμός γίνεται ΠΑΝΤΑ χρεοπιστώσεις, άρα χωράει μόνο σε `LINLINES`. Σε σειρά που
  // στέλνει είδη ή έξοδα δεν εκφράζεται — και το λέμε δυνατά αντί να πέσει σιωπηλά.
  if (hasAllocations(m)) return table === 'LINLINES';
  switch (table) {
    case 'ITELINES': case 'SRVLINES': return m.mtrl != null;
    case 'EXPANAL': return m.expn != null;
    case 'LINLINES': return m.lin != null;
    case 'AUTO': return autoTableFor(m) != null;
    // ΑΠΛΟΓΡΑΦΙΚΑ (ενότητα 1261 → `SXDOCSEX`): οι γραμμές δείχνουν σε λογαριασμούς εσόδων/εξόδων
    // και ο μεταφραστής τους ΔΕΝ έχει γραφτεί ακόμη. Επιστρέφουμε `false` ΕΠΙΤΗΔΕΣ: έτσι κάθε
    // τέτοια γραμμή γίνεται ΕΜΠΟΔΙΟ (`mismatchCode`) αντί να εκπεμφθεί κενό payload και να
    // «καταχωρηθεί» ένα παραστατικό χωρίς γραμμές. Σιωπηλή απώλεια είναι το χειρότερο σενάριο.
    case 'SXDOCLINES': return false;
  }
}

/** Έχει η γραμμή επιμερισμό; Μία και μόνη πηγή αλήθειας για payload ΚΑΙ ελέγχους. */
export const hasAllocations = (m: PurdocLineCtx | undefined | null): boolean =>
  (m?.allocations?.length ?? 0) > 0;

/**
 * Χτίζει το payload του `setData` για τον στόχο της σειράς. ΔΕΝ κρίνει αν επιτρέπεται η
 * καταχώριση — αυτό είναι δουλειά του `postingBlockers`, ώστε το dry-run να δείχνει payload ΚΑΙ
 * εμπόδια μαζί. Γραμμές που δεν χωρούν στον στόχο ΠΑΡΑΛΕΙΠΟΝΤΑΙ εδώ και γίνονται εμπόδιο εκεί:
 * το payload της προεπισκόπησης δείχνει τι θα έφευγε, τα εμπόδια γιατί δεν φεύγει.
 * Κενοί πίνακες παραλείπονται (το SoftOne διαβάζει ένα άδειο array ως «σβήσε τις γραμμές»).
 */
export function buildPurdocPayload(document: DocumentJson, ctx: PurdocContext): PostingPayload {
  const byRow = new Map<number, PurdocLineCtx>(ctx.lines.map((l) => [l.rowIndex, l]));
  const { object, lines: table } = ctx.target;

  const header: PurdocHeader = {
    SERIES: ctx.series,
    TRNDATE: trnDate(document.date),
    TRDR: ctx.trdr,
  };
  if (ctx.company != null) header.COMPANY = ctx.company;
  // Η αναφορά του ΕΚΔΟΤΗ στα τρία πεδία της: «Φορ/κή σειρά», «Φορ/κός αριθμός», «Παραστατικό».
  const ref = documentReference(document.type);
  if (ref.fincode) header.FINCODE = ref.fincode;
  if (ref.taxSeries) header.TAXSERIES = ref.taxSeries;
  if (ref.taxSeriesNum) header.TAXSERIESNUM = ref.taxSeriesNum;
  const comments = text(ctx.comments);
  if (comments) header.COMMENTS = comments;
  const mark = text(document.digital.mark);
  if (mark) header.MYDATAMARK = mark;
  const uid = text(document.digital.uid);
  if (uid) header.MYDATAUID = uid;

  const items: Record<'ITELINES' | 'SRVLINES', PurdocItemLine[]> = { ITELINES: [], SRVLINES: [] };
  const expenses: PurdocExpenseLine[] = [];
  const linLines: PurdocLinLine[] = [];

  document.lines.forEach((line, i) => {
    const match = byRow.get(i);
    if (!match) return;
    const vat = vatIdFor(line.vatRate, ctx.vatIdByRate);
    const name = text(line.name);
    const target = table === 'AUTO' ? autoTableFor(match) : table;
    if (!target || !lineFits(target, match)) return;

    if (target === 'LINLINES') {
      // ΕΠΙΜΕΡΙΣΜΟΣ: η μία γραμμή του παραστατικού γίνεται N γραμμές, μία ανά λογαριασμό.
      // Ποσότητα 1 και τιμή = το ποσό του κομματιού: το «πόσα τεμάχια» της αρχικής γραμμής δεν
      // επιμερίζεται (δεν αγοράσαμε 0,4 τεμάχια) — αυτό που μοιράζεται είναι η ΑΞΙΑ.
      if (hasAllocations(match)) {
        for (const a of match.allocations!) {
          const row: PurdocLinLine = {
            LINENUM: FIRST_LINENUM + linLines.length,
            MTRL: a.registryMtrl,
            MTRTYPE: num(a.mtrType, 0),
            QTY1: 1,
            PRICE: a.amount,
            DISC1PRC: 0,
            NETLINEVAL: a.amount,
            ...analyticsOf(match),
          };
          if (vat != null) row.VAT = vat;
          // Το σχόλιο κουβαλά και το ποσοστό: στο ERP η γραμμή θα φαίνεται μόνη της, και χωρίς
          // αυτό κανείς δεν καταλαβαίνει γιατί το ποσό δεν είναι το τυπωμένο του παραστατικού.
          const share = `${String(a.percent).replace('.', ',')}%`;
          row.COMMENTS = name ? `${name} · ${share}` : share;
          linLines.push(row);
        }
        return;
      }
      const row: PurdocLinLine = {
        LINENUM: FIRST_LINENUM + linLines.length,
        MTRL: match.lin as number,
        MTRTYPE: num(match.linMtrType, 0),
        QTY1: num(line.quantity, 1),
        PRICE: num(line.unitPrice, 0),
        ...discountFields(line),
        NETLINEVAL: num(line.net, 0),
        ...analyticsOf(match),
      };
      if (vat != null) row.VAT = vat;
      if (name) row.COMMENTS = name;
      linLines.push(row);
      return;
    }
    if (target === 'EXPANAL') {
      // Η «Ανάλυση εξόδων» ΔΕΝ έχει COSTCNTR / PRJC / PRJCSTAGE: δεν τα στέλνουμε εδώ, και το UI
      // το λέει ρητά αντί να αφήσει τον χρήστη να διαλέξει κάτι που θα χανόταν.
      expenses.push({
        LINENUM: FIRST_LINENUM + expenses.length,
        EXPN: match.expn as number,
        ...(vat != null ? { VAT: vat } : {}),
        EXPVAL: num(line.net, 0),
      });
      return;
    }
    if (target === 'SXDOCLINES') return; // δεν φτάνει ποτέ εδώ (το `lineFits` το έκοψε) — για τον τύπο
    const bucket = items[target];
    const row: PurdocItemLine = {
      LINENUM: FIRST_LINENUM + bucket.length,
      MTRL: match.mtrl as number,
      QTY1: num(line.quantity, 1),
      PRICE: num(line.unitPrice, 0),
      ...discountFields(line),
      ...analyticsOf(match),
    };
    if (vat != null) row.VAT = vat;
    if (name) row.COMMENTS = name;
    // Ο χαρακτηρισμός myDATA υπάρχει ΜΟΝΟ σε αυτούς τους τρεις πίνακες γραμμών.
    const cls = text(match.myDataCode);
    if (cls) row.MYDATACODE = cls;
    bucket.push(row);
  });

  const DATA: PostingPayload['DATA'] = { [object]: [header] };
  if (items.ITELINES.length) DATA.ITELINES = items.ITELINES;
  if (items.SRVLINES.length) DATA.SRVLINES = items.SRVLINES;
  if (expenses.length) DATA.EXPANAL = expenses;
  if (linLines.length) DATA.LINLINES = linLines;
  return { OBJECT: object, KEY: '', DATA };
}

/**
 * Η είσοδος του ελέγχου λογαριασμού: για κάθε γραμμή, ΣΕ ΠΟΙΟΝ πίνακα θα πάει. Ίδιος κανόνας με το
 * `buildPurdocPayload` (`lineFits` / `autoTableFor`) — μια γραμμή που δεν χωράει στον στόχο δεν
 * ελέγχεται εδώ, γιατί δεν θα σταλεί καθόλου (το λέει ήδη άλλο εμπόδιο).
 */
export function accountCheckInputs(ctx: Pick<PurdocContext, 'lines' | 'target'>): AccountCheckInput[] {
  const table = ctx.target.lines;
  return ctx.lines.map((m) => {
    const target = table === 'AUTO' ? autoTableFor(m) : table;
    const path: AccountPath | null = target && lineFits(target, m) ? target : null;
    return {
      rowIndex: m.rowIndex,
      path,
      article: m.linLabel ?? null,
      acnmsk: m.linAcnmsk ?? null,
      // Άγνωστο ΔΕΝ διαβάζεται ποτέ ως γνωστό: ένας καλών που ξέχασε το πεδίο παίρνει «άγνωστο».
      acnmskKnown: m.linAcnmskKnown ?? false,
      vatRate: m.vatRate ?? null,
    };
  });
}

/** Ανοχή αθροίσματος γραμμών έναντι της τυπωμένης καθαρής αξίας. */
const NET_TOLERANCE = 0.05;

/**
 * Το εμπόδιο που αντιστοιχεί σε «γραμμή που δεν χωράει στον πίνακα Χ».
 * ΧΩΡΙΣ `default`, όπως και το αδελφό του `lineFits`: ένας νέος πίνακας γραμμών πρέπει να σπάσει
 * εδώ τον compiler, αντί να πάρει σιωπηλά το μήνυμα των ειδών.
 */
const mismatchCode = (table: PostLineTable): BlockerCode => {
  switch (table) {
    case 'LINLINES': return 'lines_need_lineitem';
    case 'EXPANAL': return 'lines_need_expn';
    case 'AUTO': return 'lines_lineitem_unsupported';
    case 'ITELINES': case 'SRVLINES': return 'lines_need_mtrl';
    // Απλογραφικά: ο μεταφραστής δεν υπάρχει ακόμη, οπότε ΚΑΘΕ γραμμή είναι «δεν χωράει».
    case 'SXDOCLINES': return 'lines_sxdoc_unsupported';
  }
};

/**
 * Κάθε λόγος για τον οποίο η καταχώριση δεν πρέπει να γίνει, με σταθερή σειρά (το UI τα δείχνει
 * ως λίστα). Επιστρέφει κωδικούς· τα ελληνικά κείμενα ζουν στο `POST_ERROR_TEXT`.
 */
export function postingBlockers(
  document: DocumentJson,
  doc: PostingDoc,
  ctx: Pick<PurdocContext, 'lines' | 'vatIdByRate' | 'target'>,
  /**
   * Το αποτέλεσμα του `checkAccounts` για τις ίδιες γραμμές. Προαιρετικό μόνο για τους παλιούς
   * καλούντες/tests· το `post-softone.ts` το περνάει ΠΑΝΤΑ, σε προεπισκόπηση και σε καταχώριση.
   */
  accounts?: AccountCheck | null,
): BlockerCode[] {
  const out: BlockerCode[] = [];
  if (doc.status !== 'COMPLETED') out.push('not_completed');
  if (!doc.category) out.push('no_category');
  // Ασαφής έκπτωση ⇒ ΣΤΟΠ. Το SoftOne δεν ρωτά «ποσοστό ή ποσό;» — υπολογίζει, και μια λάθος
  // ερμηνεία γράφει παραστατικό με λάθος (ή αρνητικό) ποσό που κανείς δεν βλέπει μετά.
  if (document.lines.some((l) => discountAmbiguous(l))) out.push('line_discount_ambiguous');
  // ΤΡΕΙΣ διαφορετικές καταστάσεις, όχι μία. Το ενιαίο «δεν έχει αντιστοιχιστεί συναλλασσόμενος»
  // έστελνε τον χρήστη να ψάξει καρτέλα ακόμη κι όταν το παραστατικό ΔΕΝ ΕΧΕΙ ΑΦΜ για να ψάξει με
  // αυτόν — δουλειά που δεν γίνεται από εκεί που τον στέλναμε. Η εφαρμογή ξέρει ποια περίπτωση
  // είναι· ας το πει.
  if (!doc.softoneTrdr) {
    // `country: null` = σκέτα ψηφία που ΔΕΝ περνούν τον mod-11 της ΑΑΔΕ και δεν έχουν αναγνωρίσιμο
    // πρόθεμα χώρας — δηλαδή σκουπίδι της σάρωσης. Ξένο VAT με έγκυρο πρόθεμα (π.χ. `IE…`) ΔΕΝ
    // είναι άκυρο: απλώς δεν έχει καρτέλα ακόμη.
    const vat = normalizeVatId(document.issuer?.vat);
    if (!vat) out.push('no_trader_afm_missing');
    else if (vat.country == null) out.push('no_trader_afm_invalid');
    else out.push('no_trader');
  }
  if (!doc.softoneSeries || !doc.seriesSource) out.push('no_series');
  // Σειρά που δεν υπάρχει στο μητρώο: το `SERIES` θα έφευγε ούτως ή άλλως, αλλά κανείς δεν ξέρει
  // τι είναι — και καμία ρύθμιση στόχου δεν μπορεί να εφαρμοστεί πάνω της.
  else if (!doc.seriesKnown) out.push('series_unknown');
  else if (!doc.seriesEnabled) out.push('series_unknown');
  if (!ctx.target.supported) out.push('series_module_unsupported');
  // Ο τύπος του συναλλασσομένου πρέπει να ταιριάζει με το πεδίο του object: το `LINCREDOC.TRDR`
  // δέχεται ΠΙΣΤΩΤΗ (16), το `PURDOC`/`LINSUPDOC` ΠΡΟΜΗΘΕΥΤΗ (12). Το read-back δεν το πιάνει,
  // γιατί συγκρίνει με ό,τι στείλαμε.
  if (
    ctx.target.supported && doc.softoneTrdr && doc.traderSodtype != null
    && doc.traderSodtype !== SODTYPE_FOR_OBJECT[ctx.target.object]
  ) {
    out.push('trader_kind_mismatch');
  }
  if (!trnDate(document.date)) out.push('no_date');
  if (!text(document.type.number)) out.push('no_number');

  const table = ctx.target.lines;
  const byRow = new Map<number, PurdocLineCtx>(ctx.lines.map((l) => [l.rowIndex, l]));
  if (document.lines.length === 0) {
    out.push('no_lines');
  } else {
    const matched = document.lines.map((_, i) => byRow.get(i));
    // ΑΠΛΟΓΡΑΦΙΚΑ: ο μεταφραστής του `SXDOCSEX` δεν υπάρχει ακόμη, ΚΑΙ ο picker δεν προσφέρει
    // μητρώο γι' αυτόν τον πίνακα. Το «υπάρχουν γραμμές χωρίς αντιστοίχιση» θα έστελνε τον χρήστη
    // να «λύσει» κάτι που ΔΕΝ ΜΠΟΡΕΙ να λυθεί από πουθενά — ένα αδιέξοδο ντυμένο σαν εργασία.
    // Λέμε την αλήθεια: η ενότητα δεν υποστηρίζεται ακόμη για καταχώριση.
    if (table === 'SXDOCLINES') {
      out.push('lines_sxdoc_unsupported');
      return out;
    }
    // Ο ΕΠΙΜΕΡΙΣΜΟΣ μετράει ως αντιστοίχιση: η γραμμή ΞΕΡΕΙ πού πάει — σε περισσότερους από έναν
    // λογαριασμούς. Χωρίς αυτό, μια πλήρως επιμερισμένη γραμμή εμφανιζόταν «χωρίς αντιστοίχιση».
    const unmatched = matched.some(
      (m) => !m || (m.mtrl == null && m.expn == null && m.lin == null && !hasAllocations(m)),
    );
    if (unmatched) out.push('unmatched_lines');
    // Αντιστοιχισμένη γραμμή που δεν εκφράζεται στον πίνακα της σειράς: ΔΕΝ τη ρίχνουμε σιωπηλά
    // και δεν εφευρίσκουμε κωδικό — το λέμε δυνατά (π.χ. έξοδο EXPN σε σειρά που στέλνει LINLINES).
    // Ο ΕΠΙΜΕΡΙΣΜΟΣ μετράει κι εδώ. Χωρίς αυτόν, μια επιμερισμένη γραμμή σε σειρά που ΔΕΝ στέλνει
    // `LINLINES` δεν ήταν ούτε «αναντιστοίχιστη» (έχει επιμερισμό) ούτε «εκτός πίνακα» (τα
    // mtrl/expn/lin της είναι κενά) — άρα ΚΑΝΕΝΑ εμπόδιο, και ταυτόχρονα το payload δεν έβγαζε
    // καμία γραμμή: η δαπάνη εξαφανιζόταν σιωπηλά. Ακριβώς αυτό που ο έλεγχος υπάρχει να αποτρέψει.
    const misfit = matched.some(
      (m) => m && (m.mtrl != null || m.expn != null || m.lin != null || hasAllocations(m)) && !lineFits(table, m),
    );
    if (misfit) out.push(mismatchCode(table));
    // Η γραμμή LINLINES απαιτεί MTRTYPE· λείπει όταν το μητρώο χρεοπιστώσεων δεν το συγχρόνισε.
    if (table === 'LINLINES' && matched.some(
      (m) => (m?.lin != null && !hasAllocations(m) && m.linMtrType == null)
        || (m?.allocations?.some((a) => a.mtrType == null) ?? false),
    )) {
      out.push('lines_no_mtrtype');
    }
    const missingVat = document.lines.some((line) => vatIdFor(line.vatRate, ctx.vatIdByRate) == null);
    if (missingVat) out.push('no_vat_category');
  }

  if (document.totals.net != null && document.lines.length > 0) {
    const sum = document.lines.reduce((acc, l) => acc + (l.net ?? 0), 0);
    if (Math.abs(sum - document.totals.net) > NET_TOLERANCE) out.push('totals_mismatch');
  }
  // Κενός λογαριασμός ή λογαριασμός εκτός σχεδίου σε γραμμή LINLINES. Ένα ΑΓΝΩΣΤΟ (ασυγχρόνιστο
  // σχέδιο) δεν είναι εμπόδιο — είναι παρατήρηση, βλ. `postingWarnings`.
  out.push(...accountBlockers(accounts));
  return out;
}

/**
 * Παρατηρήσεις που ΔΕΝ εμποδίζουν: ο χρήστης πρέπει να τις δει πριν πατήσει «Καταχώριση», αλλά
 * δεν είναι λάθος του παραστατικού — είναι κατάσταση του μητρώου στο SoftOne.
 */
/**
 * ΕΝΑΣ ΚΩΔΙΚΟΣ, ΠΟΛΛΑ ΠΡΟΪΟΝΤΑ. Το πέρασμα κωδικού του `softone-match` ταιριάζει με ισότητα
 * `code`/`code1`/`code2` — και δεν κάθε «κωδικός» σε τιμολόγιο είναι ταυτότητα προϊόντος.
 *
 * Μετρημένο ζωντανά: τιμολόγιο BESSEY με **29 διαφορετικά εργαλεία** που κουβαλούν όλα τον ίδιο
 * `82057000` — τον **δασμολογικό κωδικό (CN)** για σφιγκτήρες, όχι κωδικό είδους. Το μητρώο του
 * ERP τυχαίνει να έχει είδος με αυτόν τον κωδικό, οπότε και τα 29 θα γίνονταν σιωπηλά ΤΟ ΙΔΙΟ
 * είδος: λάθος αποθήκη, λάθος κόστος, και κανείς δεν θα το έβλεπε ποτέ.
 *
 * ΔΕΝ μπλοκάρουμε: υπάρχει και η νόμιμη περίπτωση — ίδιο προϊόν σε πολλές γραμμές που διαφέρουν
 * μόνο στο σειριακό (π.χ. «ΠΡΟΓΡΑΜΜΑ ΑΝΑΒΑΘΜΙΣΗΣ IRIS SN: …»). Εκεί το ταίριασμα είναι σωστό και
 * ένα μπλόκο θα πετούσε δουλειά. Λέμε αυτό που ξέρουμε με βεβαιότητα: «ο κωδικός καλύπτει γραμμές
 * με διαφορετικές περιγραφές — έλεγξέ τες».
 */
function sharedCodeManyProducts(
  document: DocumentJson,
  lines: readonly PurdocLineCtx[],
): boolean {
  const byRow = new Map(lines.map((l) => [l.rowIndex, l]));
  const groups = new Map<string, { names: Set<string>; mtrls: Set<number> }>();
  document.lines.forEach((line, i) => {
    const code = text(line.code);
    const mtrl = byRow.get(i)?.mtrl;
    if (!code || mtrl == null) return;
    let g = groups.get(code);
    if (!g) { g = { names: new Set(), mtrls: new Set() }; groups.set(code, g); }
    // ΟΧΙ `normalizeLineText`: αυτός κόβει επίτηδες τους αριθμούς, για να ταιριάζει η ΜΝΗΜΗ
    // «ίδιο προϊόν, άλλο μέγεθος». Εδώ οι αριθμοί είναι ΤΟ ΠΑΝ — «TGRC 160/80» και «TGRC 500/120»
    // είναι άλλο εργαλείο. Μετρημένο: με τον κανονικοποιητή της μνήμης και οι 10 γραμμές BESSEY
    // έμοιαζαν ίδιες και η προειδοποίηση δεν χτυπούσε ποτέ.
    g.names.add(line.name?.toLowerCase().replace(/\s+/g, ' ').trim() || '');
    g.mtrls.add(mtrl);
  });
  // Διαφορετικές περιγραφές ΚΑΙ όλες κατέληξαν στο ΙΔΙΟ είδος: εκεί είναι το ρίσκο.
  return Array.from(groups.values()).some((g) => g.names.size > 1 && g.mtrls.size === 1);
}

export function postingWarnings(
  ctx: Pick<PurdocContext, 'lines' | 'target'>,
  accounts?: AccountCheck | null,
  /** Προαιρετικό: χωρίς αυτό δεν μπορεί να ελεγχθεί ο κοινός κωδικός (οι παλιοί καλούντες/tests). */
  document?: DocumentJson | null,
): WarningCode[] {
  const out: WarningCode[] = [];
  const hasLines = ctx.lines.length > 0;
  if (document && sharedCodeManyProducts(document, ctx.lines)) out.push('shared_code_many_products');
  if (hasLines && ctx.lines.some((l) => l.noClassification)) out.push('no_mydata_classification');
  // Οι πίνακες χωρίς πεδίο MYDATACODE: ο χαρακτηρισμός έρχεται αποκλειστικά από το μητρώο.
  if (hasLines && (ctx.target.lines === 'LINLINES' || ctx.target.lines === 'EXPANAL')) {
    out.push('mydata_from_master');
  }
  out.push(...accountWarnings(accounts));
  return out;
}

/** Οι πίνακες γραμμών που δέχεται το object του στόχου — για μηνύματα και UI. */
export const linesAllowedFor = (target: PostingTarget): string =>
  LINES_FOR_OBJECT[target.object].map((t) => POST_LINES_LABEL[t]).join(' · ');
