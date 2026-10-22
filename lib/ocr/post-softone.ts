// lib/ocr/post-softone.ts — SERVER. One place for "post this document to SoftOne" (route + template runner).
import 'server-only';
import { findDuplicatePosting } from '@/lib/ocr/duplicate-post';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { decideLineUnits, hasBuyUnit } from '@/lib/ocr/line-units';
import { getSetting } from '@/lib/settings';
import { softoneCall, softoneGetData, SoftoneTransportError } from '@/lib/softone';
import { logAudit } from '@/lib/audit';
import { fetchNoteState } from '@/lib/softone-sync/delivery-notes';
import { normalizeDocRef } from '@/lib/doc-reference';
import { buildReviewFlags } from '@/lib/templates/run-logic';
import type { DocumentJson } from './canonical';
import { loadDocumentJson } from './document';
import {
  accountCheckInputs, buildPurdocPayload, documentReference, postingBlockers, postingWarnings,
  type BlockerCode, type DocReference, type PostingPayload, type PurdocContext, type PurdocLineCtx, type WarningCode,
} from './purdoc-payload';
import { accountDetails, checkAccounts, type AccountCheck } from './account-check';
import { loadAccountChart } from './account-chart';
import { describeTargetShort, resolvePostingTarget, type PostingTarget } from './posting-target';
import { VAT_RATE_MAP_SETTING, buildVatRateMap, parseVatRateOverrides } from './vat-map';
import { postingComment } from './posting-comment';
import { softoneErrorLine } from './softone-error-text';
import { UTILITY_KIND_TITLE, analyzeUtility, utilityInputFromDocument } from './utility-bills';

