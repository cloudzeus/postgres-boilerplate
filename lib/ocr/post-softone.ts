// lib/ocr/post-softone.ts — SERVER. One place for "post this document to SoftOne" (route + template runner).
import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getSetting } from '@/lib/settings';
import { softoneCall, softoneGetData } from '@/lib/softone';
import { buildReviewFlags } from '@/lib/templates/run-logic';
import type { DocumentJson } from './canonical';
import { loadDocumentJson } from './document';
import {
  buildPurdocPayload, postingBlockers,
  type BlockerCode, type PurdocContext, type PurdocPayload,
} from './purdoc-payload';

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
  no_trader: 'Δεν έχει αντιστοιχιστεί προμηθευτής στο SoftOne',
  no_series: 'Δεν έχει επιλεγεί σειρά παραστατικού',
  no_date: 'Λείπει η ημερομηνία του παραστατικού',
  no_number: 'Λείπει ο αριθμός του παραστατικού',
  no_lines: 'Το έγγραφο δεν έχει γραμμές',
  unmatched_lines: 'Υπάρχουν γραμμές χωρίς αντιστοίχιση σε είδος ή έξοδο',
  no_vat_category: 'Συντελεστής ΦΠΑ γραμμής χωρίς κωδικό στο μητρώο ΦΠΑ',
  totals_mismatch: 'Το άθροισμα των γραμμών δεν συμφωνεί με την καθαρή αξία',
  posting_disabled: 'Η καταχώριση είναι απενεργοποιημένη (Ρυθμίσεις → Διασυνδέσεις)',
  already_posted: 'Έχει ήδη καταχωριστεί στο SoftOne',
};

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
  payload: PurdocPayload;
};

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

  const [document, items, vats] = await Promise.all([
    loadDocumentJson(id),
    prisma.ocrInvoiceItem.findMany({
      where: { documentId: id },
      orderBy: { rowIndex: 'asc' },
      select: { rowIndex: true, softoneMtrl: true, softoneExpn: true, softoneIsService: true },
    }),
    // Η σειρά ΔΕΝ είναι διακοσμητική: δύο ενεργές εγγραφές με τον ίδιο συντελεστή (π.χ. κανονικό /
    // κανονικό νησιών) λύνονται από την πρώτη — άρα η ταξινόμηση πρέπει να είναι ρητή και σταθερή,
    // αλλιώς ο κωδικός ΦΠΑ που φεύγει προς το SoftOne αλλάζει με τη διάθεση του planner.
    prisma.vatCategory.findMany({
      where: { isActive: true },
      orderBy: [{ order: 'asc' }, { code: 'asc' }],
      select: { code: true, rate: true },
    }),
  ]);

  const vatIdByRate: Record<number, number> = {};
  for (const v of vats) {
    const rate = v.rate == null ? null : Number(v.rate);
    const code = Number(v.code);
    // Πρώτος κερδίζει: το μητρώο έρχεται ταξινομημένο, και δύο εγγραφές με τον ίδιο συντελεστή
    // (π.χ. κανονικό / κανονικό νησιών) δεν πρέπει να αλλάζουν σιωπηλά τον κωδικό που στέλνουμε.
    if (rate != null && Number.isFinite(rate) && Number.isFinite(code) && vatIdByRate[rate] == null) vatIdByRate[rate] = code;
  }

  const series = Number(doc.softoneSeries);
  const seriesOk = Number.isFinite(series) && series > 0;
  const ctx: PurdocContext = {
    series: seriesOk ? series : 0,
    trdr: doc.softoneTrdr ?? 0,
    lines: items.map((i) => ({ rowIndex: i.rowIndex, mtrl: i.softoneMtrl, expn: i.softoneExpn, isService: i.softoneIsService })),
    vatIdByRate,
    comments: document.notes,
  };

  const blockers = postingBlockers(document, {
    status: doc.status,
    category: doc.category,
    softoneTrdr: doc.softoneTrdr,
    softoneSeries: seriesOk ? doc.softoneSeries : null,
    seriesSource: doc.seriesSource,
  }, ctx);

  return { doc, document, ctx, blockers, payload: buildPurdocPayload(document, ctx) };
}

export type PostingPreview = {
  /** Ο διακόπτης `softone.postingEnabled`. */
  enabled: boolean;
  blockers: { code: BlockerCode; message: string }[];
  /** Τι ΘΑ σταλεί — υπάρχει και όταν υπάρχουν εμπόδια, για να φαίνεται τι λείπει. */
  payload: PurdocPayload;
  /** Σύνοψη για την κάρτα: ό,τι δεν διαβάζεται εύκολα από το raw payload. */
  summary: { series: string | null; trader: string | null; trdr: number | null; date: string | null; number: string | null; lines: number };
  /** Τι λέει ήδη η βάση: ένα POSTED έγγραφο δεν ξανα-στέλνεται (το κουμπί κλειδώνει). */
  postStatus: string;
  postedRef: string | null;
};

