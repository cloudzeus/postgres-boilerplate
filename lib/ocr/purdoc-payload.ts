// lib/ocr/purdoc-payload.ts — ΚΑΘΑΡΟ (χωρίς prisma / δίκτυο).
// Ο μεταφραστής «κανονικό έγγραφο (§17.1) → SoftOne setData payload» και οι προϋποθέσεις που
// πρέπει να ισχύουν για να επιτραπεί η καταχώριση. Ζει χωριστά από το `post-softone.ts` ώστε
// να δοκιμάζεται και να εμφανίζεται (dry-run) χωρίς να μπορεί καν να αγγίξει το SoftOne.
//
// Ο ΣΤΟΧΟΣ ΔΕΝ ΕΙΝΑΙ ΣΤΑΘΕΡΟΣ: το object και ο πίνακας γραμμών έρχονται από τη σειρά του
// εγγράφου (`lib/ocr/posting-target.ts`), όχι από το τι ταίριαξε η κάθε γραμμή. Ένα τιμολόγιο
// δαπανών πάει σε `LINSUPDOC`/`LINLINES`, μια αγορά εμπορευμάτων σε `PURDOC`/`ITELINES`.
import type { DocumentJson } from './canonical';
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
};

export type PurdocContext = {
  /** Πού καταχωρείται: object + πίνακας γραμμών, από τη σειρά του εγγράφου. */
  target: PostingTarget;
  /** SoftOne SERIES (αριθμός σειράς). */
  series: number;
  /** SoftOne TRDR του συναλλασσομένου (προμηθευτή ή πιστωτή). */
  trdr: number;
  /** Προαιρετικό COMPANY — κανονικά το session είναι ήδη δεμένο σε εταιρία. */
  company?: number | null;
  lines: PurdocLineCtx[];
  /** Συντελεστής ΦΠΑ (π.χ. 24) → κωδικός ΦΠΑ SoftOne (`VatCategory.code`). */
  vatIdByRate: Record<number, number>;
  comments?: string | null;
};

/**
 * Η κεφαλίδα. ΙΔΙΑ και στα τρία objects (DB πίνακας FINDOC) — επαληθευμένο στο schema.
 * Στέλνουμε ΜΟΝΟ ό,τι πραγματικά ξέρουμε· τα υπόλοιπα «required» πεδία (FISCPRD, PERIOD, BRANCH,
 * SOCURRENCY, TRDRRATE, GLUPD, …) έχουν defaults στο SoftOne και τα συμπληρώνει το ίδιο.
 * Δεν μαντεύουμε χρήση, υποκατάστημα ή ισοτιμίες.
 */
export type PurdocHeader = {
  SERIES: number;
  TRNDATE: string;
  TRDR: number;
  FINCODE?: string;
  COMPANY?: number;
  COMMENTS?: string;
  MYDATAMARK?: string;
  MYDATAUID?: string;
};

/** Γραμμή ειδών/υπηρεσιών (DB MTRLINES) σε PURDOC. */
export type PurdocItemLine = {
  LINENUM: number; MTRL: number; QTY1: number; PRICE: number; DISC1PRC: number;
  VAT?: number; COMMENTS?: string; MYDATACODE?: string;
  COSTCNTR?: number; PRJC?: number; PRJCSTAGE?: number;
};
/** Γραμμή ανάλυσης εξόδων (EXPANAL) — δεν έχει ποσότητα/τιμή, μόνο αξία. */
export type PurdocExpenseLine = { LINENUM: number; EXPN: number; VAT?: number; EXPVAL: number };
/** Γραμμή ειδικών συναλλαγών (LINLINES): `MTRL` = ΧΡΕΟΠΙΣΤΩΣΗ, με τον τύπο της. */
export type PurdocLinLine = {
  LINENUM: number; MTRL: number; MTRTYPE: number; QTY1: number; PRICE: number; DISC1PRC: number;
  NETLINEVAL: number; VAT?: number; COMMENTS?: string;
  COSTCNTR?: number; PRJC?: number; PRJCSTAGE?: number;
};

export type PostingObjectName = 'PURDOC' | 'LINSUPDOC' | 'LINCREDOC';