/** Αριθμός ή `null` — ο ΦΠΑ μιας γραμμής όπως τον κρατά το κανονικό έγγραφο. */
const vatRateOf = (v: unknown): number | null => {
  const n = v == null || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Ο διακόπτης ασφαλείας. Κλειστός = καμία εγγραφή δεν φεύγει προς το SoftOne (μόνο dry-run). */
export const POSTING_ENABLED_KEY = 'softone.postingEnabled';

export type PostErrorCode = 'not_found' | 'posting_disabled' | 'already_posted' | 'duplicate' | 'conversion_check' | 'amounts_check' | BlockerCode;

export class PostError extends Error {
  constructor(public code: PostErrorCode, message: string) {
    super(message);
    this.name = 'PostError';
  }
}

/**
 * A precondition the poster refuses on, in Greek. Shared on purpose: the runner turns it into the
 * BLOCKED run's reason, the manual post route into the toast and the dry-run card into its blocker
 * list, so a user sees the same sentence whichever way the posting was attempted.
 */
export const POST_ERROR_TEXT: Record<PostErrorCode, string> = {
  // ΚΑΝΟΝΑΣ ΚΕΙΜΕΝΟΥ: τι λείπει/τι δεν ταιριάζει, ΚΑΙ τι να κάνεις — χωρίς ονόματα πινάκων της
  // SoftOne (EXPANAL, LINLINES, MTRTYPE) και χωρίς λογιστική ορολογία που δεν εξηγείται.
  // Οι όροι «είδος / υπηρεσία / έξοδο αγοράς / δαπάνη σε λογαριασμό / πάγιο» είναι αυτοί του
  // γλωσσαρίου (`lib/ocr/glossary.ts`) — ίδια λέξη, ίδια έννοια παντού.
  not_found: 'Το παραστατικό δεν βρέθηκε (μάλλον διαγράφηκε).',
  conversion_check: 'Ο έλεγχος πριν από τη μετατροπή του δελτίου σε τιμολόγιο απέτυχε — δεν γράφτηκε τίποτα στη SoftOne.',
  amounts_check: 'Η SoftOne θα κατέγραφε άλλο ποσό από αυτό του παραστατικού — δεν γράφτηκε τίποτα.',
  not_completed: 'Η ανάγνωση του παραστατικού δεν ολοκληρώθηκε. Κάνε «Επανασάρωση».',
  no_category: 'Διάλεξε «Κατηγορία» στην κάτω μπάρα.',
  line_discount_ambiguous: 'Μια γραμμή έχει έκπτωση που δεν βγαίνει από τα ποσά της, οπότε δεν ξέρουμε αν είναι ποσοστό ή ποσό. Διόρθωσε έκπτωση ή καθαρή αξία της γραμμής στην «Επεξεργασία γραμμών».',
  // Τρία μηνύματα για τρεις καταστάσεις: η δουλειά που πρέπει να γίνει είναι ΑΛΛΗ σε κάθε μία.
  no_trader: 'Ο εκδότης δεν υπάρχει ακόμη στη SoftOne. Δημιούργησέ τον με τα στοιχεία της ΑΑΔΕ (λωρίδα ελέγχων, πάνω).',
  no_trader_afm_missing: 'Δεν διαβάστηκε ΑΦΜ εκδότη, οπότε ο εκδότης δεν μπορεί να βρεθεί στη SoftOne. Συμπλήρωσε τον ΑΦΜ στα πεδία του εκδότη.',
  no_trader_afm_invalid: 'Ο ΑΦΜ εκδότη που διαβάστηκε δεν είναι έγκυρος. Διόρθωσέ τον στα πεδία του εκδότη (για ξένο, με το πρόθεμα χώρας, π.χ. DE…).',
  no_series: 'Διάλεξε «Είδος παραστατικού στη SoftOne» στην κάτω μπάρα.',
  no_date: 'Λείπει η ημερομηνία του παραστατικού — συμπλήρωσέ τη στα πεδία.',
  no_number: 'Λείπει ο αριθμός του παραστατικού — συμπλήρωσέ τον στα πεδία.',
  no_lines: 'Το παραστατικό δεν έχει γραμμές. Πρόσθεσέ τες από την «Επεξεργασία γραμμών» ή κάνε «Επανασάρωση».',
  unmatched_lines: 'Κάποιες γραμμές δεν έχουν ακόμη «τι αφορούν» στη SoftOne. Άνοιξε κάθε γραμμή και διάλεξε.',
  no_vat_category: 'Ένας συντελεστής ΦΠΑ των γραμμών δεν έχει αντίστοιχο κωδικό ΦΠΑ στη SoftOne. Όρισέ τον από τη λωρίδα ελέγχων.',
  totals_mismatch: 'Οι γραμμές δεν αθροίζουν στην καθαρή αξία του παραστατικού. Δες «Τα ποσά δεν κλείνουν».',
  lines_need_mtrl: 'Το είδος παραστατικού που διάλεξες δέχεται μόνο είδη ή υπηρεσίες. Κάποια γραμμή έχει οριστεί ως δαπάνη σε λογαριασμό ή έξοδο αγοράς: άλλαξε τη γραμμή, ή διάλεξε είδος παραστατικού για δαπάνες.',
  lines_need_expn: 'Το είδος παραστατικού που διάλεξες δέχεται μόνο έξοδα αγοράς. Κάποια γραμμή έχει οριστεί ως είδος, υπηρεσία ή δαπάνη σε λογαριασμό: άλλαξε τη γραμμή ή το είδος παραστατικού.',
  lines_need_lineitem: 'Το είδος παραστατικού που διάλεξες δέχεται μόνο δαπάνες σε λογαριασμό (π.χ. ρεύμα, ενοίκιο, συνδρομές). Κάποια γραμμή έχει οριστεί ως είδος, υπηρεσία ή έξοδο αγοράς: άλλαξε τη γραμμή ή το είδος παραστατικού.',
  lines_lineitem_unsupported: 'Κάποια γραμμή έχει οριστεί ως δαπάνη σε λογαριασμό, αλλά το είδος παραστατικού που διάλεξες καταχωρεί αγορές ειδών. Διάλεξε είδος παραστατικού για δαπάνες (ειδικές συναλλαγές), ή όρισε τη γραμμή ως είδος/υπηρεσία.',
  lines_sxdoc_unsupported: 'Αυτό το είδος παραστατικού ανήκει στα απλογραφικά βιβλία, που η εφαρμογή δεν καταχωρεί ακόμη. Διάλεξε άλλο είδος παραστατικού.',
  lines_asset_unsupported: 'Κάποια γραμμή έχει οριστεί ως πάγιο, αλλά το είδος παραστατικού που διάλεξες δεν δέχεται πάγια. Διάλεξε είδος παραστατικού αγορών.',
  asset_no_whouse: 'Για τα πάγια λείπει μια ρύθμιση από τη SoftOne (αποθήκη παγίων). Ζήτησε από τον διαχειριστή να τρέξει τον συγχρονισμό «Πάγια» στα Μητρώα αναφοράς.',
  lines_no_mtrtype: 'Μια δαπάνη σε λογαριασμό δεν έχει πλήρη στοιχεία στη SoftOne. Ζήτησε από τον διαχειριστή νέο συγχρονισμό στα Μητρώα αναφοράς.',
  series_unknown: 'Το είδος παραστατικού που έχει οριστεί δεν υπάρχει (ή είναι ανενεργό) στη SoftOne. Διάλεξε άλλο από τη λίστα στην κάτω μπάρα.',
  series_module_unsupported: 'Αυτό το είδος παραστατικού δεν καταχωρείται από την εφαρμογή. Διάλεξε παραστατικό αγορών, προμηθευτών, χρεωστών ή πιστωτών.',
  registry_not_in_installation: 'Κάποια γραμμή δείχνει σε κωδικό που δεν υπάρχει στη SoftOne που είμαστε συνδεδεμένοι (παλιά σύνδεση). Άνοιξε τη γραμμή και διάλεξε ξανά τι αφορά.',
  trader_kind_mismatch: 'Ο εκδότης είναι συνδεδεμένος με καρτέλα άλλου τύπου (π.χ. πιστωτή αντί για προμηθευτή) από αυτόν που δέχεται το είδος παραστατικού. Διόρθωσέ το από τη λωρίδα ελέγχων, ή άλλαξε είδος παραστατικού.',
  account_missing: 'Μια δαπάνη σε λογαριασμό δεν έχει λογαριασμό λογιστικής στη SoftOne. Διάλεξε άλλη για τη γραμμή, ή ζήτησε από τον λογιστή να της ορίσει λογαριασμό.',
  account_not_in_chart: 'Ο λογαριασμός λογιστικής μιας γραμμής δεν υπάρχει στο λογιστικό σχέδιο της SoftOne. Διάλεξε άλλη δαπάνη για τη γραμμή ή ρώτησε τον λογιστή.',
  account_not_postable: 'Ο λογαριασμός λογιστικής μιας γραμμής είναι συγκεντρωτικός και δεν δέχεται εγγραφές. Διάλεξε άλλη δαπάνη για τη γραμμή ή ρώτησε τον λογιστή.',
  account_is_mask: 'Μια δαπάνη σε λογαριασμό έχει γενικό πρότυπο λογαριασμού (με *) αντί για συγκεκριμένο λογαριασμό. Ζήτησε από τον λογιστή να ορίσει συγκεκριμένο λογαριασμό.',
  posting_disabled: 'Η καταχώριση στη SoftOne είναι απενεργοποιημένη (Ρυθμίσεις → Διασυνδέσεις).',
  already_posted: 'Έχει ήδη καταχωριστεί στη SoftOne.',
  duplicate: 'Το ίδιο τιμολόγιο (ίδιος ΑΦΜ εκδότη και ίδιος αριθμός) έχει ήδη καταχωριστεί',
};

/**
 * Παρατηρήσεις που ΔΕΝ εμποδίζουν. Ο χαρακτηρισμός myDATA είναι ιδιότητα του ΜΗΤΡΩΟΥ στο SoftOne
 * (είδος / υπηρεσία / χρεοπίστωση / έξοδο) — η εφαρμογή δεν τον ορίζει ανά γραμμή και δεν τον
 * εφευρίσκει· διόρθωσή του σημαίνει διόρθωση του μητρώου στο ERP.
 */
export const POST_WARNING_TEXT: Record<WarningCode, string> = {
  no_mydata_classification: 'Υπάρχει γραμμή της οποίας το μητρώο στο SoftOne δεν έχει χαρακτηρισμό myDATA — θα καταχωριστεί αχαρακτήριστη',
  mydata_from_master: 'Ο πίνακας γραμμών δεν έχει πεδίο χαρακτηρισμού: ο χαρακτηρισμός myDATA θα προκύψει από το μητρώο του κάθε κωδικού',
  // Το ίδιο μήνυμα και για τις δύο αιτίες «δεν ξέρω» — το `accountWarningText` το εξειδικεύει.
  account_unknown: 'Ο έλεγχος λογαριασμού γενικής δεν μπόρεσε να κρίνει — ούτε εγκρίνει ούτε εμποδίζει',
  account_not_covered: 'Ο έλεγχος λογαριασμού γενικής δεν καλύπτει ακόμη γραμμές ειδών, υπηρεσιών και εξόδων — ο λογαριασμός τους συντίθεται στο SoftOne',
  account_vat_mismatch: 'Υπάρχει γραμμή που πάει σε λογαριασμό για άλλον συντελεστή ΦΠΑ από αυτόν της γραμμής — έλεγξε τη χρεοπίστωση',
  shared_code_many_products: 'Γραμμές με ΔΙΑΦΟΡΕΤΙΚΕΣ περιγραφές μοιράζονται τον ίδιο κωδικό και ταίριαξαν όλες στο ίδιο είδος — συχνά ο κωδικός είναι δασμολογικός (CN), όχι κωδικός προϊόντος· έλεγξε τις γραμμές πριν την καταχώριση',
};

/** «Το λογιστικό σχέδιο δεν έχει συγχρονιστεί» — ΜΙΑ πρόταση, όχι μία ανά γραμμή. */
export const ACCOUNT_CHART_NOT_SYNCED = 'Το λογιστικό σχέδιο δεν έχει συγχρονιστεί — ο έλεγχος λογαριασμού γενικής δεν έτρεξε (Μητρώα αναφοράς → «Συγχρονισμός όλων»)';

/**
 * Το κείμενο ενός εμποδίου, με τις ανά γραμμή λεπτομέρειες όταν είναι εμπόδιο του ελέγχου
 * λογαριασμού: ο λογιστής πρέπει να δει ΠΟΙΑ χρεοπίστωση και ΠΟΙΟΝ λογαριασμό, όχι μια γενική φράση.
 */
export function blockerMessage(code: BlockerCode, accounts: AccountCheck | null): string {
  if (code === 'account_missing' || code === 'account_not_in_chart' || code === 'account_is_mask' || code === 'account_not_postable') {
    const details = accountDetails(code, accounts);
    return details.length ? `${POST_ERROR_TEXT[code]}: ${details.join(' · ')}` : POST_ERROR_TEXT[code];
  }
  return blockerText(code);
}

export function warningMessage(code: WarningCode, accounts: AccountCheck | null): string {
  if (code === 'account_unknown') {
    // Ασυγχρόνιστο σχέδιο: μία πρόταση. ΔΕΝ απαριθμούμε κάθε γραμμή ως «λείπει».
    if (accounts && !accounts.chartSynced) return ACCOUNT_CHART_NOT_SYNCED;
    const details = accountDetails(code, accounts);
    return details.length ? details.join(' · ') : POST_WARNING_TEXT[code];
  }
  if (code === 'account_vat_mismatch') {
    const details = accountDetails(code, accounts);
    return details.length ? details.join(' · ') : POST_WARNING_TEXT[code];
  }
  return POST_WARNING_TEXT[code];
}

/** Το ίδιο μήνυμα, με τον αριθμό του παραστατικού που ΥΠΑΡΧΕΙ ήδη στο SoftOne. */
const alreadyPostedText = (ref: string | null): string =>
  ref ? `${POST_ERROR_TEXT.already_posted} (${ref})` : POST_ERROR_TEXT.already_posted;

export const blockerText = (code: BlockerCode): string => POST_ERROR_TEXT[code] ?? code;

/**
 * A manual post settles the run the user was looking at: the latest run that still says «προς έλεγχο»
 * or «μπλοκαρισμένο» becomes POSTED, and the document's cached banner follows it. A FAILED run is
 * skipped — it produced nothing to post, so it stays the failure it was.
 * Best-effort by design: the document IS posted at this point, and a bookkeeping write that fails
 * must not turn a successful post into an error.
 */
async function markLatestRunPosted(documentId: string): Promise<void> {
  const run = await prisma.templateRun.findFirst({
    where: { documentId, status: { not: 'FAILED' } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: { template: { select: { slug: true, name: true } } },
  });
  if (!run || (run.status !== 'REVIEW' && run.status !== 'BLOCKED')) return;

  const flags = (run.flags as { review?: string[]; blocked?: string[] } | null) ?? {};
  const reviewFlags = buildReviewFlags(run.template, 'POSTED', run.id, { review: flags.review ?? [], blocked: flags.blocked ?? [] });
  await prisma.$transaction([
    prisma.templateRun.update({ where: { id: run.id }, data: { status: 'POSTED' } }),
    prisma.ocrDocument.update({ where: { id: documentId }, data: { reviewFlags: reviewFlags as unknown as Prisma.InputJsonValue } }),
  ]);
}

type DocRow = {
  id: string;
  status: string;
  category: string | null;
  softoneTrdr: number | null;
  softoneSeries: string | null;
  softoneName: string | null;
  seriesSource: number | null;
  postStatus: string;
  postedRef: string | null;
};

type Gathered = {
  doc: DocRow;
  document: DocumentJson;
  ctx: PurdocContext;
  blockers: BlockerCode[];
  warnings: WarningCode[];
  payload: PostingPayload;
  accounts: AccountCheck;
};

/**
 * Πού καταχωρείται ΑΥΤΟ το έγγραφο: η σειρά του λέει το object και τον πίνακα γραμμών.
 * Οι σειρές αγορών ζουν σε άλλο μητρώο (`PurchaseDocType`, SOSOURCE 1251) από τις υπόλοιπες
 * (`SoftoneDocSeries`) — ο ίδιος κωδικός υπάρχει και στα δύο, οπότε ψάχνουμε με ΑΜΦΟΤΕΡΑ.
 */
async function loadTarget(
  code: string | null, sosource: number | null,
): Promise<{ target: PostingTarget; known: boolean; enabled: boolean }> {
  if (!code) return { target: resolvePostingTarget({ sosource }), known: false, enabled: false };
  const row = sosource === 1251
    ? await prisma.purchaseDocType.findUnique({
        where: { code },
        select: { name: true, section: true, postObject: true, postLines: true, enabled: true },
      })
    : await prisma.softoneDocSeries.findUnique({
        where: { sosource_code: { sosource: sosource ?? 0, code } },
        select: { name: true, section: true, postObject: true, postLines: true, enabled: true },
      });
  // Σειρά που ΔΕΝ βρέθηκε: δεν προσποιούμαστε ότι ισχύει η προεπιλογή της ενότητας — το λέμε,
  // ώστε να μη φύγει `SERIES` που κανείς δεν αναγνωρίζει (και καμία ρύθμιση να μη «χάνεται»).
  return {
    target: resolvePostingTarget({ sosource, ...(row ?? {}) }),
    known: Boolean(row),
    enabled: Boolean(row?.enabled),
  };
}

/**
 * Everything the posting decision needs, read once: the document row, the canonical JSON, the
 * per-line SoftOne matches and the VAT registry. Pure from here on — the dry-run and the real post
 * see EXACTLY the same payload and the same blockers, which is the whole point of the preview.
 */
/**
 * ΜΕΤΑΣΧΗΜΑΤΙΣΜΟΣ από δελτίο αποστολής: η σειρά-στόχος (π.χ. 2061 «Τιμολόγιο Αγοράς», ΟΧΙ η σειρά
 * που έχει το έγγραφο — ένα «ΔΑ-Τιμολόγιο» θα ξαναπερνούσε την ποσότητα) και, ανά γραμμή, οι γραμμές
 * του δελτίου που καλύπτει. Βλ. `lib/ocr/delivery-note-convert.ts`.
 */
export interface ConversionSpec {
  series: number;
  links: Map<number, { findoc: number; mtrlines: number; qty1: number }[]>;
  /** Τα δελτία-πηγές — για τον έλεγχο μετά την καταχώριση. */
  findocs: number[];
}

function utilityTitleOf(document: DocumentJson): string | null {
  const input = utilityInputFromDocument(document);
  const u = input ? analyzeUtility(input) : null;
  return u ? UTILITY_KIND_TITLE[u.kind] : null;
}

async function gather(id: string, conv?: ConversionSpec): Promise<Gathered> {
  const doc = await prisma.ocrDocument.findUnique({
    where: { id },
    select: {
      id: true, status: true, category: true, softoneTrdr: true, softoneSeries: true,
      softoneName: true, seriesSource: true, postStatus: true, postedRef: true,
    },
  });
  if (!doc) throw new PostError('not_found', POST_ERROR_TEXT.not_found);

  const [document, items, vats, vatOverrides, seriesTarget, traderRow] = await Promise.all([
    loadDocumentJson(id),
    prisma.ocrInvoiceItem.findMany({
      where: { documentId: id },
      orderBy: { rowIndex: 'asc' },
      select: {
        rowIndex: true, softoneMtrl: true, softoneExpn: true, softoneLinMtrl: true, softoneAsset: true, softoneIsService: true,
        softoneCostCntr: true, softonePrjc: true, softonePrjcStage: true, softoneMatchedBy: true, total: true,
        // Ο επιμερισμός σε πολλούς λογαριασμούς — όταν υπάρχει, ΥΠΕΡΙΣΧΥΕΙ της μονής αντιστοίχισης.
        allocations: { orderBy: { order: 'asc' }, select: { registryMtrl: true, amount: true, percent: true, kind: true } },
      },
    }),
    // Η σειρά ΔΕΝ είναι διακοσμητική: δύο ενεργές εγγραφές με τον ίδιο συντελεστή (π.χ. κανονικό /
    // κανονικό νησιών) λύνονται από την πρώτη — άρα η ταξινόμηση πρέπει να είναι ρητή και σταθερή,
    // αλλιώς ο κωδικός ΦΠΑ που φεύγει προς το SoftOne αλλάζει με τη διάθεση του planner.
    prisma.vatCategory.findMany({
      where: { isActive: true },
      orderBy: [{ order: 'asc' }, { code: 'asc' }],
      select: { code: true, rate: true, descr: true },
    }),
    // Οι χειροκίνητες αντιστοιχίσεις συντελεστή → κωδικού ΦΠΑ (`lib/ocr/vat-map.ts`).
    getSetting<unknown>(VAT_RATE_MAP_SETTING, {}).catch(() => ({})),
    conv ? loadTarget(String(conv.series), 1251) : loadTarget(doc.softoneSeries, doc.seriesSource),
    // Ο ΤΥΠΟΣ του συναλλασσομένου (12/16) από τον τοπικό καθρέφτη: τον κρίνει ο έλεγχος
    // `trader_kind_mismatch`. `null` = δεν τον ξέρουμε, οπότε δεν κρίνουμε.
    doc.softoneTrdr
      ? prisma.softoneTrader.findUnique({ where: { trdr: doc.softoneTrdr }, select: { sodtype: true } })
      : Promise.resolve(null),
  ]);
  const target = seriesTarget.target;

  // Ο ΧΑΡΑΚΤΗΡΙΣΜΟΣ myDATA και το MTRTYPE της χρεοπίστωσης ζουν στα μητρώα, όχι στη γραμμή.
  // Τα διαβάζουμε μαζικά για όσους κωδικούς ταίριαξαν — μία ερώτηση ανά μητρώο, όχι ανά γραμμή.
  const mtrls = items.map((i) => i.softoneMtrl).filter((v): v is number => v != null);
  // ΚΑΙ οι χρεοπιστώσεις των επιμερισμών: το `MTRTYPE` τους το απαιτεί η γραμμή `LINLINES`
  // ακριβώς όπως και της μονής αντιστοίχισης. Χωρίς αυτό, μια επιμερισμένη γραμμή θα έφευγε με
  // `MTRTYPE 0` και το ERP θα την απέρριπτε — ή, χειρότερα, θα τη δεχόταν λάθος.
  const lins = [...new Set([
    ...items.map((i) => i.softoneLinMtrl).filter((v): v is number => v != null),
    ...items.flatMap((i) => (i.allocations ?? []).map((a) => a.registryMtrl)),
  ])];
  const expns = items.map((i) => i.softoneExpn).filter((v): v is number => v != null);
  const assetIds = items.map((i) => i.softoneAsset).filter((v): v is number => v != null);
  const [assetRows, assetWhouse] = assetIds.length
    ? await Promise.all([
        prisma.softoneAsset.findMany({ where: { mtrl: { in: assetIds } }, select: { mtrl: true, isActive: true } }),
        getSetting<unknown>('integrations.softoneAssetWhouse', null).then((v) => (Number.isFinite(Number(v)) && v != null ? Number(v) : null)).catch(() => null),
      ])
    : [[], null];
  const assetById = new Map(assetRows.map((r) => [r.mtrl, r]));
  const [itemRows, linRows, expenseRows] = await Promise.all([
    mtrls.length
      ? prisma.softoneItem.findMany({ where: { mtrl: { in: mtrls } }, select: { mtrl: true, myDataCode: true, unit1: true, unitBuy: true, buyRatio: true } })
      : Promise.resolve([]),
    lins.length
      ? prisma.softoneLineItem.findMany({
          where: { mtrl: { in: lins } },
          select: {
            mtrl: true, code: true, name: true, mtrType: true, classType: true, classCategory: true, myDataCode: true,
            acnmsk: true, acnmskSyncedAt: true, isActive: true,
          },
        })
      : Promise.resolve([]),
    expns.length
      ? prisma.softoneExpense.findMany({
          where: { expn: { in: expns } },
          select: { expn: true, classTypeX: true, classCategoryX: true, isActive: true },
        })
      : Promise.resolve([]),
  ]);
  const itemById = new Map(itemRows.map((r) => [r.mtrl, r]));
  // Οι μονάδες του μητρώου, για να καταλάβουμε σε ΠΟΙΑ μονάδα τυπώνει την ποσότητα το τιμολόγιο.
  const unitRows = itemRows.some((r) => hasBuyUnit(r))
    ? await prisma.softoneLookup.findMany({ where: { kind: 'MTRUNIT' }, select: { code: true, name: true } })
    : [];
  const linById = new Map(linRows.map((r) => [r.mtrl, r]));
  const expenseById = new Map(expenseRows.map((r) => [r.expn, r]));

  // Ο χάρτης «συντελεστής → κωδικός ΦΠΑ» χτίζεται από το μητρώο ΚΑΙ από τις χειροκίνητες
  // αντιστοιχίσεις. Χρειάζονται και τα δύο: οι **μηδενικές** κατηγορίες του SoftOne έρχονται με
  // κενό ποσοστό, οπότε χωρίς ρητή αντιστοίχιση κάθε γραμμή 0 % έπεφτε στο `no_vat_category` και
  // δεν υπήρχε τρόπος να λυθεί από πουθενά μέσα στην εφαρμογή (βλ. `lib/ocr/vat-map.ts`).
  const { byRate: vatIdByRate } = buildVatRateMap(
    vats.map((v) => ({ code: v.code, rate: v.rate == null ? null : Number(v.rate), descr: v.descr, isActive: true })),
    parseVatRateOverrides(vatOverrides),
  );

  const seriesCode = conv ? String(conv.series) : doc.softoneSeries;
  const seriesSource = conv ? 1251 : doc.seriesSource;
  const series = Number(seriesCode);
  const seriesOk = Number.isFinite(series) && series > 0;
  const lineCtx: PurdocLineCtx[] = items.map((i) => {
    const item = i.softoneMtrl != null ? itemById.get(i.softoneMtrl) : undefined;
    const lin = i.softoneLinMtrl != null ? linById.get(i.softoneLinMtrl) : undefined;
    const expense = i.softoneExpn != null ? expenseById.get(i.softoneExpn) : undefined;
    const myDataCode = item?.myDataCode ?? lin?.myDataCode ?? null;
    // «Αχαρακτήριστο» = το μητρώο στο οποίο ταίριαξε η γραμμή δεν κουβαλά ΚΑΝΕΝΑ στοιχείο
    // χαρακτηρισμού. Το κρίνουμε μόνο για γραμμές που όντως ταίριαξαν κάπου.
    const matched = item ?? lin ?? expense ?? (i.softoneAsset != null ? assetById.get(i.softoneAsset) : undefined);
    const hasClass = Boolean(
      myDataCode || lin?.classType || lin?.classCategory || expense?.classTypeX || expense?.classCategoryX,
    );
    // Μηδενική γραμμή που ο χρήστης παρέλειψε ρητά: δεν στέλνεται, δεν μπλοκάρει (βλ. `PurdocLineCtx.omit`).
    const omit = i.softoneMatchedBy === 'skipped' && !matched && (i.allocations ?? []).length === 0
      && Math.abs(Number(i.total ?? 0)) < 0.005;
    return {
      rowIndex: i.rowIndex,
      ...(omit ? { omit: true } : {}),
      mtrl: i.softoneMtrl,
      expn: i.softoneExpn,
      lin: i.softoneLinMtrl,
      asset: i.softoneAsset,
      linMtrType: lin?.mtrType ?? null,
      linLabel: lin ? `${lin.code} — ${lin.name}` : null,
      linAcnmsk: lin?.acnmsk ?? null,
      // Χρεοπίστωση που δεν βρέθηκε στον καθρέφτη, ή που δεν έχει ξανασυγχρονιστεί από τότε που
      // προστέθηκε το πεδίο: ο λογαριασμός της είναι ΑΓΝΩΣΤΟΣ, όχι κενός.
      linAcnmskKnown: Boolean(lin?.acnmskSyncedAt),
      // Ο επιμερισμός, εμπλουτισμένος με ό,τι ζητά η γραμμή `LINLINES` από το μητρώο.
      ...((i.allocations ?? []).length
        ? {
          allocations: (i.allocations ?? []).map((a) => {
            const reg = linById.get(a.registryMtrl);
            return {
              registryMtrl: a.registryMtrl,
              mtrType: reg?.mtrType ?? null,
              amount: Number(a.amount),
              percent: Number(a.percent),
              label: reg ? `${reg.code} — ${reg.name}` : null,
            };
          }),
        }
        : {}),
      // Ο ΦΠΑ από το ΙΔΙΟ σημείο που τον διαβάζει το payload (`document.lines[rowIndex]`).
      vatRate: vatRateOf(document.lines[i.rowIndex]?.vatRate),
      isService: i.softoneIsService,
      costCntr: i.softoneCostCntr,
      prjc: i.softonePrjc,
      prjcStage: i.softonePrjcStage,
      myDataCode,
      // Μονάδα αγορών: η γραμμή φεύγει ως QTY στη μονάδα αγορών (βλ. `purchaseQtyPrice`).
      ...(item ? (({ buyRatio, qtyInBase }) => ({ buyRatio, qtyInBase }))(decideLineUnits(item, document.lines[i.rowIndex], unitRows)) : {}),
      // Το πάγιο χαρακτηρίζεται από τη λογιστική του κατηγορία στο SoftOne — όχι παρατήρηση εδώ.
      noClassification: Boolean(matched) && !hasClass && i.softoneAsset == null,
      ...(conv?.links.get(i.rowIndex)?.length ? { sourceLinks: conv.links.get(i.rowIndex) } : {}),
    };
  });

  const ctx: PurdocContext = {
    target,
    series: seriesOk ? series : 0,
    trdr: doc.softoneTrdr ?? 0,
    lines: lineCtx,
    vatIdByRate,
    // ΤΙ ΑΦΟΡΑ — όχι το ελεύθερο κείμενο του χαρτιού (βλ. lib/ocr/posting-comment.ts).
    comments: postingComment(document, { utilityTitle: utilityTitleOf(document) }),
    assetWhouse,
  };

  // Ο έλεγχος λογαριασμού γενικής: μόνο όσο λογιστικό σχέδιο χρειάζεται για ΑΥΤΕΣ τις γραμμές.
  const accountInputs = accountCheckInputs(ctx);
  const chart = await loadAccountChart(
    accountInputs.filter((l) => l.path === 'LINLINES').map((l) => l.acnmsk),
  );
  const accounts = checkAccounts(accountInputs, chart);

  const blockers = postingBlockers(document, {
    status: doc.status,
    category: doc.category,
    softoneTrdr: doc.softoneTrdr,
    softoneSeries: seriesOk ? seriesCode : null,
    seriesSource,
    seriesKnown: seriesTarget.known,
    seriesEnabled: seriesTarget.enabled,
    traderSodtype: traderRow?.sodtype ?? null,
  }, ctx, accounts);

  // ΜΗΤΡΩΟ ΠΟΥ ΔΕΝ ΥΠΑΡΧΕΙ ΣΤΗΝ ΤΩΡΙΝΗ ΕΓΚΑΤΑΣΤΑΣΗ. Οι χρεοπιστώσεις και τα έξοδα συγχρονίζονται
  // ΟΛΟΚΛΗΡΑ και ό,τι λείπει από το ERP γίνεται `isActive: false` — δεν σβήνεται. Μετά από αλλαγή
  // λογαριασμού SoftOne, ο καθρέφτης κρατούσε 522 ανενεργές χρεοπιστώσεις της ΠΑΛΙΑΣ εγκατάστασης
  // και αυτός ο έλεγχος τις έβρισκε «κανονικά»: το energa θα έφευγε με MTRL 3214/2945 που δεν
  // υπάρχουν στο Demo S1. Ανενεργή ή απούσα ⇒ ΕΜΠΟΔΙΟ. (Τα ΕΙΔΗ δεν κρίνονται έτσι: ο καθρέφτης
  // τους είναι υποσύνολο, άρα η απουσία εκεί δεν αποδεικνύει τίποτα.)
  const foreign = items.some((i) =>
    (i.softoneLinMtrl != null && linById.get(i.softoneLinMtrl)?.isActive !== true)
    // Μόνο επιμερισμοί σε ΧΡΕΟΠΙΣΤΩΣΗ: οι SXACCOUNT δείχνουν σε λογαριασμούς εσόδων/εξόδων, άλλο μητρώο.
    || (i.allocations ?? []).some((a) => a.kind !== 'SXACCOUNT' && linById.get(a.registryMtrl)?.isActive !== true)
    || (i.softoneExpn != null && expenseById.get(i.softoneExpn)?.isActive !== true)
    || (i.softoneAsset != null && assetById.get(i.softoneAsset)?.isActive !== true));
  if (foreign && !blockers.includes('registry_not_in_installation')) blockers.push('registry_not_in_installation');

  return {
    doc, document, ctx, blockers,
    warnings: postingWarnings(ctx, accounts, document),
    payload: buildPurdocPayload(document, ctx),
    accounts,
  };
}

export type PostingPreview = {
  /** Ο διακόπτης `softone.postingEnabled`. */
  enabled: boolean;
  blockers: { code: BlockerCode; message: string }[];
  /** Παρατηρήσεις που δεν εμποδίζουν (π.χ. μητρώο χωρίς χαρακτηρισμό myDATA). */
  warnings: { code: WarningCode; message: string }[];
  /** Πού πάει: object + πίνακας γραμμών, με ελληνική περιγραφή και το «γιατί». */
  target: PostingTarget & { label: string };
  /** Τι ΘΑ σταλεί — υπάρχει και όταν υπάρχουν εμπόδια, για να φαίνεται τι λείπει. */
  payload: PostingPayload;
  /** Ο έλεγχος λογαριασμού γενικής ανά γραμμή: λογαριασμός, όνομα στο σχέδιο, κατάσταση. */
  accounts: AccountCheck;
  /** Σύνοψη για την κάρτα: ό,τι δεν διαβάζεται εύκολα από το raw payload. */
  summary: {
    series: string | null; trader: string | null; trdr: number | null; date: string | null;
    lines: number;
    /**
     * Η αναφορά του ΕΚΔΟΤΗ όπως θα γραφτεί, ΑΝΑ ΠΕΔΙΟ: η κάρτα το δείχνει με τις λεζάντες του
     * SoftOne, ώστε να φαίνεται ΠΟΥ πάει ο σαρωμένος αριθμός πριν ανοίξει ποτέ ο διακόπτης.
     */
    reference: { fincode: string | null; taxSeries: string | null; taxSeriesNum: string | null };
  };
  /** Τι λέει ήδη η βάση: ένα POSTED έγγραφο δεν ξανα-στέλνεται (το κουμπί κλειδώνει). */
  postStatus: string;
  postedRef: string | null;
};

/**
 * ΠΡΟΕΠΙΣΚΟΠΗΣΗ. Δεν καλεί SoftOne, δεν γράφει τίποτα — ούτε καν `postStatus`.
 * Ό,τι επιστρέφει εδώ είναι ακριβώς ό,τι θα έστελνε το `postDocumentToSoftone`.
 */
export async function postingPreview(id: string): Promise<PostingPreview> {
  const { doc, document, ctx, blockers, warnings, payload, accounts } = await gather(id);
  const enabled = (await getSetting<boolean>(POSTING_ENABLED_KEY)) === true;
  const ref = documentReference(document.type);
  return {
    enabled,
    blockers: blockers.map((code) => ({ code, message: blockerMessage(code, accounts) })),
    warnings: warnings.map((code) => ({ code, message: warningMessage(code, accounts) })),
    target: { ...ctx.target, label: describeTargetShort(ctx.target) },
    payload,
    accounts,
    summary: {
      series: doc.softoneSeries,
      trader: doc.softoneName,
      trdr: doc.softoneTrdr,
      date: document.date,
      lines: ctx.lines.length,
      reference: {
        fincode: ref.fincode ?? null,
        taxSeries: ref.taxSeries ?? null,
        taxSeriesNum: ref.taxSeriesNum ?? null,
      },
    },
    postStatus: doc.postStatus,
    postedRef: doc.postedRef,
  };
}

const sameRef = (a: unknown, b: unknown): boolean => {
  const x = normalizeDocRef(a);
  return x !== '' && x === normalizeDocRef(b);
};

/**
 * Το read-back βρήκε ΤΟ ΠΑΡΑΣΤΑΤΙΚΟ ΜΑΣ; Η αναφορά του εκδότη γράφεται σε δύο πεδία που μπορούμε
 * να ελέγξουμε, οπότε αρκεί να συμφωνήσει ΕΝΑ: το SoftOne μπορεί να ξαναγράψει το «Παραστατικό»
 * με τη μάσκα της σειράς (βλ. γραμμές 1009/1034 του πελάτη), αλλά όχι και τα δύο. Κενή απάντηση
 * ΔΕΝ περνά — το `sameRef` απαιτεί τιμή και στις δύο πλευρές.
 *
 * ΜΙΑ ΠΑΓΙΔΑ: όταν αφήσουμε κενό τον «Φορ/κό αριθμό», το SoftOne φαίνεται να τον γεμίζει από τον
 * ΔΙΚΟ ΜΑΣ αύξοντα — οι γραμμές 1009/1034 έχουν `TAXSERIESNUM="1"` με `SERIESNUM=1`. Άρα ένα
 * τιμολόγιο προμηθευτή με αριθμό «1», σε σειρά που δίνει `SERIESNUM=1`, θα «επιβεβαιωνόταν» ακόμη
 * κι αν το ERP είχε πετάξει ό,τι στείλαμε. Όταν ο «Φορ/κός αριθμός» ισούται με τον αύξοντα, δεν
 * τον δεχόμαστε ΜΟΝΟ του: θέλουμε και το «Παραστατικό» να συμφωνεί.
 */
const refConfirmed = (row: Record<string, unknown>, ref: DocReference, fallback: string | null): boolean => {
  const fincodeOk = sameRef(row.FINCODE, ref.fincode ?? fallback);
  const taxNumOk = sameRef(row.TAXSERIESNUM, ref.taxSeriesNum ?? fallback);
  const echoesSeriesNum = row.SERIESNUM != null && sameRef(row.TAXSERIESNUM, String(row.SERIESNUM));
  if (taxNumOk && echoesSeriesNum && !fincodeOk) return false;
  return fincodeOk || taxNumOk;
};

/**
 * Posts the document to SoftOne (setData on the series' own object — PURDOC, LINSUPDOC,
 * LINCREDOC or LINDEBDOC) and PROVES it landed by reading the record back:
 * SoftOne answers `success:true` even for writes it silently dropped, so the read-back is the only
 * evidence. Throws PostError for precondition failures (the runner turns those into BLOCKED);
 * a transport/verification failure marks the row FAILED and is rethrown as a plain Error.
 */
export interface PostOptions {
  syncTemplateRun?: boolean;
  /**
   * Η ανάρτηση είναι ΑΝΘΡΩΠΙΝΗ επιβεβαίωση της ανάγνωσης (το χειροκίνητο κουμπί «Ανάρτηση»).
   * ΠΡΟΕΠΙΛΟΓΗ `false`, και αυτό είναι το ασφαλές: ο εκτελεστής προτύπων (`lib/templates/run.ts`)
   * αναρτά ΜΟΝΟΣ ΤΟΥ σε AUTO πρότυπα χωρίς εμπόδια, σε έγγραφα που δεν άνοιξε ποτέ άνθρωπος. Αν
   * σφραγίζαμε κι εκείνα ως επιβεβαιωμένα, θα γίνονταν «παράδειγμα αναφοράς» για τον εκδότη τους
   * (`lib/ocr/example-lookup.ts`) και μια αυτόματη λάθος ανάγνωση θα δίδασκε τον εαυτό της.
   */
  verified?: boolean;
  /** Ποιος επιβεβαίωσε (μόνο όταν `verified`). */
  verifiedById?: string | null;
  /** Μετασχηματισμός από δελτίο αποστολής (σειρά-στόχος + σύνδεση γραμμών). */
  conversion?: ConversionSpec;
}

/** Ό,τι θα έστελνε η καταχώριση — με ή χωρίς μετασχηματισμό — για τον έλεγχο του δελτίου. ΔΕΝ γράφει τίποτα. */
export async function gatherForConversion(id: string, conv?: ConversionSpec) {
  return gather(id, conv);
}

/**
 * ΔΟΚΙΜΗ ΧΩΡΙΣ ΑΠΟΘΗΚΕΥΣΗ (`calculate`) του τιμολογίου από δελτίο: η SoftOne πρέπει να δεχτεί το
 * payload, να ΚΡΑΤΗΣΕΙ τη σύνδεση σε κάθε γραμμή και να βγάλει το ίδιο σύνολο με το χαρτί.
 * Επιστρέφει μήνυμα αποτυχίας ή `null`.
 */
export async function conversionCalculateCheck(payload: PostingPayload, documentTotal: number | null): Promise<{ error: string | null; total: number | null }> {
  const res = await softoneCall<{ success?: boolean; error?: string; data?: Record<string, Record<string, unknown>[]> }>('calculate', {
    ...payload,
    LOCATEINFO: `${payload.OBJECT}:SUMAMNT;ITELINES:LINENUM,MTRL,FINDOCS,MTRLINESS`,
  });
  if (res.success === false) return { error: softoneErrorLine(res.error ?? 'άγνωστο σφάλμα', payload), total: null };
  const sent = (payload.DATA.ITELINES ?? []) as { FINDOCS?: number }[];
  const back = (res.data?.ITELINES ?? []) as Record<string, unknown>[];
  const linkedSent = sent.filter((l) => l.FINDOCS != null).length;
  const linkedBack = back.filter((l) => Number(l.FINDOCS) > 0 && Number(l.MTRLINESS) > 0).length;
  if (linkedBack < linkedSent) {
    return { error: `Η SoftOne δεν κράτησε τη σύνδεση με το δελτίο σε ${linkedSent - linkedBack} από ${linkedSent} γραμμές — ο μετασχηματισμός σταμάτησε πριν γραφτεί οτιδήποτε.`, total: null };
  }
  const head = res.data?.[payload.OBJECT]?.[0];
  const total = head?.SUMAMNT == null ? null : Number(String(head.SUMAMNT).replace(',', '.'));
  if (documentTotal != null && total != null && Number.isFinite(total) && Math.abs(total - documentTotal) > 0.02) {
    return {
      error: `Το σύνολο της SoftOne (${total.toFixed(2)} €) διαφέρει από το σύνολο του τιμολογίου (${documentTotal.toFixed(2)} €) — έλεγξε γραμμές, ΦΠΑ και εκπτώσεις πριν τον μετασχηματισμό.`,
      total,
    };
  }
  return { error: null, total };
}

const eurText = (v: number) => `${v.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

/** Η καθαρή αξία που ΠΡΕΠΕΙ να βγάλει η SoftOne: το άθροισμα των γραμμών που στέλνουμε. */
export function expectedNetOf(document: DocumentJson): number {
  return round2(document.lines.reduce((t, l) => t + (Number(l.net) || 0), 0));
}

/**
 * ΔΙΧΤΥ ΑΣΦΑΛΕΙΑΣ ΣΕ ΚΑΘΕ ΚΑΤΑΧΩΡΙΣΗ: `calculate` (δεν αποθηκεύει) πριν από το `setData`, και η
 * καθαρή αξία της SoftOne πρέπει να είναι αυτή των γραμμών μας.
 *
 * Γιατί: οι ειδικές συναλλαγές στέλνονταν χωρίς `LINEVAL`, η SoftOne τις δεχόταν με `success:true`
 * — και τις έγραφε με ΜΗΔΕΝ (ΕΥΔΑΠ 115601, ΗΡΩΝ 115571). Το read-back έλεγχε μόνο αριθμό και
 * συναλλασσόμενο, οπότε κανείς δεν το είδε. Ό,τι κι αν αλλάξει στο μέλλον στο payload, ένα ποσό που
 * η SoftOne δεν θα κρατήσει σταματά ΕΔΩ, πριν γραφτεί οτιδήποτε.
 *
 * Τα «Έξοδα» αγορών (EXPANAL) προστίθενται στη SoftOne έξω από την καθαρή αξία των ειδών, οπότε σε
 * παραστατικό με τέτοιες γραμμές ελέγχεται μόνο το «όχι μηδέν». `null` = εντάξει ή δεν κρίνεται.
 */
export async function amountsPreflight(payload: PostingPayload, expected: number): Promise<string | null> {
  const res = await softoneCall<{ success?: boolean; error?: string; data?: Record<string, Record<string, unknown>[]> }>('calculate', {
    ...payload,
    LOCATEINFO: `${payload.OBJECT}:NETAMNT,SUMAMNT`,
  });
  if (res.success === false) return softoneErrorLine(res.error ?? 'άγνωστο σφάλμα', payload);
  const head = res.data?.[payload.OBJECT]?.[0];
  const net = Number(String(head?.NETAMNT ?? '').replace(',', '.'));
  if (!head || !Number.isFinite(net)) return null;
  const hasExpenses = ((payload.DATA as Record<string, unknown[] | undefined>).EXPANAL ?? []).length > 0;
  if (Math.abs(expected) > 0.5 && Math.abs(net) < 0.005) {
    return `Η SoftOne θα κατέγραφε το παραστατικό με ΜΗΔΕΝΙΚΗ αξία, ενώ οι γραμμές του είναι ${eurText(expected)} — δεν γράφτηκε τίποτα. Στείλε το στον τεχνικό (πιθανό πρόβλημα στη μορφή των γραμμών).`;
  }
  if (!hasExpenses && Math.abs(net - expected) > Math.max(0.1, Math.abs(expected) * 0.002)) {
    return `Η SoftOne υπολογίζει καθαρή αξία ${eurText(net)}, ενώ οι γραμμές του παραστατικού είναι ${eurText(expected)} — δεν γράφτηκε τίποτα. Έλεγξε ποσότητες, τιμές και μονάδες των γραμμών.`;
  }
  return null;
}

/** Ο έλεγχος διπλού του «Καταχώριση» (πριν από το παράθυρο επιβεβαίωσης) θεωρείται φρέσκος για τόσο. */
const FRESH_DUPLICATE_CHECK_MS = 5 * 60_000;

/**
 * Χρόνος ανά βήμα της καταχώρισης. «Τεράστια καθυστέρηση» χωρίς μέτρηση δεν διορθώνεται: εδώ φαίνεται
 * αν φταίει η SoftOne (setData / read-back) ή η εφαρμογή (gather), στο log του server και στο UI.
 */
export type PostTimings = Record<string, number> & { total: number };
function stepTimer() {
  const t0 = Date.now();
  let last = t0;
  const steps: Record<string, number> = {};
  return {
    mark(step: string) { const now = Date.now(); steps[step] = now - last; last = now; },
    done(): PostTimings { return { ...steps, total: Date.now() - t0 }; },
  };
}

export async function postDocumentToSoftone(id: string, opts: PostOptions = {}): Promise<{ ref: string; warning?: string; timings: PostTimings }> {
  const timer = stepTimer();
  try {
    const out = await postDocument(id, opts, timer.mark);
    const timings = timer.done();
    console.info(`[post] ${id} → ${out.ref} σε ${timings.total}ms`, JSON.stringify(timings));
    return { ...out, timings };
  } catch (e) {
    const timings = timer.done();
    if (timings.total > 3_000) console.warn(`[post] ${id} απέτυχε μετά από ${timings.total}ms`, JSON.stringify(timings));
    throw e;
  }
}

async function postDocument(id: string, opts: PostOptions, mark: (step: string) => void): Promise<{ ref: string; warning?: string }> {
  const { doc, document, ctx, blockers, payload, accounts } = await gather(id, opts.conversion);
  mark('gather');
  // ΙΔΕΜΠΟΤΗΤΑ, πρώτο απ' όλα: ένα δεύτερο κλικ (ή μια δεύτερη εκτέλεση προτύπου) δεν δημιουργεί
  // δεύτερο παραστατικό στο SoftOne. Πριν από κάθε έλεγχο εμποδίων — ένα ήδη καταχωρισμένο
  // παραστατικό δεν είναι «μπλοκαρισμένο», είναι τελειωμένο.
  if (doc.postStatus === 'POSTED') {
    throw new PostError('already_posted', alreadyPostedText(doc.postedRef));
  }
  if (blockers.length) {
    throw new PostError(blockers[0], blockers.map((c) => blockerMessage(c, accounts)).join(' · '));
  }
  const [enabled, lastCheck] = await Promise.all([
    getSetting<boolean>(POSTING_ENABLED_KEY),
    prisma.ocrDocument.findUnique({ where: { id }, select: { softoneTrdr: true, softoneDocExists: true, softoneDocChecked: true } }),
  ]);
  if (enabled !== true) {
    // Σκόπιμα ΠΡΙΝ από οποιαδήποτε εγγραφή: ένα κλειστό σύστημα δεν αλλάζει καν `postStatus`.
    throw new PostError('posting_disabled', POST_ERROR_TEXT.posting_disabled);
  }
  // ΤΟ ΙΔΙΟ ΧΑΡΤΙ ΔΕΝ ΚΑΤΑΧΩΡΙΖΕΤΑΙ ΔΥΟ ΦΟΡΕΣ — με ΑΦΜ + αριθμό, όχι με καρτέλα (βλ. duplicate-post.ts).
  // Η καρτέλα που μόλις βρέθηκε καθαρή στο παράθυρο επιβεβαίωσης δεν ξαναρωτιέται· οι άλλες ναι.
  const freshClear = lastCheck?.softoneDocExists === false && lastCheck.softoneTrdr === ctx.trdr
    && lastCheck.softoneDocChecked != null && Date.now() - lastCheck.softoneDocChecked.getTime() < FRESH_DUPLICATE_CHECK_MS;
  const dup = await findDuplicatePosting({
    id, afm: document.issuer.vat, type: document.type, date: document.date,
    skipSoftoneTrdr: freshClear ? ctx.trdr : null,
  });
  mark('duplicates');
  if (dup) {
    throw new PostError('duplicate', dup.where === 'app'
      ? `${POST_ERROR_TEXT.duplicate} από το «${dup.fileName ?? 'άλλο αρχείο'}»${dup.ref ? ` (SoftOne ${dup.ref})` : ''}. Αν είναι διπλό ανέβασμα, διάγραψέ το.`
      : `${POST_ERROR_TEXT.duplicate} στο SoftOne${dup.ref ? ` (${dup.ref})` : ''} — πιθανώς σε άλλη καρτέλα του ίδιου προμηθευτή.`);
  }

  // Από δελτίο: πρώτα δοκιμή χωρίς αποθήκευση — αν η SoftOne δεν κρατά τη σύνδεση ή το σύνολο
  // διαφέρει, ΤΙΠΟΤΑ δεν γράφεται (ούτε καν `postStatus`).
  if (opts.conversion) {
    const check = await conversionCalculateCheck(payload, document.totals?.total ?? null);
    mark('calculate');
    if (check.error) throw new PostError('conversion_check', check.error);
  } else {
    // Σε ΚΑΘΕ καταχώριση: η SoftOne πρέπει να βγάζει το ίδιο ποσό με τις γραμμές, πριν γραφτεί κάτι.
    const problem = await amountsPreflight(payload, expectedNetOf(document));
    mark('calculate');
    if (problem) throw new PostError('amounts_check', problem);
  }

  // ΚΛΕΙΔΩΜΑ, ατομικά: δύο ταυτόχρονα κλικ (ή κλικ + εκτελεστής προτύπων) δεν περνούν και τα δύο.
  // Πριν, το `PENDING` γραφόταν χωρίς όρο — και τα δύο αιτήματα θα έφταναν στο `setData`.
  const claimed = await prisma.ocrDocument.updateMany({
    where: { id, postStatus: { notIn: ['PENDING', 'POSTED'] } },
    data: { postStatus: 'PENDING' },
  });
  if (claimed.count === 0) {
    throw new PostError('already_posted', 'Η καταχώριση αυτού του παραστατικού είναι ήδη σε εξέλιξη ή έχει ολοκληρωθεί — ανανέωσε τη σελίδα.');
  }
  const audit = (ok: boolean, extra: Record<string, unknown>) => logAudit({
    userId: opts.verifiedById ?? null, action: 'ocr.post', resource: 'ocr_document', resourceId: id,
    // Το ΑΚΡΙΒΕΣ payload που στάλθηκε: αν κάτι γραφτεί στραβά, φαίνεται τι ακριβώς ζητήσαμε.
    metadata: { ok, object: ctx.target.object, series: ctx.series, trdr: ctx.trdr, payload, ...extra },
  }).catch(() => null);
  /** Το `setData` έφυγε αλλά δεν ξέρουμε αν η SoftOne το εκτέλεσε (διακοπή / χρονικό όριο). */
  let inFlight = false;
  try {
    const object = ctx.target.object;
    inFlight = true;
    const res = await softoneCall<{ success?: boolean; error?: string; errorcode?: number; id?: string | number }>('setData', payload);
    inFlight = false;
    mark('setData');
    // ΚΑΘΑΡΗ αποτυχία: το SoftOne είπε «όχι». Τίποτα δεν δημιουργήθηκε.
    if (res.success === false) {
      // ΣΕ ΓΛΩΣΣΑ ΧΡΗΣΤΗ: «SoftOne Range Error (Name: '')» δεν λέει τίποτα σε κανέναν.
      throw new Error(softoneErrorLine(res.error ?? `setData ${object} απέτυχε (code ${res.errorcode ?? '?'})`, payload));
    }
    // ΑΓΝΩΣΤΗ έκβαση: `success` χωρίς `id`. Μπορεί κάλλιστα να έχει δημιουργηθεί παραστατικό που
    // δεν ξέρουμε να ονομάσουμε — αν το γράψουμε «απέτυχε» και σκέτο, κάποιος θα το ξαναστείλει
    // και θα γίνουν δύο. Κρατάμε ό,τι απάντησε το ERP στο μήνυμα και το λέμε ρητά.
    if (res.id == null) {
      await prisma.ocrDocument.update({
        where: { id },
        data: {
          postStatus: 'FAILED',
          postError: `ΑΓΝΩΣΤΗ ΕΚΒΑΣΗ: το SoftOne απάντησε επιτυχία ΧΩΡΙΣ αριθμό παραστατικού για ${object}. `
            + 'ΜΗΝ ξανακαταχωρίσεις πριν ελέγξεις στο ERP αν δημιουργήθηκε. '
            + `Απάντηση: ${JSON.stringify(res).slice(0, 800)}`,
        },
      });
      throw new Error(
        `Η καταχώριση ${object} είχε άγνωστη έκβαση: επιτυχία χωρίς αριθμό παραστατικού. `
        + 'Έλεγξε στο SoftOne αν δημιουργήθηκε πριν ξαναπροσπαθήσεις.',
      );
    }
    const ref = String(res.id);
    // Το παραστατικό ΥΠΑΡΧΕΙ πλέον στο SoftOne. Το `postedRef` αποθηκεύεται ΑΜΕΣΩΣ, πριν από την
    // επαλήθευση: αν το read-back σκάσει (δίκτυο, δικαιώματα, αργό ERP) η εγγραφή θα γίνει FAILED
    // — αλλά με τον αριθμό της στο χέρι, ώστε ένας άνθρωπος να τη βρει αντί να την ξαναστείλει.
    await prisma.ocrDocument.update({ where: { id }, data: { postedRef: ref } });

    // Η επαλήθευση διαβάζει ΤΟ ΙΔΙΟ object που γράφτηκε — αλλιώς «επιβεβαιώνει» άλλο παραστατικό.
    const tables = await softoneGetData(object, ref);
    mark('readBack');
    // ΜΟΝΟ η κεφαλίδα του object μετράει. Ένα «πάρε ό,τι βρεις» θα μπορούσε να πιάσει `MTRDOC` ή
    // κάποιον πίνακα γραμμών, που δεν έχει FINCODE/TRDR — και θα «επιβεβαίωνε» με undefined.
    const row = tables[object]?.[0];
    if (!row) {
      throw new Error(
        `Η καταχώριση δεν επιβεβαιώθηκε: το SoftOne δεν επέστρεψε κεφαλίδα ${object} για το παραστατικό ${ref}`,
      );
    }
    const sent = documentReference(document.type);
    if (!refConfirmed(row, sent, document.type.number) || Number(row.TRDR) !== ctx.trdr) {
      throw new Error(
        `Η καταχώριση δεν επιβεβαιώθηκε: το παραστατικό ${ref} στο SoftOne έχει «Παραστατικό» «${row.FINCODE ?? '—'}», `
        + `«Φορ/κό αριθμό» «${row.TAXSERIESNUM ?? '—'}» και συναλλασσόμενο ${row.TRDR ?? '—'}, `
        + `αντί για «${sent.fincode ?? '—'}» / «${sent.taxSeriesNum ?? '—'}» / ${ctx.trdr}`,
      );
    }

    // ΤΟ ΠΟΣΟ ΠΟΥ ΓΡΑΦΤΗΚΕ: το παραστατικό ΥΠΑΡΧΕΙ ήδη, οπότε διαφορά εδώ = δυνατή προειδοποίηση
    // (όχι FAILED — θα ξαναστελνόταν διπλό). Ο έλεγχος πριν το setData πρέπει να το έχει πιάσει ήδη.
    const savedNet = Number(String(row.NETAMNT ?? '').replace(',', '.'));
    const expectedNet = expectedNetOf(document);
    const warnings: string[] = [];
    const hasExpenses = (payload.DATA.EXPANAL ?? []).length > 0;
    if (row.NETAMNT != null && Number.isFinite(savedNet)) {
      if (Math.abs(expectedNet) > 0.5 && Math.abs(savedNet) < 0.005) {
        warnings.push(`ΠΟΣΑ: το παραστατικό ${ref} γράφτηκε στη SoftOne με ΜΗΔΕΝΙΚΗ καθαρή αξία αντί για ${eurText(expectedNet)}. Διόρθωσέ το στη SoftOne — ΜΗΝ το ξανακαταχωρίσεις.`);
      } else if (!hasExpenses && Math.abs(savedNet - expectedNet) > Math.max(0.1, Math.abs(expectedNet) * 0.002)) {
        warnings.push(`ΠΟΣΑ: η SoftOne κράτησε καθαρή αξία ${eurText(savedNet)} αντί για ${eurText(expectedNet)} στο ${ref}. Έλεγξέ το στη SoftOne — ΜΗΝ το ξανακαταχωρίσεις.`);
      }
    }
    // ΦΠΑ: η SoftOne τον υπολογίζει ανά γραμμή (στρογγυλοποίηση ανά γραμμή) — μικρή απόκλιση από το
    // τυπωμένο είναι φυσιολογική· μεγαλύτερη σημαίνει λάθος κωδικό ΦΠΑ σε κάποια γραμμή.
    const savedVat = Number(String(row.VATAMNT ?? '').replace(',', '.'));
    const printedVat = document.totals?.vatAmount;
    if (row.VATAMNT != null && Number.isFinite(savedVat) && printedVat != null
      && Math.abs(savedVat - printedVat) > Math.max(0.1, 0.02 * document.lines.length)) {
      warnings.push(`ΦΠΑ: η SoftOne υπολόγισε ${eurText(savedVat)} ενώ το παραστατικό γράφει ${eurText(printedVat)} (${ref}). Έλεγξε τους συντελεστές ΦΠΑ των γραμμών στη SoftOne.`);
    }
    const amountWarning = warnings.length ? warnings.join(' ') : undefined;

    // ΠΑΓΙΑ: η γραμμή ASSLINES φεύγει με «Αγορά/Προσθήκη» = 0, με την υπόθεση ότι το SoftOne
    // δημιουργεί μόνο του την εγγραφή απόκτησης όπως στο πρότυπο 105283. Το επαληθεύουμε εδώ. Το
    // παραστατικό ΥΠΑΡΧΕΙ ήδη, οπότε δεν γίνεται FAILED (θα ξαναστελνόταν διπλό): μένει POSTED με
    // δυνατή σημείωση για τον χρήστη και τον integrator.
    const sentAssets = payload.DATA.ASSLINES?.length ?? 0;
    let warning: string | undefined = amountWarning;
    // ΜΕΤΑΣΧΗΜΑΤΙΣΜΟΣ: κάθε γραμμή που στάλθηκε με δελτίο-πηγή πρέπει να γυρίσει με αυτό, και τα
    // δελτία να έχουν πλέον μετασχηματιστεί. Το τιμολόγιο ΥΠΑΡΧΕΙ ήδη: αποτυχία εδώ = προειδοποίηση.
    if (opts.conversion) {
      const sentLinked = ((payload.DATA.ITELINES ?? []) as { FINDOCS?: number }[]).filter((l) => l.FINDOCS != null).length;
      const back = (tables.ITELINES ?? []) as Record<string, unknown>[];
      const backLinked = back.filter((l) => Number(l.FINDOCS) > 0).length;
      const state = await fetchNoteState(opts.conversion.findocs).catch(() => null);
      mark('noteState');
      const open = state ? state.filter((x) => x.transformed === 0).map((x) => x.findoc) : null;
      if (backLinked < sentLinked || open == null || open.length) {
        warning = (warning ? `${warning} ` : '') + `ΜΕΤΑΣΧΗΜΑΤΙΣΜΟΣ: το τιμολόγιο ${ref} καταχωρίστηκε, αλλά `
          + (backLinked < sentLinked ? `μόνο ${backLinked} από ${sentLinked} γραμμές δείχνουν στο δελτίο` : '')
          + (backLinked < sentLinked && (open == null || open.length) ? ' και ' : '')
          + (open == null ? 'η κατάσταση των δελτίων δεν διαβάστηκε' : open.length ? `τα δελτία ${open.join(', ')} εμφανίζονται ακόμη ανοιχτά` : '')
          + '. Έλεγξε τα «Σχετικά παραστατικά» στη SoftOne — ΜΗΝ ξανακαταχωρίσεις.';
      }
    }
    if (sentAssets > 0) {
      const back = (tables.ASSLINES ?? []) as Record<string, unknown>[];
      const linked = back.filter((l) => Number(l.ASSDEPR) > 0).length;
      const created = (tables.ASSDEPR ?? []).length;
      if (back.length < sentAssets || linked < sentAssets || created < sentAssets) {
        warning = (warning ? `${warning} ` : '') + `ΠΑΓΙΑ: το παραστατικό ${ref} καταχωρίστηκε, αλλά από ${sentAssets} γραμμές παγίων `
          + `${linked} συνδέθηκαν με εγγραφή απόκτησης («Αγορά/Προσθήκη») και ${created} εγγραφές απόκτησης δημιουργήθηκαν. `
          + 'Έλεγξε το παραστατικό στο SoftOne και συμπλήρωσε την «Αγορά/Προσθήκη» χειροκίνητα.';
      }
    }

    await prisma.ocrDocument.update({
      where: { id },
      data: {
        postStatus: 'POSTED', postedAt: new Date(), postedRef: ref, postError: warning ?? null,
        // ΜΟΝΟ χειροκίνητη ανάρτηση επιβεβαιώνει την ανάγνωση: κάποιος κοίταξε το παραστατικό και
        // το δέχτηκε ως λογιστικό γεγονός. Η αυτόματη ανάρτηση ενός AUTO προτύπου δεν είναι
        // επιβεβαίωση κανενός — βλ. `PostOptions.verified`.
        ...(opts.verified ? { verifiedAt: new Date(), verifiedById: opts.verifiedById ?? null } : {}),
      },
    });
    await audit(true, { ref, warning: warning ?? null, savedNet: Number.isFinite(savedNet) ? savedNet : null, expectedNet });
    if (opts.syncTemplateRun) {
      await markLatestRunPosted(id).catch((e) => console.error('[ocr] run status not synced after post', doc.id, (e as Error).message));
    }
    return warning ? { ref, warning } : { ref };
  } catch (err) {
    // ΑΓΝΩΣΤΗ ΕΚΒΑΣΗ: το `setData` έφυγε και η απάντηση χάθηκε (χρονικό όριο / διακοπή). Η SoftOne μπορεί
    // να το έχει γράψει. Δεν ξαναστέλνεται ποτέ αυτόματα· ο χρήστης ελέγχει πρώτα — και ο έλεγχος
    // διπλού της επόμενης προσπάθειας θα το βρει, αν γράφτηκε.
    const unknown = inFlight && err instanceof SoftoneTransportError && err.phase !== 'not_sent';
    const message = unknown
      ? `ΑΓΝΩΣΤΗ ΕΚΒΑΣΗ: η SoftOne δεν απάντησε στην καταχώριση και ίσως την έχει κάνει. ΜΗΝ ξανακαταχωρίσεις πριν το ελέγξεις στη SoftOne (αριθμός ${documentReference(document.type).taxSeriesNum ?? document.type.number ?? '—'}). (${String((err as Error)?.message ?? err)})`
      : String((err as Error)?.message ?? err);
    await prisma.ocrDocument.update({
      where: { id },
      data: { postStatus: 'FAILED', postError: message.slice(0, 2000) },
    });
    await audit(false, { error: message.slice(0, 500), unknownOutcome: unknown });
    throw unknown ? new Error(message) : err;
  }
}

/** Οι πίνακες γραμμών ενός καταχωρισμένου παραστατικού — μετριούνται πριν και μετά από μια ενημέρωση κεφαλίδας. */
const LINE_TABLES = ['ITELINES', 'SRVLINES', 'EXPANAL', 'LINLINES', 'ASSLINES', 'ASSDEPR'] as const;
const lineCount = (tables: Record<string, unknown[]>) =>
  Object.fromEntries(LINE_TABLES.map((t) => [t, (tables[t] ?? []).length])) as Record<(typeof LINE_TABLES)[number], number>;

export interface MarkSyncResult {
  ref: string;
  mark: string;
  /** `false` = ο ΜΑΡΚ ήταν ήδη σωστός στο SoftOne — δεν στάλθηκε τίποτα. */
  changed: boolean;
}

/**
 * Γράφει τον ΜΑΡΚ σε παραστατικό που έχει ΗΔΗ καταχωριστεί — για όσα καταχωρίστηκαν πριν η
 * εφαρμογή μάθει το σωστό πεδίο (`SomyDataMARK`· το `MYDATAMARK` είναι υπολογιζόμενο και αγνοείται).
 *
 * Στέλνει ΜΟΝΟ την κεφαλίδα με ΕΝΑ πεδίο: πίνακας που δεν στέλνεται δεν αγγίζεται από το setData.
 * Επειδή όμως μια λάθος υπόθεση εδώ θα έσβηνε γραμμές καταχωρισμένου παραστατικού, ο κανόνας
 * ελέγχεται κάθε φορά: πριν και μετά διαβάζονται οι γραμμές και ο συναλλασσόμενος, και κάθε
 * διαφορά σταματά με δυνατό μήνυμα.
 */
export async function syncPostedMark(id: string): Promise<MarkSyncResult> {
  const doc = await prisma.ocrDocument.findUnique({
    where: { id },
    select: { postStatus: true, postedRef: true, softoneSeries: true, seriesSource: true },
  });
  if (!doc) throw new PostError('not_found', POST_ERROR_TEXT.not_found);
  if (doc.postStatus !== 'POSTED' || !doc.postedRef) {
    throw new Error('Το παραστατικό δεν έχει καταχωριστεί στο SoftOne — ο ΜΑΡΚ θα σταλεί με την καταχώριση.');
  }
  if ((await getSetting<boolean>(POSTING_ENABLED_KEY)) !== true) {
    throw new PostError('posting_disabled', POST_ERROR_TEXT.posting_disabled);
  }
  const document = await loadDocumentJson(id);
  const mark = String(document?.digital?.mark ?? '').trim();
  if (!mark) throw new Error('Το παραστατικό δεν έχει ΜΑΡΚ στην ανάγνωση — συμπλήρωσέ τον πρώτα.');

  const { target } = await loadTarget(doc.softoneSeries, doc.seriesSource);
  if (!target.supported) throw new Error('Άγνωστο object καταχώρισης για τη σειρά του παραστατικού.');
  const object = target.object;
  const ref = doc.postedRef;

  const before = await softoneGetData(object, ref);
  const head = before[object]?.[0];
  if (!head) throw new Error(`Το παραστατικό ${ref} δεν βρέθηκε στο SoftOne (${object}).`);
  if (String(head.SomyDataMARK ?? '').trim() === mark) return { ref, mark, changed: false };

  const res = await softoneCall<{ success?: boolean; error?: string; errorcode?: number }>('setData', {
    OBJECT: object, KEY: ref, DATA: { [object]: [{ SomyDataMARK: mark }] },
  });
  if (res.success === false) throw new Error(res.error ?? `setData ${object} ${ref} απέτυχε (code ${res.errorcode ?? '?'})`);

  const after = await softoneGetData(object, ref);
  const headAfter = after[object]?.[0];
  const lb = lineCount(before), la = lineCount(after);
  const changedLines = LINE_TABLES.filter((t) => lb[t] !== la[t]);
  if (changedLines.length || String(headAfter?.TRDR) !== String(head.TRDR)) {
    throw new Error(
      `ΠΡΟΣΟΧΗ: μετά την ενημέρωση ΜΑΡΚ το παραστατικό ${ref} άλλαξε (${changedLines.map((t) => `${t} ${lb[t]}→${la[t]}`).join(', ') || 'συναλλασσόμενος'}). `
      + 'Έλεγξέ το αμέσως στο SoftOne.',
    );
  }
  if (String(headAfter?.SomyDataMARK ?? '').trim() !== mark) {
    // Επαληθευμένο στο Demo S1 (2026-10-12): το setData απαντά επιτυχία αλλά το πεδίο μένει κενό —
    // τον ΜΑΡΚ αγορών τον γράφει μόνο η ενότητα myDATA του ίδιου του SoftOne.
    throw new Error(
      `Το SoftOne απάντησε επιτυχία αλλά δεν κράτησε τον ΜΑΡΚ στο ${ref}: σε αυτή την εγκατάσταση ο ΜΑΡΚ αγορών `
      + `δεν γράφεται από τα web services. Συμπλήρωσέ τον στο SoftOne (${mark}). Το παραστατικό δεν άλλαξε.`,
    );
  }
  return { ref, mark, changed: true };
}