/**
 * ΠΡΟΕΠΙΣΚΟΠΗΣΗ. Δεν καλεί SoftOne, δεν γράφει τίποτα — ούτε καν `postStatus`.
 * Ό,τι επιστρέφει εδώ είναι ακριβώς ό,τι θα έστελνε το `postDocumentToSoftone`.
 */
export async function postingPreview(id: string): Promise<PostingPreview> {
  const { doc, document, ctx, blockers, payload } = await gather(id);
  const enabled = (await getSetting<boolean>(POSTING_ENABLED_KEY)) === true;
  return {
    enabled,
    blockers: blockers.map((code) => ({ code, message: blockerText(code) })),
    payload,
    summary: {
      series: doc.softoneSeries,
      trader: doc.softoneName,
      trdr: doc.softoneTrdr,
      date: document.date,
      number: document.type.number,
      lines: ctx.lines.length,
    },
    postStatus: doc.postStatus,
    postedRef: doc.postedRef,
  };
}

const sameRef = (a: unknown, b: unknown): boolean =>
  String(a ?? '').replace(/[^0-9A-Za-zΑ-Ωα-ω]/g, '').toUpperCase() === String(b ?? '').replace(/[^0-9A-Za-zΑ-Ωα-ω]/g, '').toUpperCase();

/**
 * Posts the document to SoftOne (setData on PURDOC) and PROVES it landed by reading the record back:
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
  const { doc, document, ctx, blockers, payload } = await gather(id);
  // ΙΔΕΜΠΟΤΗΤΑ, πρώτο απ' όλα: ένα δεύτερο κλικ (ή μια δεύτερη εκτέλεση προτύπου) δεν δημιουργεί
  // δεύτερο παραστατικό στο SoftOne. Πριν από κάθε έλεγχο εμποδίων — ένα ήδη καταχωρισμένο
  // παραστατικό δεν είναι «μπλοκαρισμένο», είναι τελειωμένο.
  if (doc.postStatus === 'POSTED') {
    throw new PostError('already_posted', alreadyPostedText(doc.postedRef));
  }
  if (blockers.length) {
    throw new PostError(blockers[0], blockers.map(blockerText).join(' · '));
  }
  if ((await getSetting<boolean>(POSTING_ENABLED_KEY)) !== true) {
    // Σκόπιμα ΠΡΙΝ από οποιαδήποτε εγγραφή: ένα κλειστό σύστημα δεν αλλάζει καν `postStatus`.
    throw new PostError('posting_disabled', POST_ERROR_TEXT.posting_disabled);
  }

  await prisma.ocrDocument.update({ where: { id }, data: { postStatus: 'PENDING' } });
  try {
    const res = await softoneCall<{ success?: boolean; error?: string; errorcode?: number; id?: string | number }>('setData', payload);
    if (res.success === false || res.id == null) {
      throw new Error(res.error ?? `setData PURDOC απέτυχε (code ${res.errorcode ?? '?'})`);
    }
    const ref = String(res.id);
    // Το παραστατικό ΥΠΑΡΧΕΙ πλέον στο SoftOne. Το `postedRef` αποθηκεύεται ΑΜΕΣΩΣ, πριν από την
    // επαλήθευση: αν το read-back σκάσει (δίκτυο, δικαιώματα, αργό ERP) η εγγραφή θα γίνει FAILED
    // — αλλά με τον αριθμό της στο χέρι, ώστε ένας άνθρωπος να τη βρει αντί να την ξαναστείλει.
    await prisma.ocrDocument.update({ where: { id }, data: { postedRef: ref } });

    const tables = await softoneGetData('PURDOC', ref);
    const row = tables.PURDOC?.[0] ?? tables.FINDOC?.[0] ?? Object.values(tables).find((t) => t.length)?.[0];
    if (!row) {
      throw new Error(`Η καταχώριση δεν επιβεβαιώθηκε: το SoftOne δεν επέστρεψε το παραστατικό ${ref}`);
    }
    if (!sameRef(row.FINCODE, document.type.number) || Number(row.TRDR) !== ctx.trdr) {
      throw new Error(
        `Η καταχώριση δεν επιβεβαιώθηκε: το παραστατικό ${ref} στο SoftOne έχει αριθμό «${row.FINCODE ?? '—'}» και προμηθευτή ${row.TRDR ?? '—'}, ` +
        `αντί για «${document.type.number ?? '—'}» / ${ctx.trdr}`,
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