export type PostingPayload = {
  OBJECT: PostingObjectName;
  KEY: '';
  DATA: {
    PURDOC?: PurdocHeader[];
    LINSUPDOC?: PurdocHeader[];
    LINCREDOC?: PurdocHeader[];
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
  | 'no_trader'
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
  | 'lines_no_mtrtype'
  | 'series_unknown'
  | 'series_module_unsupported'
  | 'trader_kind_mismatch';

/** Μη-αποτρεπτικές παρατηρήσεις: φαίνονται στην προεπισκόπηση, δεν κλειδώνουν το κουμπί. */
export type WarningCode = 'no_mydata_classification' | 'mydata_from_master';

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const text = (v: unknown): string | undefined => {
  const s = v == null ? '' : String(v).trim();
  return s === '' ? undefined : s;
};

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

/** Το «τι ταίριαξε» της γραμμής ταιριάζει με τον πίνακα που ζήτησε η σειρά; */
function lineFits(table: PostLineTable, m: PurdocLineCtx): boolean {
  switch (table) {
    case 'ITELINES': case 'SRVLINES': return m.mtrl != null;
    case 'EXPANAL': return m.expn != null;
    case 'LINLINES': return m.lin != null;
    case 'AUTO': return autoTableFor(m) != null;
  }
}

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
  const fincode = text(document.type.number);
  if (fincode) header.FINCODE = fincode;
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
      const row: PurdocLinLine = {
        LINENUM: FIRST_LINENUM + linLines.length,
        MTRL: match.lin as number,
        MTRTYPE: num(match.linMtrType, 0),
        QTY1: num(line.quantity, 1),
        PRICE: num(line.unitPrice, 0),
        DISC1PRC: num(line.discount, 0),
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
    const bucket = items[target];
    const row: PurdocItemLine = {
      LINENUM: FIRST_LINENUM + bucket.length,
      MTRL: match.mtrl as number,
      QTY1: num(line.quantity, 1),
      PRICE: num(line.unitPrice, 0),
      DISC1PRC: num(line.discount, 0),
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

/** Ανοχή αθροίσματος γραμμών έναντι της τυπωμένης καθαρής αξίας. */
const NET_TOLERANCE = 0.05;

/** Το εμπόδιο που αντιστοιχεί σε «γραμμή που δεν χωράει στον πίνακα Χ». */
const mismatchCode = (table: PostLineTable): BlockerCode => {
  switch (table) {
    case 'LINLINES': return 'lines_need_lineitem';
    case 'EXPANAL': return 'lines_need_expn';
    case 'AUTO': return 'lines_lineitem_unsupported';
    default: return 'lines_need_mtrl';
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
): BlockerCode[] {
  const out: BlockerCode[] = [];
  if (doc.status !== 'COMPLETED') out.push('not_completed');
  if (!doc.category) out.push('no_category');
  if (!doc.softoneTrdr) out.push('no_trader');
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
    const unmatched = matched.some((m) => !m || (m.mtrl == null && m.expn == null && m.lin == null));
    if (unmatched) out.push('unmatched_lines');
    // Αντιστοιχισμένη γραμμή που δεν εκφράζεται στον πίνακα της σειράς: ΔΕΝ τη ρίχνουμε σιωπηλά
    // και δεν εφευρίσκουμε κωδικό — το λέμε δυνατά (π.χ. έξοδο EXPN σε σειρά που στέλνει LINLINES).
    const misfit = matched.some((m) => m && (m.mtrl != null || m.expn != null || m.lin != null) && !lineFits(table, m));
    if (misfit) out.push(mismatchCode(table));
    // Η γραμμή LINLINES απαιτεί MTRTYPE· λείπει όταν το μητρώο χρεοπιστώσεων δεν το συγχρόνισε.
    if (table === 'LINLINES' && matched.some((m) => m?.lin != null && m.linMtrType == null)) {
      out.push('lines_no_mtrtype');
    }
    const missingVat = document.lines.some((line) => vatIdFor(line.vatRate, ctx.vatIdByRate) == null);
    if (missingVat) out.push('no_vat_category');
  }

  if (document.totals.net != null && document.lines.length > 0) {
    const sum = document.lines.reduce((acc, l) => acc + (l.net ?? 0), 0);
    if (Math.abs(sum - document.totals.net) > NET_TOLERANCE) out.push('totals_mismatch');
  }
  return out;
}

/**
 * Παρατηρήσεις που ΔΕΝ εμποδίζουν: ο χρήστης πρέπει να τις δει πριν πατήσει «Καταχώριση», αλλά
 * δεν είναι λάθος του παραστατικού — είναι κατάσταση του μητρώου στο SoftOne.
 */
export function postingWarnings(ctx: Pick<PurdocContext, 'lines' | 'target'>): WarningCode[] {
  const out: WarningCode[] = [];
  const hasLines = ctx.lines.length > 0;
  if (hasLines && ctx.lines.some((l) => l.noClassification)) out.push('no_mydata_classification');
  // Οι πίνακες χωρίς πεδίο MYDATACODE: ο χαρακτηρισμός έρχεται αποκλειστικά από το μητρώο.
  if (hasLines && (ctx.target.lines === 'LINLINES' || ctx.target.lines === 'EXPANAL')) {
    out.push('mydata_from_master');
  }
  return out;
}

/** Οι πίνακες γραμμών που δέχεται το object του στόχου — για μηνύματα και UI. */
export const linesAllowedFor = (target: PostingTarget): string =>
  LINES_FOR_OBJECT[target.object].map((t) => POST_LINES_LABEL[t]).join(' · ');
