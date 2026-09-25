// lib/ocr/post-softone.ts — SERVER. One place for "post this document to SoftOne" (route + template runner).
import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getSetting } from '@/lib/settings';
import { softoneCall, softoneGetData } from '@/lib/softone';
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

/** Αριθμός ή `null` — ο ΦΠΑ μιας γραμμής όπως τον κρατά το κανονικό έγγραφο. */
const vatRateOf = (v: unknown): number | null => {
  const n = v == null || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Ο διακόπτης ασφαλείας. Κλειστός = καμία εγγραφή δεν φεύγει προς το SoftOne (μόνο dry-run). */
export const POSTING_ENABLED_KEY = 'softone.postingEnabled';

export type PostErrorCode = 'not_found' | 'posting_disabled' | 'already_posted' | BlockerCode;

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
  not_found: 'Το έγγραφο δεν βρέθηκε',
  not_completed: 'Το έγγραφο δεν έχει ολοκληρωθεί',
  no_category: 'Δεν έχει οριστεί κατηγορία εγγράφου',
  line_discount_ambiguous: 'Υπάρχει γραμμή με έκπτωση που δεν συμφωνεί με το σύνολό της — δεν μπορεί να κριθεί αν είναι ποσοστό ή ποσό, και λάθος ερμηνεία γράφει λάθος ποσό στο SoftOne',
  // Τρία μηνύματα για τρεις καταστάσεις: η δουλειά που πρέπει να γίνει είναι ΑΛΛΗ σε κάθε μία.
  no_trader: 'Ο ΑΦΜ του εκδότη διαβάστηκε, αλλά δεν υπάρχει καρτέλα με αυτόν στο SoftOne — φτιάξε την από «Νέοι συναλλασσόμενοι»',
  no_trader_afm_missing: 'Το παραστατικό δεν έχει ΑΦΜ εκδότη — χωρίς αυτόν δεν μπορεί να βρεθεί ούτε να δημιουργηθεί καρτέλα· συμπλήρωσέ τον στα πεδία του εκδότη',
  no_trader_afm_invalid: 'Ο ΑΦΜ που διαβάστηκε δεν είναι έγκυρος (δεν περνά τον έλεγχο της ΑΑΔΕ και δεν έχει πρόθεμα χώρας) — διόρθωσέ τον στα πεδία του εκδότη',
  no_series: 'Δεν έχει επιλεγεί σειρά παραστατικού',
  no_date: 'Λείπει η ημερομηνία του παραστατικού',
  no_number: 'Λείπει ο αριθμός του παραστατικού',
  no_lines: 'Το έγγραφο δεν έχει γραμμές',
  unmatched_lines: 'Υπάρχουν γραμμές χωρίς αντιστοίχιση σε είδος ή έξοδο',
  no_vat_category: 'Συντελεστής ΦΠΑ γραμμής χωρίς κωδικό στο μητρώο ΦΠΑ',
  totals_mismatch: 'Το άθροισμα των γραμμών δεν συμφωνεί με την καθαρή αξία',
  lines_need_mtrl: 'Ο πίνακας γραμμών της σειράς δέχεται μόνο είδη ή υπηρεσίες — υπάρχει γραμμή αντιστοιχισμένη σε έξοδο ή χρεοπίστωση',
  lines_need_expn: 'Ο πίνακας «Έξοδα» (EXPANAL) δέχεται μόνο έξοδα — υπάρχει γραμμή αντιστοιχισμένη σε είδος, υπηρεσία ή χρεοπίστωση',
  lines_need_lineitem: 'Οι «Ειδικές συναλλαγές» (LINLINES) δέχονται μόνο ΧΡΕΟΠΙΣΤΩΣΕΙΣ — υπάρχει γραμμή αντιστοιχισμένη σε είδος, υπηρεσία ή έξοδο',
  lines_lineitem_unsupported: 'Η σειρά καταχωρεί σε παραστατικό αγορών, που δεν έχει γραμμές χρεοπίστωσης — άλλαξε τον πίνακα γραμμών σε «Ειδικές συναλλαγές» ή αντιστοίχισε τη γραμμή σε είδος/υπηρεσία/έξοδο',
  lines_sxdoc_unsupported: 'Η σειρά ανήκει στα «Παραστατικά εξόδων» (απλογραφικά βιβλία). Το μητρώο λογαριασμών εσόδων/εξόδων έχει συγχρονιστεί, αλλά η ΚΑΤΑΧΩΡΙΣΗ σε αυτή την ενότητα δεν έχει υλοποιηθεί ακόμη — διάλεξε σειρά άλλης ενότητας ή περίμενε την υποστήριξη',
  lines_no_mtrtype: 'Χρεοπίστωση χωρίς «Τύπο» (MTRTYPE) στο μητρώο — συγχρόνισε ξανά τις χρεοπιστώσεις',
  series_unknown: 'Η σειρά του παραστατικού δεν υπάρχει (ή δεν είναι σε χρήση) στο μητρώο σειρών — διάλεξε σειρά από τη λίστα ή συγχρόνισε τις σειρές',
  series_module_unsupported: 'Η ενότητα της σειράς δεν υποστηρίζεται για καταχώριση — επίλεξε σειρά αγορών (1251), προμηθευτών (1253), χρεωστών (1553) ή πιστωτών (1653)',
  trader_kind_mismatch: 'Ο συναλλασσόμενος δεν είναι του τύπου που δέχεται το παραστατικό — άλλαξέ τον από «Νέοι συναλλασσόμενοι» ή διάλεξε άλλη σειρά',
  account_missing: 'Χρεοπίστωση χωρίς λογαριασμό γενικής λογιστικής — η λογιστική εγγραφή δεν θα είχε πού να πάει',
  account_not_in_chart: 'Ο λογαριασμός γενικής της χρεοπίστωσης δεν υπάρχει στο λογιστικό σχέδιο του SoftOne',
  account_not_postable: 'Ο λογαριασμός γενικής της χρεοπίστωσης είναι συγκεντρωτικός λογαριασμός — δεν δέχεται εγγραφές',
  account_is_mask: 'Η χρεοπίστωση έχει μάσκα λογαριασμού (με *) αντί για συγκεκριμένο λογαριασμό γενικής — η εφαρμογή δεν μπορεί ακόμη να διαλέξει λογαριασμό μέσα στη μάσκα',
  posting_disabled: 'Η καταχώριση είναι απενεργοποιημένη (Ρυθμίσεις → Διασυνδέσεις)',
  already_posted: 'Έχει ήδη καταχωριστεί στο SoftOne',
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
async function gather(id: string): Promise<Gathered> {
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
        rowIndex: true, softoneMtrl: true, softoneExpn: true, softoneLinMtrl: true, softoneIsService: true,
        softoneCostCntr: true, softonePrjc: true, softonePrjcStage: true,
        // Ο επιμερισμός σε πολλούς λογαριασμούς — όταν υπάρχει, ΥΠΕΡΙΣΧΥΕΙ της μονής αντιστοίχισης.
        allocations: { orderBy: { order: 'asc' }, select: { registryMtrl: true, amount: true, percent: true } },
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
    loadTarget(doc.softoneSeries, doc.seriesSource),
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
  const [itemRows, linRows, expenseRows] = await Promise.all([
    mtrls.length
      ? prisma.softoneItem.findMany({ where: { mtrl: { in: mtrls } }, select: { mtrl: true, myDataCode: true } })
      : Promise.resolve([]),
    lins.length
      ? prisma.softoneLineItem.findMany({
          where: { mtrl: { in: lins } },
          select: {
            mtrl: true, code: true, name: true, mtrType: true, classType: true, classCategory: true, myDataCode: true,
            acnmsk: true, acnmskSyncedAt: true,
          },
        })
      : Promise.resolve([]),
    expns.length
      ? prisma.softoneExpense.findMany({
          where: { expn: { in: expns } },
          select: { expn: true, classTypeX: true, classCategoryX: true },
        })
      : Promise.resolve([]),
  ]);
  const itemById = new Map(itemRows.map((r) => [r.mtrl, r]));
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

  const series = Number(doc.softoneSeries);
  const seriesOk = Number.isFinite(series) && series > 0;
  const lineCtx: PurdocLineCtx[] = items.map((i) => {
    const item = i.softoneMtrl != null ? itemById.get(i.softoneMtrl) : undefined;
    const lin = i.softoneLinMtrl != null ? linById.get(i.softoneLinMtrl) : undefined;
    const expense = i.softoneExpn != null ? expenseById.get(i.softoneExpn) : undefined;
    const myDataCode = item?.myDataCode ?? lin?.myDataCode ?? null;
    // «Αχαρακτήριστο» = το μητρώο στο οποίο ταίριαξε η γραμμή δεν κουβαλά ΚΑΝΕΝΑ στοιχείο
    // χαρακτηρισμού. Το κρίνουμε μόνο για γραμμές που όντως ταίριαξαν κάπου.
    const matched = item ?? lin ?? expense;
    const hasClass = Boolean(
      myDataCode || lin?.classType || lin?.classCategory || expense?.classTypeX || expense?.classCategoryX,
    );
    return {
      rowIndex: i.rowIndex,
      mtrl: i.softoneMtrl,
      expn: i.softoneExpn,
      lin: i.softoneLinMtrl,
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
      noClassification: Boolean(matched) && !hasClass,
    };
  });

  const ctx: PurdocContext = {
    target,
    series: seriesOk ? series : 0,
    trdr: doc.softoneTrdr ?? 0,
    lines: lineCtx,
    vatIdByRate,
    comments: document.notes,
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
    softoneSeries: seriesOk ? doc.softoneSeries : null,
    seriesSource: doc.seriesSource,
    seriesKnown: seriesTarget.known,
    seriesEnabled: seriesTarget.enabled,
    traderSodtype: traderRow?.sodtype ?? null,
  }, ctx, accounts);

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
}

export async function postDocumentToSoftone(id: string, opts: PostOptions = {}): Promise<{ ref: string }> {
  const { doc, document, ctx, blockers, payload, accounts } = await gather(id);
  // ΙΔΕΜΠΟΤΗΤΑ, πρώτο απ' όλα: ένα δεύτερο κλικ (ή μια δεύτερη εκτέλεση προτύπου) δεν δημιουργεί
  // δεύτερο παραστατικό στο SoftOne. Πριν από κάθε έλεγχο εμποδίων — ένα ήδη καταχωρισμένο
  // παραστατικό δεν είναι «μπλοκαρισμένο», είναι τελειωμένο.
  if (doc.postStatus === 'POSTED') {
    throw new PostError('already_posted', alreadyPostedText(doc.postedRef));
  }
  if (blockers.length) {
    throw new PostError(blockers[0], blockers.map((c) => blockerMessage(c, accounts)).join(' · '));
  }
  if ((await getSetting<boolean>(POSTING_ENABLED_KEY)) !== true) {
    // Σκόπιμα ΠΡΙΝ από οποιαδήποτε εγγραφή: ένα κλειστό σύστημα δεν αλλάζει καν `postStatus`.
    throw new PostError('posting_disabled', POST_ERROR_TEXT.posting_disabled);
  }

  await prisma.ocrDocument.update({ where: { id }, data: { postStatus: 'PENDING' } });
  try {
    const object = ctx.target.object;
    const res = await softoneCall<{ success?: boolean; error?: string; errorcode?: number; id?: string | number }>('setData', payload);
    // ΚΑΘΑΡΗ αποτυχία: το SoftOne είπε «όχι». Τίποτα δεν δημιουργήθηκε.
    if (res.success === false) {
      throw new Error(res.error ?? `setData ${object} απέτυχε (code ${res.errorcode ?? '?'})`);
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

    await prisma.ocrDocument.update({
      where: { id },
      data: {
        postStatus: 'POSTED', postedAt: new Date(), postedRef: ref, postError: null,
        // ΜΟΝΟ χειροκίνητη ανάρτηση επιβεβαιώνει την ανάγνωση: κάποιος κοίταξε το παραστατικό και
        // το δέχτηκε ως λογιστικό γεγονός. Η αυτόματη ανάρτηση ενός AUTO προτύπου δεν είναι
        // επιβεβαίωση κανενός — βλ. `PostOptions.verified`.
        ...(opts.verified ? { verifiedAt: new Date(), verifiedById: opts.verifiedById ?? null } : {}),
      },
    });
    if (opts.syncTemplateRun) {
      await markLatestRunPosted(id).catch((e) => console.error('[ocr] run status not synced after post', doc.id, (e as Error).message));
    }
    return { ref };
  } catch (err) {
    await prisma.ocrDocument.update({
      where: { id },
      data: { postStatus: 'FAILED', postError: String((err as Error)?.message ?? err).slice(0, 2000) },
    });
    throw err;
  }
}
