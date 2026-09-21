import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { normalizeAfm, vatCountry } from '@/lib/ocr/validate';
import { splitGluedAddress } from '@/lib/ocr/address';
import { refreshDocTallies } from '@/lib/ocr/softone-match';
import { loadDocumentJson, saveDocumentJson } from '@/lib/ocr/document';
import { setPath } from '@/lib/ocr/canonical';
import { SODTYPE_LABEL, TRADER_KIND_SODTYPE, type TraderKind } from '@/lib/softone';
import {
  groupLines,
  normalizeLineText,
  scoreCandidates,
  suggestTraderKind,
  type MatchCandidate,
  type MatchKind,
} from '@/lib/ocr/line-match';
import { seriesTraderKind, type SeriesTraderKind } from '@/lib/ocr/posting-target';
import { requiredTraderKinds, postingTargetsForSeries, seriesKey, type RequiredTraderKind } from '@/lib/ocr/required-trader-kind';
import { inferLineKind } from '@/lib/ocr/line-kind';
import type { PostLineTable } from '@/lib/ocr/posting-target';
import { cachedClassificationLabeller, type ClassificationRef } from '@/lib/ocr/mydata-labels';

/**
 * Server-side λογική για τις δύο ουρές του spec 2026-09-11 (§2 «Νέοι συναλλασσόμενοι»,
 * §3 «Είδη & έξοδα»): φόρτωση/ομαδοποίηση, προτάσεις αντιστοίχισης και εφαρμογή μιας
 * απόφασης σε όλη την ομάδα. Τα routes είναι λεπτά περιτυλίγματα γύρω από αυτό το αρχείο.
 *
 * Καθαρή λογική (κανονικοποίηση, ομαδοποίηση, Dice) ζει στο `lib/ocr/line-match.ts`.
 */

/** Ανώτατο πλήθος εγγράφων/γραμμών που φορτώνουμε για μια ουρά (η ουρά είναι εργασία, όχι αρχείο). */
const MAX_QUEUE_DOCS = 2000;
const MAX_QUEUE_LINES = 2000;
/** Πόσα υποψήφια είδη/έξοδα φέρνουμε ανά αναζήτηση ονόματος/κωδικού. */
const CANDIDATE_TAKE = 200;
/** Για πόσες ομάδες υπολογίζουμε προτάσεις με το πρώτο GET (οι υπόλοιπες lazy). */
const DEFAULT_SUGGEST_GROUPS = 50;
/** Ελάχιστο μήκος token για αναζήτηση ονόματος — μικρότερα φέρνουν τα πάντα. */
const MIN_TOKEN = 4;
/** Πόσα (τα μεγαλύτερα) tokens του pattern χρησιμοποιούνται στην αναζήτηση. */
const MAX_TOKENS = 2;
/** Σκορ που δίνουμε σε πρόταση από τη μνήμη (`LineMatchRule`) — πάνω από κάθε ομοιότητα ονόματος. */
const MEMORY_SCORE = 0.95;

/** Σφάλμα με κωδικό/HTTP status, ώστε τα routes να μη μεταφράζουν μηνύματα. */
export class QueueError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
    this.name = 'QueueError';
  }
}

const str = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s || null;
};
const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Ημερομηνία παραστατικού από το `extractedData.date`: δέχεται ISO αλλά και
 * ελληνική μορφή ημ/μμ/εεεε (ή με παύλες/τελείες) — αλλιώς null.
 */
function parseDocDate(v: unknown): Date | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const gr = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (gr) {
    const d = new Date(Date.UTC(Number(gr[3]), Number(gr[2]) - 1, Number(gr[1])));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ============================================================
// §2 — Ουρά «Νέοι συναλλασσόμενοι»
// ============================================================

/**
 * Ετικέτα τύπου συναλλασσομένου όπως την αποθηκεύουν `SoftoneTrader.kind` /
 * `OcrDocument.softoneKind`. Παράγεται από το ΙΔΙΟ λεξικό SODTYPE με το `lib/softone.ts`,
 * ώστε μια αλλαγή ετικέτας εκεί να μη διχάσει τις δύο πλευρές.
 */
export const TRADER_KIND_LABEL: Record<TraderKind, string> = {
  supplier: SODTYPE_LABEL[TRADER_KIND_SODTYPE.supplier],
  creditor: SODTYPE_LABEL[TRADER_KIND_SODTYPE.creditor],
  debtor: SODTYPE_LABEL[TRADER_KIND_SODTYPE.debtor],
};


/** Δείγματα κωδικών ανά τύπο συναλλασσομένου — για να ΔΕΙΞΟΥΜΕ, όχι να μαντέψουμε. */
export type TraderCodeSamples = Record<TraderKind, string[]>;

/** Πόσα δείγματα κωδικών δείχνουμε ανά τύπο. */
const CODE_SAMPLES = 4;

/**
 * Πραγματικοί κωδικοί που ήδη χρησιμοποιούν οι συναλλασσόμενοι κάθε τύπου, από τον
 * ΤΟΠΙΚΟ καθρέφτη (`SoftoneTrader`) — read-only, καμία κλήση στο SoftOne.
 *
 * Σκοπός: όταν η εγκατάσταση ΑΠΑΙΤΕΙ κωδικό (και την απαιτεί για κάθε τύπο), ο
 * χρήστης βλέπει τι μορφή έχουν οι υπάρχοντες κωδικοί ΤΟΥ ΙΔΙΟΥ τύπου.
 *
 * Τα δείγματα είναι συμπλήρωμα, όχι υποκατάστατο της πρότασης: η εφαρμογή ΠΡΟΤΕΙΝΕΙ
 * πλέον τον επόμενο ελεύθερο κωδικό (`nextTraderCode`, δες τη φόρμα «Νέοι
 * συναλλασσόμενοι»). Η πρόταση παραμένει πρόταση — το πεδίο είναι επεξεργάσιμο και
 * το σχέδιο λογαριασμών ανήκει στον λογιστή.
 *
 * Προσοχή στο τι ΔΕΝ είναι δείγμα πιστωτή: ο `53.90.00.0000` της εγκατάστασης είναι
 * λογαριασμός τραπέζης (`SODTYPE 14`), όχι πιστωτής. Γι' αυτό το ερώτημα εδώ
 * φιλτράρει πάντα στο SODTYPE του τύπου.
 */
export async function loadTraderCodeSamples(): Promise<TraderCodeSamples> {
  const empty: TraderCodeSamples = { supplier: [], creditor: [], debtor: [] };
  const kinds = Object.keys(empty) as TraderKind[];
  const lists = await Promise.all(
    kinds.map((k) =>
      prisma.softoneTrader
        .findMany({
          where: { sodtype: TRADER_KIND_SODTYPE[k], code: { not: '' } },
          select: { code: true },
          distinct: ['code'],
          orderBy: { code: 'asc' },
          take: CODE_SAMPLES,
        })
        .catch(() => [] as { code: string }[]),
    ),
  );
  kinds.forEach((k, i) => { empty[k] = lists[i].map((r) => r.code).filter(Boolean); });
  return empty;
}

export interface TraderQueueDoc {
  id: string;
  fileName: string;
  date: string | null;
  total: number | null;
  series: string | null;
}
/** Μια καρτέλα του ΙΔΙΟΥ ΑΦΜ που υπάρχει ήδη στο SoftOne (τοπικός καθρέφτης). */
export interface TraderCard {
  trdr: number;
  code: string | null;
  name: string;
  sodtype: number;
  /** Ελληνική ετικέτα τύπου («Προμηθευτής» / «Πιστωτής» / «Χρεώστης»). */
  label: string;
  /** Ο τύπος με τα ονόματα της εφαρμογής — `null` για SODTYPE εκτός των τριών. */
  kind: TraderKind | null;
}

/**
 * Ένας τύπος καρτέλας που **λείπει** για αυτόν τον εκδότη: τα παραστατικά του τον ζητούν
 * (μέσω της σειράς τους) και καμία γραμμή `TRDR` με αυτό το SODTYPE δεν υπάρχει για το ΑΦΜ.
 */
export interface MissingTraderKind {
  kind: TraderKind;
  sodtype: number;
  /** Πόσα εκκρεμή παραστατικά της ομάδας τον ζητούν. */
  docCount: number;
  /** Οι σειρές που τον επιβάλλουν — η εξήγηση «γιατί αυτός ο τύπος». */
  series: string[];
  /** Έτοιμη ελληνική πρόταση για το UI. */
  reason: string;
}

export interface TraderGroup {
  afm: string;
  /**
   * ISO-2 χώρα του εκδότη από το ίδιο το ΑΦΜ/VAT id — `null` όταν είναι άγνωστη
   * (σκέτα ψηφία που δεν περνούν τον ελληνικό έλεγχο). Το `null` το χειριζόμαστε
   * ως ελληνικό: η ΑΑΔΕ απλώς θα αστοχήσει, όπως και σήμερα.
   */
  country: string | null;
  /** Γνωστή χώρα ≠ GR: χωρίς ΑΑΔΕ/Δ.Ο.Υ., με VIES αντ' αυτής. */
  isForeign: boolean;
  name: string | null;
  doy: string | null;
  profession: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  docCount: number;
  total: number;
  lastDate: string | null;
  thumbUrl: string | null;
  suggestedKind: TraderKind;
  /** Οι καρτέλες που ΥΠΑΡΧΟΥΝ ήδη στο SoftOne για αυτό το ΑΦΜ (τύπος, κωδικός, επωνυμία). */
  cards: TraderCard[];
  /**
   * Οι τύποι που λείπουν, με τη σειρά που τους ζητούν τα παραστατικά. Κενό ⇒ η ομάδα είναι
   * εκκρεμής μόνο επειδή κάποιο παραστατικό δεν έχει καθόλου συναλλασσόμενο και η σειρά του
   * δεν λέει τι χρειάζεται.
   */
  missing: MissingTraderKind[];
  /**
   * Πόσα εκκρεμή παραστατικά έχουν σειρά **άγνωστη ή μη υποστηριζόμενη**: δεν ξέρουμε τι
   * καρτέλα θέλουν, οπότε δεν γεννούν εκκρεμότητα τύπου — μόνο τη γενική «δεν έχει
   * συναλλασσόμενο». Φαίνεται στο panel ώστε ο χρήστης να ξέρει γιατί δεν προτείνεται τύπος.
   */
  unknownSeriesDocs: number;
  docs: TraderQueueDoc[];
}
export interface IgnoredIssuerRow {
  afm: string;
  name: string | null;
  reason: string | null;
}

/** Πόσα παραστατικά-δείγματα επιστρέφονται ανά ομάδα εκδότη. */
const TRADER_DOCS_SAMPLE = 10;

interface TraderAcc {
  afm: string;
  names: Map<string, number>;
  doy: string | null;
  profession: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  docCount: number;
  total: number;
  lastDate: Date | null;
  thumbUrl: string | null;
  seriesKinds: SeriesTraderKind[];
  invoiceKinds: (string | null)[];
  /** Τύποι που ζητούν τα έγγραφα και λείπουν, με τις σειρές που τους επιβάλλουν. */
  needs: Map<TraderKind, { kind: TraderKind; sodtype: number; docCount: number; series: Set<string> }>;
  unknownSeriesDocs: number;
  docs: TraderQueueDoc[];
}

const topName = (names: Map<string, number>): string | null => {
  let best: string | null = null;
  let bestN = 0;
  for (const [n, c] of names) if (c > bestN) { best = n; bestN = c; }
  return best;
};

/** SODTYPE → τύπος της εφαρμογής. Ο ΙΔΙΟΣ χάρτης με τη δημιουργία καρτέλας, ανάποδα. */
const KIND_BY_SODTYPE = new Map<number, TraderKind>(
  (Object.keys(TRADER_KIND_SODTYPE) as TraderKind[]).map((k) => [TRADER_KIND_SODTYPE[k], k]),
);

/** Ελληνική αιτιατική του τύπου — για το «Χρειάζεται καρτέλα πιστωτή…». */
const KIND_ACCUSATIVE: Record<TraderKind, string> = {
  supplier: 'προμηθευτή', creditor: 'πιστωτή', debtor: 'χρεώστη',
};

/** Τα πεδία εγγράφου που χρειάζεται η ουρά εκδοτών — τίποτα παραπάνω. */
const TRADER_DOC_SELECT = {
  id: true, fileName: true, thumbUrl: true, createdAt: true, extractedData: true,
  issuerAfm: true, softoneSeries: true, seriesSource: true, invoiceKind: true, softoneTrdr: true,
} as const;

type TraderQueueRow = {
  id: string;
  fileName: string;
  thumbUrl: string | null;
  createdAt: Date;
  extractedData: unknown;
  issuerAfm: string | null;
  softoneSeries: string | null;
  seriesSource: number | null;
  invoiceKind: string | null;
  softoneTrdr: number | null;
};

interface PendingTraderDocs {
  /** Τα ΕΚΚΡΕΜΗ έγγραφα, νεότερο πρώτα, χωρίς διπλότυπα. */
  docs: TraderQueueRow[];
  /** Ο απαιτούμενος τύπος ανά σειρά (κλειδί `seriesKey`). */
  required: Map<string, RequiredTraderKind | null>;
  /** Οι καρτέλες που ήδη υπάρχουν, ανά ΑΦΜ. */
  cards: Map<string, TraderCard[]>;
  truncated: boolean;
}

/**
 * Ποια έγγραφα είναι **πραγματικά** εκκρεμή ως προς τον συναλλασσόμενο.
 *
 * Η παλιά απάντηση ήταν «όσα δεν έχουν `softoneTrdr`», και ήταν λειψή: στο SoftOne η ίδια
 * εταιρεία έχει ΞΕΧΩΡΙΣΤΗ καρτέλα ανά τύπο (12 προμηθευτής / 16 πιστωτής / 15 χρεώστης). Μόλις
 * δημιουργούνταν **μία** από αυτές, το ΑΦΜ έφευγε από την ουρά για πάντα — και ένα επόμενο
 * τιμολόγιο σε σειρά που ζητά τον ΑΛΛΟ τύπο δεν είχε κανέναν δρόμο μέσα από την εφαρμογή:
 * η `alignTraderToTarget` δεν έβρισκε εναλλακτική και η καταχώριση κολλούσε στο
 * `trader_kind_mismatch`. Σωστή άρνηση, αδιέξοδο όμως.
 *
 * Η εκκρεμότητα είναι πλέον **ανά απαιτούμενο τύπο**:
 *  • έγγραφο ΧΩΡΙΣ συναλλασσόμενο → εκκρεμές, όπως πάντα·
 *  • έγγραφο ΜΕ συναλλασσόμενο → εκκρεμές μόνο αν η σειρά του ζητά τύπο για τον οποίο **δεν
 *    υπάρχει καμία καρτέλα** στο ΑΦΜ. (Αν υπάρχει, η `alignTraderToTarget` τη βρίσκει μόνη της
 *    στον τοπικό καθρέφτη — δεν είναι δουλειά της ουράς.)
 *
 * Έγγραφα με **άγνωστη ή μη υποστηριζόμενη** σειρά ΔΕΝ γεννούν εκκρεμότητα τύπου: δεν ξέρουμε
 * τι καρτέλα θέλουν, και μια αυθαίρετη «προμηθευτής» θα ζητούσε από τον χρήστη να φτιάξει κάτι
 * που ίσως δεν χρειάζεται ποτέ. Αν τέτοιο έγγραφο δεν έχει καθόλου συναλλασσόμενο, μένει
 * εκκρεμές με τον γενικό λόγο· αν έχει, δεν μπαίνει καν στην ουρά.
 *
 * Τα ήδη **καταχωρημένα** (`postStatus: POSTED`) εξαιρούνται: έφυγαν προς τον ERP, η καρτέλα
 * τους δεν είναι πια εκκρεμότητα.
 */
async function collectPendingTraderDocs(): Promise<PendingTraderDocs> {
  const [unlinked, linked] = await Promise.all([
    prisma.ocrDocument.findMany({
      // Το ΑΦΜ εκδότη είναι στήλη με index (`issuerAfm`): κανένα φιλτράρισμα πάνω σε JSON.
      where: {
        status: 'COMPLETED', softoneTrdr: null, softoneChecked: { not: null },
        issuerAfm: { not: null },
      },
      select: TRADER_DOC_SELECT,
      orderBy: { createdAt: 'desc' },
      take: MAX_QUEUE_DOCS,
    }),
    prisma.ocrDocument.findMany({
      where: {
        status: 'COMPLETED', softoneTrdr: { not: null }, issuerAfm: { not: null },
        softoneSeries: { not: null }, seriesSource: { not: null },
        postStatus: { not: 'POSTED' },
      },
      select: TRADER_DOC_SELECT,
      orderBy: { createdAt: 'desc' },
      take: MAX_QUEUE_DOCS,
    }),
  ]) as [TraderQueueRow[], TraderQueueRow[]];

  const all = [...unlinked, ...linked];
  const required = await requiredTraderKinds(all);

  const afms = Array.from(new Set(all.map((d) => d.issuerAfm).filter((a): a is string => !!a)));
  const cardRows = afms.length === 0 ? [] : await prisma.softoneTrader
    .findMany({
      where: { afm: { in: afms }, isActive: true },
      select: { trdr: true, code: true, name: true, afm: true, sodtype: true },
    })
    .catch(() => [] as { trdr: number; code: string; name: string; afm: string | null; sodtype: number }[]);

  const cards = new Map<string, TraderCard[]>();
  for (const r of cardRows) {
    if (!r.afm) continue;
    const list = cards.get(r.afm) ?? [];
    list.push({
      trdr: r.trdr, code: r.code || null, name: r.name, sodtype: r.sodtype,
      label: SODTYPE_LABEL[r.sodtype] ?? `Τύπος ${r.sodtype}`,
      kind: KIND_BY_SODTYPE.get(r.sodtype) ?? null,
    });
    cards.set(r.afm, list);
  }
  const hasKind = (afm: string, sodtype: number) => (cards.get(afm) ?? []).some((c) => c.sodtype === sodtype);

  const seen = new Set<string>();
  const docs: TraderQueueRow[] = [];
  for (const d of all) {
    if (seen.has(d.id) || !d.issuerAfm) continue;
    if (d.softoneTrdr != null) {
      const key = seriesKey(d);
      const req = key ? required.get(key) ?? null : null;
      // Έχει ήδη καρτέλα και ο τύπος που ζητά η σειρά του υπάρχει (ή είναι άγνωστος): όχι ουρά.
      if (!req || hasKind(d.issuerAfm, req.sodtype)) continue;
    }
    seen.add(d.id);
    docs.push(d);
  }
  docs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return {
    docs, required, cards,
    truncated: unlinked.length >= MAX_QUEUE_DOCS || linked.length >= MAX_QUEUE_DOCS,
  };
}

/**
 * Οι εκκρεμείς εκδότες, ομαδοποιημένοι κατά ΑΦΜ (δες {@link collectPendingTraderDocs} για το τι
 * μετρά ως εκκρεμές). Κάθε ομάδα κουβαλά τις καρτέλες που ΥΠΑΡΧΟΥΝ ήδη στο SoftOne και τους
 * τύπους που **λείπουν**, με τις σειρές που τους επιβάλλουν.
 *
 * Οι αγνοημένοι (`IgnoredIssuer`) βγαίνουν από τις ομάδες και επιστρέφονται χωριστά όταν
 * ζητηθούν (φίλτρο «Αγνοημένοι» της σελίδας).
 */
export async function loadTraderQueue(opts: { includeIgnored?: boolean } = {}): Promise<{
  groups: TraderGroup[];
  ignored: IgnoredIssuerRow[];
  truncated: boolean;
}> {
  const [pending, ignoredRows] = await Promise.all([
    collectPendingTraderDocs(),
    prisma.ignoredIssuer.findMany({ select: { afm: true, reason: true } }),
  ]);
  const { docs, required, cards } = pending;

  const ignoredReason = new Map(ignoredRows.map((r) => [r.afm, r.reason ?? null]));
  const acc = new Map<string, TraderAcc>();

  for (const doc of docs) {
    const ed = (doc.extractedData ?? {}) as Record<string, unknown>;
    const afm = doc.issuerAfm;
    if (!afm) continue;
    let g = acc.get(afm);
    if (!g) {
      g = {
        afm, names: new Map(), doy: null, profession: null, address: null, phone: null, email: null,
        docCount: 0, total: 0, lastDate: null, thumbUrl: null, seriesKinds: [], invoiceKinds: [],
        needs: new Map(), unknownSeriesDocs: 0, docs: [],
      };
      acc.set(afm, g);
    }
    const name = str(ed.companyName);
    if (name) g.names.set(name, (g.names.get(name) ?? 0) + 1);
    // Τα έγγραφα έρχονται από το νεότερο προς το παλαιότερο: κρατάμε το πρώτο μη κενό.
    g.doy ??= str(ed.companyDoy);
    g.profession ??= str(ed.companyProfession);
    // Οι κολλημένες γραμμές του OCR σπάνε εδώ, ώστε η κάρτα και το geocoding
    // να δουν κανονική διεύθυνση.
    g.address ??= splitGluedAddress(str(ed.companyAddress) ?? '') || null;
    g.phone ??= str(ed.companyPhone);
    g.email ??= str(ed.companyEmail);
    g.thumbUrl ??= doc.thumbUrl ?? null;
    g.docCount++;
    const total = num(ed.totalAmount);
    if (total != null) g.total += total;
    const date = parseDocDate(ed.date) ?? doc.createdAt;
    if (!g.lastDate || date > g.lastDate) g.lastDate = date;
    if (doc.seriesSource != null) g.seriesKinds.push(seriesTraderKind(doc.seriesSource));
    g.invoiceKinds.push(doc.invoiceKind ?? null);

    // Ποιον ΤΥΠΟ ζητά αυτό το παραστατικό — και λείπει.
    const key = seriesKey(doc);
    const req = key ? required.get(key) ?? null : null;
    if (!req) {
      g.unknownSeriesDocs++;
    } else if (!(cards.get(afm) ?? []).some((c) => c.sodtype === req.sodtype)) {
      const need = g.needs.get(req.kind) ?? { kind: req.kind, sodtype: req.sodtype, docCount: 0, series: new Set<string>() };
      need.docCount++;
      if (doc.softoneSeries) need.series.add(doc.softoneSeries);
      g.needs.set(req.kind, need);
    }

    if (g.docs.length < TRADER_DOCS_SAMPLE) {
      g.docs.push({
        id: doc.id, fileName: doc.fileName, date: str(ed.date),
        total, series: doc.softoneSeries ?? null,
      });
    }
  }

  const groups: TraderGroup[] = [];
  const ignored: IgnoredIssuerRow[] = [];
  for (const g of acc.values()) {
    if (ignoredReason.has(g.afm)) {
      ignored.push({ afm: g.afm, name: topName(g.names), reason: ignoredReason.get(g.afm) ?? null });
      continue;
    }
    const country = vatCountry(g.afm);
    const missing: MissingTraderKind[] = [...g.needs.values()]
      .sort((a, b) => b.docCount - a.docCount)
      .map((n) => {
        const series = [...n.series];
        const where = series.length === 0
          ? 'για τα παραστατικά αυτού του εκδότη'
          : series.length === 1
            ? `για τη σειρά ${series[0]}`
            : `για τις σειρές ${series.join(', ')}`;
        return {
          kind: n.kind, sodtype: n.sodtype, docCount: n.docCount, series,
          reason: `Χρειάζεται καρτέλα ${KIND_ACCUSATIVE[n.kind]} ${where}`,
        };
      });
    groups.push({
      afm: g.afm,
      country,
      isForeign: country != null && country !== 'GR',
      name: topName(g.names),
      doy: g.doy, profession: g.profession, address: g.address, phone: g.phone, email: g.email,
      docCount: g.docCount,
      total: Math.round(g.total * 100) / 100,
      lastDate: g.lastDate ? g.lastDate.toISOString() : null,
      thumbUrl: g.thumbUrl,
      // Ο τύπος που ΛΕΙΠΕΙ είναι απόδειξη, όχι ευρετική: όταν υπάρχει, υπερισχύει της πρότασης.
      suggestedKind: missing[0]?.kind
        ?? suggestTraderKind({ seriesKinds: g.seriesKinds, invoiceKinds: g.invoiceKinds }),
      cards: cards.get(g.afm) ?? [],
      missing,
      unknownSeriesDocs: g.unknownSeriesDocs,
      docs: g.docs,
    });
  }
  // Αγνοημένοι χωρίς κανένα εκκρεμές έγγραφο: τους δείχνουμε κι αυτούς (αναιρέσιμο).
  for (const [afm, reason] of ignoredReason) {
    if (!acc.has(afm)) ignored.push({ afm, name: null, reason });
  }

  groups.sort((a, b) => (b.docCount - a.docCount) || (b.total - a.total) || a.afm.localeCompare(b.afm));
  // Το πλαφόν χτύπησε: η σελίδα βλέπει μέρος της ουράς (οι μετρητές του sidebar μένουν σωστοί).
  return { groups, ignored: opts.includeIgnored ? ignored : [], truncated: pending.truncated };
}

export interface TraderLink {
  trdr: number;
  code: string | null;
  name: string;
  /** Η ελληνική ετικέτα («Προμηθευτής» / «Πιστωτής» / «Χρεώστης») όπως γράφεται στο έγγραφο. */
  kind: string;
  /**
   * Το `TRDR.SODTYPE` της καρτέλας. Όταν λείπει, διαβάζεται από τον καθρέφτη — χωρίς αυτό δεν
   * ξέρουμε ΠΟΙΑ έγγραφα αφορά αυτή η καρτέλα και η σύνδεση ξαναγίνεται τυφλή.
   */
  sodtype?: number | null;
}

/**
 * Γράφει τον συναλλασσόμενο στα έγγραφα του ΑΦΜ που **τον αφορούν** — και ΜΟΝΟ σε αυτά.
 *
 * Η παλιά συμπεριφορά έγραφε το ίδιο `trdr` σε ΚΑΘΕ έγγραφο του ΑΦΜ, ανεξάρτητα από τη σειρά
 * του καθενός, και άφηνε την `alignTraderToTarget` να το διορθώσει μετά. Όταν όμως η σωστή
 * καρτέλα δεν υπήρχε, η διόρθωση ήταν αδύνατη και το έγγραφο έφευγε από την ουρά με **λάθος
 * τύπο** — ακριβώς το αδιέξοδο που λύνει η ανά τύπο εκκρεμότητα. Τώρα:
 *
 *  1. Για κάθε εκκρεμές έγγραφο ρωτάμε τη ΣΕΙΡΑ του τι τύπο θέλει
 *     (`lib/ocr/required-trader-kind.ts` — η ίδια αλυσίδα με την `alignTraderToTarget`).
 *  2. Αν ο τύπος είναι γνωστός, γράφεται η καρτέλα ΑΥΤΟΥ του τύπου, όποια κι αν είναι — όχι
 *     απαραίτητα αυτή που μόλις δημιουργήθηκε.
 *  3. Αν ο τύπος είναι γνωστός αλλά **δεν υπάρχει** τέτοια καρτέλα, το έγγραφο ΔΕΝ γράφεται:
 *     μένει εκκρεμές για τον τύπο που πραγματικά χρειάζεται.
 *  4. Αν η σειρά είναι άγνωστη ή μη υποστηριζόμενη, γράφεται η καρτέλα που έδωσε ο χρήστης —
 *     εκεί δεν υπάρχει καμία πληροφορία για να αποφασίσουμε αλλιώς.
 *  5. Τέλος, τα ήδη συνδεδεμένα έγγραφα που ζητούν ΑΚΡΙΒΩΣ τον τύπο αυτής της καρτέλας αλλά
 *     δείχνουν αλλού **ξαναδείχνονται** εδώ: αυτό είναι που καθαρίζει την εκκρεμότητα όταν ο
 *     χρήστης δημιουργεί τη δεύτερη καρτέλα ενός εκδότη.
 *
 * Επιστρέφει πόσα έγγραφα ενημερώθηκαν συνολικά.
 *
 * `opts.vatId`: το ΤΕΛΙΚΟ ΑΦΜ του εκδότη όταν ο χρήστης του πρόσθεσε πρόθεμα
 * χώρας (π.χ. ο geocoder βρήκε Γερμανία ⇒ «144960040» → «DE144960040»). Τότε τα
 * έγγραφα ΞΑΝΑΓΡΑΦΟΝΤΑΙ με τη νέα τιμή — μέσα από το ΚΑΝΟΝΙΚΟ έγγραφο
 * (`document.issuer.vat`), που είναι η πηγή αλήθειας: το `saveDocumentJson`
 * παράγει από εκεί και το `extractedData.vatNumber` και το `issuerAfm`, οπότε
 * το κλειδί της ουράς μένει συνεπές και η επόμενη αποθήκευση δεν το γυρίζει πίσω.
 * Χωρίς αυτό, το ίδιο τιμολόγιο θα ξαναεμφανιζόταν στην ουρά με το παλιό, γυμνό ΑΦΜ.
 */
export async function applyTraderToDocs(
  afm: string,
  trader: TraderLink,
  opts: { vatId?: string | null } = {},
): Promise<number> {
  const target = normalizeAfm(afm);
  if (!target) return 0;
  const rewritten = opts.vatId ? normalizeAfm(opts.vatId) : null;
  const next = rewritten && rewritten !== target ? rewritten : null;

  const stampFor = (t: TraderLink) => ({
    softoneTrdr: t.trdr,
    softoneCode: t.code ?? null,
    softoneName: t.name,
    softoneKind: t.kind,
    softoneChecked: new Date(),
  });

  // Οι καρτέλες του ΑΦΜ από τον καθρέφτη. Ο καλών έχει ήδη κάνει upsert τη νέα, οπότε είναι
  // μέσα· ψάχνουμε και με τις δύο μορφές ΑΦΜ (γυμνό / με πρόθεμα χώρας).
  const afmForms = Array.from(new Set([target, rewritten, opts.vatId ?? null].filter((v): v is string => !!v)));
  const cardRows = await prisma.softoneTrader
    .findMany({
      where: { afm: { in: afmForms }, isActive: true },
      select: { trdr: true, code: true, name: true, sodtype: true, kind: true },
    })
    .catch(() => [] as { trdr: number; code: string; name: string; sodtype: number; kind: string }[]);

  // Το SODTYPE της καρτέλας που έδωσε ο χρήστης — από το όρισμα, αλλιώς από τον καθρέφτη.
  const ownSodtype = trader.sodtype ?? cardRows.find((c) => c.trdr === trader.trdr)?.sodtype ?? null;
  const cardFor = (sodtype: number): TraderLink | null => {
    if (ownSodtype === sodtype) return trader;
    const row = cardRows.find((c) => c.sodtype === sodtype);
    return row ? { trdr: row.trdr, code: row.code || null, name: row.name, kind: row.kind, sodtype: row.sodtype } : null;
  };
  const sodtypeOf = new Map(cardRows.map((c) => [c.trdr, c.sodtype]));

  // ── 1. Εκκρεμή έγγραφα (χωρίς συναλλασσόμενο) ────────────────────────
  const pending = await prisma.ocrDocument.findMany({
    where: { status: 'COMPLETED', softoneTrdr: null, issuerAfm: target },
    select: { id: true, seriesSource: true, softoneSeries: true },
  });

  // ── 2. Ήδη συνδεδεμένα που ζητούν ΑΥΤΟΝ τον τύπο αλλά δείχνουν αλλού ──
  const linked = ownSodtype == null ? [] : await prisma.ocrDocument.findMany({
    where: {
      status: 'COMPLETED', issuerAfm: target,
      softoneTrdr: { not: null }, softoneSeries: { not: null }, seriesSource: { not: null },
      postStatus: { not: 'POSTED' },
    },
    select: { id: true, seriesSource: true, softoneSeries: true, softoneTrdr: true },
  });

  const required = await requiredTraderKinds([...pending, ...linked]);
  const kindOf = (d: { seriesSource: number | null; softoneSeries: string | null }) => {
    const key = seriesKey(d);
    return key ? required.get(key) ?? null : null;
  };

  /** Ποια καρτέλα παίρνει κάθε έγγραφο — `null` = δεν γράφεται τίποτα (μένει εκκρεμές). */
  const assignment = new Map<string, TraderLink>();
  for (const d of pending) {
    const req = kindOf(d);
    // Άγνωστη/μη υποστηριζόμενη σειρά: καμία πληροφορία — ό,τι έδωσε ο χρήστης.
    const card = req ? cardFor(req.sodtype) : trader;
    if (card) assignment.set(d.id, card);
  }
  for (const d of linked) {
    const req = kindOf(d);
    if (!req || req.sodtype !== ownSodtype) continue;
    // Ήδη δείχνει σε καρτέλα του ΣΩΣΤΟΥ τύπου: δεν το πειράζουμε.
    if (d.softoneTrdr != null && sodtypeOf.get(d.softoneTrdr) === req.sodtype) continue;
    assignment.set(d.id, trader);
  }
  if (assignment.size === 0) return 0;

  // Κοινή περίπτωση: ομαδικά `updateMany` ανά καρτέλα — καμία ανάγνωση/σάρωση JSON.
  if (!next) {
    const byTrader = new Map<number, { link: TraderLink; ids: string[] }>();
    for (const [id, link] of assignment) {
      const bucket = byTrader.get(link.trdr) ?? { link, ids: [] };
      bucket.ids.push(id);
      byTrader.set(link.trdr, bucket);
    }
    let count = 0;
    for (const { link, ids } of byTrader.values()) {
      const res = await prisma.ocrDocument.updateMany({ where: { id: { in: ids } }, data: stampFor(link) });
      count += res.count ?? ids.length;
    }
    return count;
  }

  // Αλλαγή ΑΦΜ: το κανονικό έγγραφο είναι JSON, οπότε χρειάζεται read-modify-write ανά έγγραφο.
  // ΔΕΝ γράφουμε `issuerAfm`/`extractedData` με το χέρι — θα τα ξαναέφτιαχνε από το `document` η
  // επόμενη αποθήκευση και το πρόθεμα θα χανόταν. Ο συναλλασσόμενος ταξιδεύει ως `also`, δηλαδή
  // στο ΙΔΙΟ transaction με το έγγραφο: ένα έγγραφο δεν μένει ποτέ μισο-ενημερωμένο.
  for (const [id, link] of assignment) {
    const document = setPath(await loadDocumentJson(id), 'issuer.vat', next);
    await saveDocumentJson(id, document, { also: stampFor(link) });
  }
  return assignment.size;
}

// ============================================================
// §3 — Ουρά «Είδη & έξοδα»
// ============================================================

/** Εκκρεμής = χωρίς είδος, έξοδο ή χρεοπίστωση, και χωρίς ρητή παράλειψη. */
export const UNMATCHED_LINE_WHERE: Prisma.OcrInvoiceItemWhereInput = {
  softoneMtrl: null,
  softoneExpn: null,
  softoneLinMtrl: null,
  // `not` σε nullable πεδίο δεν επιστρέφει NULL — τα κενά τα ζητάμε ρητά.
  OR: [{ softoneMatchedBy: null }, { softoneMatchedBy: { not: 'skipped' } }],
};

export interface QueueSuggestion {
  mtrl: number | null;
  expn: number | null;
  /** MTRL χρεοπίστωσης (`SoftoneLineItem`) όταν η πρόταση είναι «Ειδικές συναλλαγές». */
  lin: number | null;
  kind: MatchKind;
  code: string;
  name: string;
  score: number;
  /** code2 | code1 | code | name | memory | ai */
  by: string;
  /** Ο χαρακτηρισμός myDATA του ΜΗΤΡΩΟΥ σε ελληνικά (null = δεν έχει). */
  myData?: string | null;
  /** `true` όταν το μητρώο δεν κουβαλά κανέναν χαρακτηρισμό — θα καταχωριστεί αχαρακτήριστη. */
  noClass?: boolean;
}
export interface ItemQueueLine {
  id: string;
  docId: string;
  fileName: string | null;
  name: string;
  quantity: number | null;
  price: number | null;
  total: number | null;
}
export interface ItemQueueGroup {
  key: string;
  afm: string;
  supplier: string | null;
  pattern: string;
  sample: string;
  code: string | null;
  lineCount: number;
  docCount: number;
  /**
   * Ο τύπος μητρώου της ομάδας — **`null` = «χωρίς κατηγορία»**. Δεν είναι προεπιλογή που
   * λείπει: είναι ρητή δήλωση ότι ΔΕΝ υπάρχει απόδειξη. Δες `lib/ocr/line-kind.ts`.
   */
  category: MatchKind | null;
  suggestions: QueueSuggestion[];
  lines: ItemQueueLine[];
  /** TRDR του εκδότη — για να δείξουμε πρώτα τα έργα του. */
  trdr: number | null;
  /** Η αναλυτική που θυμάται ο κανόνας της ομάδας — ΠΡΟΤΑΣΗ, όχι γραμμένη τιμή. */
  remembered: RememberedAnalytics | null;
  /**
   * Η **αιτιολόγηση** του μοντέλου για την κατηγορία («παροχή τρίτων, ομάδα 62 — …»). Γράφεται
   * μόνο από το UI μετά από «Πρόταση με AI»: ο server δεν καλεί ποτέ μοντέλο μόνος του.
   */
  aiReason?: string | null;
}

/** Πόσες γραμμές-δείγμα επιστρέφονται ανά ομάδα. */
const GROUP_LINES_SAMPLE = 8;

const dec = (v: unknown): number | null => (v == null ? null : num(v.toString()));

type UnmatchedLine = {
  id: string;
  documentId: string;
  code: string | null;
  name: string;
  quantity: unknown;
  price: unknown;
  total: unknown;
  softoneIsService: boolean | null;
  vatRate?: unknown;
};
type QueueDocInfo = {
  fileName: string | null;
  afm: string;
  supplier: string | null;
  trdr: number | null;
  /** Ο πίνακας γραμμών του προορισμού της σειράς — ορίζει σε ποιο μητρώο ανήκει η γραμμή. */
  lineTable: PostLineTable | null;
  /** Η ετικέτα τύπου του συναλλασσομένου («Πιστωτής»…) — συμφραζόμενο για το μοντέλο. */
  traderKind: string | null;
};

/** Οι εκκρεμείς γραμμές μαζί με τα στοιχεία εκδότη του παραστατικού τους. */
async function loadUnmatchedLines(): Promise<{
  lines: UnmatchedLine[];
  docs: Map<string, QueueDocInfo>;
  truncated: boolean;
}> {
  const lines = (await prisma.ocrInvoiceItem.findMany({
    where: UNMATCHED_LINE_WHERE,
    select: {
      id: true, documentId: true, code: true, name: true,
      quantity: true, price: true, total: true, softoneIsService: true, vatRate: true,
    },
    orderBy: { id: 'asc' },
    take: MAX_QUEUE_LINES,
  })) as unknown as UnmatchedLine[];

  const docIds = Array.from(new Set(lines.map((l) => l.documentId)));
  const docRows = docIds.length
    ? await prisma.ocrDocument.findMany({
        where: { id: { in: docIds } },
        select: {
          id: true, fileName: true, extractedData: true, softoneName: true, issuerAfm: true,
          softoneTrdr: true, softoneSeries: true, seriesSource: true, softoneKind: true,
        },
      })
    : [];
  // Ο ΠΡΟΟΡΙΣΜΟΣ της σειράς κάθε παραστατικού: ο πίνακας γραμμών ορίζει σε ποιο μητρώο πρέπει να
  // δείχνει η γραμμή (LINLINES → χρεοπίστωση, EXPANAL → έξοδο…). Μία ανάγνωση για όλα.
  const targets = await postingTargetsForSeries(docRows);
  const docs = new Map<string, QueueDocInfo>();
  for (const d of docRows) {
    const ed = (d.extractedData ?? {}) as Record<string, unknown>;
    const key = seriesKey(d);
    docs.set(d.id, {
      fileName: d.fileName ?? null,
      // Το ΑΦΜ εκδότη έρχεται από τη στήλη· το JSON μένει μόνο για την επωνυμία-εφεδρεία.
      afm: d.issuerAfm ?? '',
      supplier: d.softoneName ?? str(ed.companyName),
      // Ο TRDR του εκδότη επιτρέπει να δείξουμε πρώτα τα ΕΡΓΑ ΤΟΥ (PRJC.TRDR).
      trdr: d.softoneTrdr ?? null,
      lineTable: (key ? targets.get(key)?.lines : null) ?? null,
      traderKind: d.softoneKind ?? null,
    });
  }
  return { lines, docs, truncated: lines.length >= MAX_QUEUE_LINES };
}

/**
 * Οι εκκρεμείς γραμμές ομαδοποιημένες κατά (ΑΦΜ εκδότη, κανονικοποιημένο κείμενο).
 * Προτάσεις υπολογίζονται μόνο για τις πρώτες `suggestFor` ομάδες — οι υπόλοιπες
 * τις ζητούν lazy από το `GET …/suggest`.
 */
export async function loadItemQueue(opts: { suggestFor?: number } = {}): Promise<{
  groups: ItemQueueGroup[];
  total: number;
  truncated: boolean;
}> {
  const suggestFor = opts.suggestFor ?? DEFAULT_SUGGEST_GROUPS;
  const { lines, docs, truncated } = await loadUnmatchedLines();
  const byId = new Map(lines.map((l) => [l.id, l]));

  const grouped = groupLines(lines.map((l) => ({
    id: l.id,
    afm: docs.get(l.documentId)?.afm ?? '',
    docId: l.documentId,
    name: l.name,
    code: l.code,
  })));

  // Η αναλυτική που θυμάται κάθε ομάδα, με ΜΙΑ ερώτηση για όλες τις ομάδες μαζί (και τρεις για
  // τις ετικέτες): μια ερώτηση ανά ομάδα θα ήταν δεκάδες round-trips σε κάθε φόρτωση σελίδας.
  const rememberedByKey = await loadRememberedAnalytics(grouped.map((g) => ({ afm: g.afm, pattern: g.pattern })));

  const groups: ItemQueueGroup[] = [];
  for (let i = 0; i < grouped.length; i++) {
    const g = grouped[i];
    const groupLinesData = g.lineIds
      .map((id) => byId.get(id))
      .filter((l): l is UnmatchedLine => Boolean(l));
    const suggestions = i < suggestFor
      ? await suggestForGroup({ afm: g.afm, pattern: g.pattern, code: g.code, sample: g.sample })
      : [];
    groups.push({
      key: g.key,
      afm: g.afm,
      supplier: docs.get(groupLinesData[0]?.documentId ?? '')?.supplier ?? null,
      pattern: g.pattern,
      sample: g.sample,
      code: g.code,
      lineCount: g.lineIds.length,
      docCount: g.docCount,
      category: inferCategory(groupLinesData, suggestions, docs, g.sample),
      suggestions,
      trdr: docs.get(groupLinesData[0]?.documentId ?? '')?.trdr ?? null,
      remembered: rememberedByKey.get(`${g.afm}|${g.pattern}`) ?? null,
      lines: groupLinesData.slice(0, GROUP_LINES_SAMPLE).map((l) => ({
        id: l.id,
        docId: l.documentId,
        fileName: docs.get(l.documentId)?.fileName ?? null,
        name: l.name,
        quantity: dec(l.quantity),
        price: dec(l.price),
        total: dec(l.total),
      })),
    });
  }
  // Το πλαφόν γραμμών χτύπησε: υπάρχουν κι άλλες εκκρεμείς ομάδες πέρα από αυτές εδώ.
  return { groups, total: groups.length, truncated };
}

/**
 * Η κατηγορία της ομάδας από ΝΤΕΤΕΡΜΙΝΙΣΤΙΚΕΣ ενδείξεις — `null` όταν δεν υπάρχει καμία.
 *
 * Η παλιά έκδοση επέστρεφε σταθερά `'product'` όταν δεν ήξερε, κι έτσι ΚΑΘΕ αταίριαστη γραμμή
 * — από χρέωση cloud μέχρι ψωμί ταβέρνας — εμφανιζόταν ως «Προϊόν» με σιγουριά. Δες
 * `lib/ocr/line-kind.ts` για τη σειρά των ενδείξεων και για το γιατί δεν μαντεύουμε.
 */
function inferCategory(
  lines: { softoneIsService: boolean | null; documentId: string }[],
  suggestions: QueueSuggestion[],
  docs: Map<string, QueueDocInfo>,
  sample: string,
): MatchKind | null {
  const memory = suggestions.find((s) => s.by === 'memory');
  return inferLineKind({
    memoryKind: memory?.kind ?? null,
    matchedService: lines.some((l) => l.softoneIsService === true),
    lineTables: Array.from(new Set(lines.map((l) => docs.get(l.documentId)?.lineTable ?? null))),
    sample,
  });
}

/** Τα δύο μεγαλύτερα «ουσιαστικά» tokens του pattern (≥ 4 χαρακτήρες). */
function searchTokens(pattern: string): string[] {
  return Array.from(new Set(pattern.split(/\s+/).filter((t) => t.length >= MIN_TOKEN)))
    .sort((a, b) => b.length - a.length)
    .slice(0, MAX_TOKENS);
}

/**
 * Τα `%` και `_` είναι wildcards του LIKE: αν περάσουν αυτούσια στο `contains`, μια
 * περιγραφή σαν «ΕΚΠΤΩΣΗ 20%» ταιριάζει με τα πάντα. Διαφυγή με backslash (το default
 * escape character του Postgres), με το ίδιο το backslash να διαφεύγει πρώτο.
 */
const likeEscape = (s: string): string => s.replace(/[\\%_]/g, (ch) => `\\${ch}`);

const itemCandidate = (i: {
  mtrl: number; code: string; code1: string | null; code2: string | null; name: string; isService: boolean;
}): MatchCandidate => ({
  id: `mtrl:${i.mtrl}`,
  kind: i.isService ? 'service' : 'product',
  code: i.code, name: i.name, code1: i.code1, code2: i.code2,
});
const expenseCandidate = (e: { expn: number; code: string; name: string }): MatchCandidate => ({
  id: `expn:${e.expn}`, kind: 'expense', code: e.code, name: e.name, code1: null, code2: null,
});
const lineItemCandidate = (l: { mtrl: number; code: string; name: string }): MatchCandidate => ({
  id: `lin:${l.mtrl}`, kind: 'lineitem', code: l.code, name: l.name, code1: null, code2: null,
});

const toSuggestion = (c: MatchCandidate & { score: number; by: string }): QueueSuggestion => ({
  mtrl: c.id.startsWith('mtrl:') ? Number(c.id.slice(5)) : null,
  expn: c.id.startsWith('expn:') ? Number(c.id.slice(5)) : null,
  lin: c.id.startsWith('lin:') ? Number(c.id.slice(4)) : null,
  kind: c.kind, code: c.code, name: c.name, score: c.score, by: c.by,
});

/**
 * Προτάσεις για μια ομάδα: (1) μνήμη `LineMatchRule` (σκορ {@link MEMORY_SCORE}),
 * (2) ίδιος κωδικός/barcode, (3) ομοιότητα ονόματος (Dice) σε είδη/υπηρεσίες/έξοδα.
 * Η αναζήτηση υποψηφίων είναι φραγμένη ({@link CANDIDATE_TAKE}).
 */
export async function suggestForGroup(input: {
  afm: string;
  pattern: string;
  code?: string | null;
  sample?: string | null;
}): Promise<QueueSuggestion[]> {
  const afm = String(input.afm ?? '').trim();
  const pattern = String(input.pattern ?? '').trim();
  if (!pattern) return [];
  const code = str(input.code);
  const tokens = searchTokens(pattern);

  const itemOr: Prisma.SoftoneItemWhereInput[] = [];
  const expenseOr: Prisma.SoftoneExpenseWhereInput[] = [];
  const linOr: Prisma.SoftoneLineItemWhereInput[] = [];
  if (code) {
    itemOr.push({ code: { in: [code] } }, { code1: { in: [code] } }, { code2: { in: [code] } });
    expenseOr.push({ code: { in: [code] } });
    linOr.push({ code: { in: [code] } });
  }
  for (const t of tokens) {
    const safe = likeEscape(t);
    itemOr.push({ name: { contains: safe, mode: 'insensitive' } });
    expenseOr.push({ name: { contains: safe, mode: 'insensitive' } });
    linOr.push({ name: { contains: safe, mode: 'insensitive' } });
  }

  const [items, expenses, lineItems, rules] = await Promise.all([
    itemOr.length
      ? prisma.softoneItem.findMany({
          where: { isActive: true, OR: itemOr },
          select: { mtrl: true, code: true, code1: true, code2: true, name: true, isService: true, myDataCode: true },
          take: CANDIDATE_TAKE,
        })
      : Promise.resolve([]),
    expenseOr.length
      ? prisma.softoneExpense.findMany({
          where: { isActive: true, OR: expenseOr },
          select: { expn: true, code: true, name: true, classTypeX: true, classCategoryX: true },
          take: CANDIDATE_TAKE,
        })
      : Promise.resolve([]),
    linOr.length
      ? prisma.softoneLineItem.findMany({
          where: { isActive: true, OR: linOr },
          select: { mtrl: true, code: true, name: true, classType: true, classCategory: true, myDataCode: true },
          take: CANDIDATE_TAKE,
        })
      : Promise.resolve([]),
    prisma.lineMatchRule.findMany({
      where: { pattern, afm: { in: afm ? [afm, ''] : [''] } },
      select: { afm: true, mtrl: true, expn: true, lin: true, isService: true },
    }),
  ]);

  const candidates: MatchCandidate[] = [
    ...items.map(itemCandidate),
    ...expenses.map(expenseCandidate),
    ...lineItems.map(lineItemCandidate),
  ];
  const scored = scoreCandidates({ code, name: input.sample ?? pattern }, candidates);
  // Ο χαρακτηρισμός myDATA είναι ιδιότητα του ΜΗΤΡΩΟΥ: τον δείχνουμε δίπλα στην πρόταση ώστε ο
  // χρήστης να ξέρει πώς θα χαρακτηριστεί η γραμμή πριν πατήσει «Αντιστοίχιση».
  const label = await cachedClassificationLabeller();
  const classOf = new Map<string, ClassificationRef>([
    ...items.map((i) => [`mtrl:${i.mtrl}`, { myDataCode: i.myDataCode }] as const),
    // Για παραστατικά που ΛΑΜΒΑΝΟΥΜΕ ισχύει το ζεύγος χαρακτηρισμού ΕΞΟΔΩΝ (…X).
    ...expenses.map((e) => [`expn:${e.expn}`, { classType: e.classTypeX, classCategory: e.classCategoryX }] as const),
    ...lineItems.map((l) => [`lin:${l.mtrl}`, { classType: l.classType, classCategory: l.classCategory, myDataCode: l.myDataCode }] as const),
  ]);
  const out: QueueSuggestion[] = scored.map((c) => {
    const cls = label(classOf.get(c.id) ?? {});
    return { ...toSuggestion(c), myData: cls.label, noClass: cls.missing };
  });

  // Ο κανόνας του εκδότη υπερισχύει του γενικού· η μνήμη μπαίνει πρώτη.
  const rule = rules.find((r) => r.afm !== '') ?? rules[0];
  if (rule && (rule.mtrl != null || rule.expn != null || rule.lin != null)) {
    const memory = await memorySuggestion(rule);
    if (memory) {
      const dup = out.findIndex((s) => s.mtrl === memory.mtrl && s.expn === memory.expn && s.lin === memory.lin);
      if (dup >= 0) out.splice(dup, 1);
      out.unshift(memory);
    }
  }
  return out.slice(0, 5);
}

async function memorySuggestion(rule: {
  mtrl: number | null; expn: number | null; lin: number | null; isService: boolean;
}): Promise<QueueSuggestion | null> {
  if (rule.lin != null) {
    const l = await prisma.softoneLineItem.findUnique({
      where: { mtrl: rule.lin },
      select: { mtrl: true, code: true, name: true },
    });
    if (!l) return null;
    return { mtrl: null, expn: null, lin: l.mtrl, kind: 'lineitem', code: l.code, name: l.name, score: MEMORY_SCORE, by: 'memory' };
  }
  if (rule.mtrl != null) {
    const i = await prisma.softoneItem.findUnique({
      where: { mtrl: rule.mtrl },
      select: { mtrl: true, code: true, name: true, isService: true },
    });
    if (!i) return null;
    return {
      mtrl: i.mtrl, expn: null, lin: null, kind: i.isService ? 'service' : 'product',
      code: i.code, name: i.name, score: MEMORY_SCORE, by: 'memory',
    };
  }
  if (rule.expn != null) {
    const e = await prisma.softoneExpense.findUnique({
      where: { expn: rule.expn },
      select: { expn: true, code: true, name: true },
    });
    if (!e) return null;
    return {
      mtrl: null, expn: e.expn, lin: null, kind: 'expense',
      code: e.code, name: e.name, score: MEMORY_SCORE, by: 'memory',
    };
  }
  return null;
}

/**
 * Οι συντελεστές ΦΠΑ των εκκρεμών γραμμών κάθε ομάδας, κλειδί `afm|pattern` — ΟΛΟΙ οι διαφορετικοί,
 * ταξινομημένοι (μια ομάδα μπορεί να έχει μικτούς). Διαβάζονται από τις ίδιες τις γραμμές στη βάση,
 * όχι από το σώμα του αιτήματος: το UI δεν είναι πηγή αλήθειας για τον ΦΠΑ. Γραμμή χωρίς ΦΠΑ δεν
 * συνεισφέρει τίποτα· ομάδα χωρίς κανέναν γνωστό ΦΠΑ λείπει από τον χάρτη.
 */
export async function groupVatRates(): Promise<Map<string, number[]>> {
  const { lines, docs } = await loadUnmatchedLines();
  const rateById = new Map<string, number>();
  for (const l of lines) {
    const n = l.vatRate == null || l.vatRate === '' ? NaN : Number(l.vatRate);
    if (Number.isFinite(n)) rateById.set(l.id, n);
  }
  const grouped = groupLines(lines.map((l) => ({
    id: l.id, afm: docs.get(l.documentId)?.afm ?? '', docId: l.documentId, name: l.name, code: l.code,
  })));
  const out = new Map<string, number[]>();
  for (const g of grouped) {
    const rates = [...new Set(g.lineIds.map((id) => rateById.get(id)).filter((r): r is number => r != null))]
      .sort((a, b) => a - b);
    if (rates.length) out.set(`${g.afm}|${g.pattern}`, rates);
  }
  return out;
}

/** Οι εκκρεμείς γραμμές μιας ομάδας (ΑΦΜ + pattern), όπως τη βλέπει η σελίδα. */
async function groupLineIds(afm: string, pattern: string): Promise<{ lineIds: string[]; docIds: string[] }> {
  const { lines, docs } = await loadUnmatchedLines();
  const grouped = groupLines(lines.map((l) => ({
    id: l.id,
    afm: docs.get(l.documentId)?.afm ?? '',
    docId: l.documentId,
    name: l.name,
    code: l.code,
  })));
  const g = grouped.find((x) => x.afm === String(afm ?? '').trim() && x.pattern === pattern);
  return g ? { lineIds: g.lineIds, docIds: g.docIds } : { lineIds: [], docIds: [] };
}

export interface MatchTarget {
  mtrl?: number | null;
  expn?: number | null;
  /** MTRL χρεοπίστωσης (`SoftoneLineItem`) — οι «Ειδικές συναλλαγές» δέχονται μόνο αυτό. */
  lin?: number | null;
}

/**
 * Η αναλυτική της γραμμής: κέντρο κόστους, έργο, κατηγορία δραστηριότητας. ΠΡΟΑΙΡΕΤΙΚΑ — και
 * μαθαίνονται με το ΙΔΙΟ κλειδί μνήμης (ΑΦΜ εκδότη + κανονικοποιημένο κείμενο), ώστε η δεύτερη
 * ίδια γραμμή να έρχεται ήδη συμπληρωμένη («αν το κάνει μια φορά να το θυμάται»).
 */
export interface LineAnalytics {
  costCntr?: number | null;
  prjc?: number | null;
  prjcStage?: number | null;
}

/** Η αναλυτική όπως τη θυμάται ο κανόνας μιας ομάδας — πρόταση, ποτέ σιωπηλή εγγραφή. */
export interface RememberedAnalytics {
  costCntr: number | null;
  prjc: number | null;
  prjcStage: number | null;
  /** Ετικέτες για το UI («ΚΚ01 — ΠΑΡΑΓΩΓΗ»), ώστε να μη φαίνονται σκέτοι αριθμοί. */
  labels: { costCntr: string | null; prjc: string | null; prjcStage: string | null };
}
export interface GroupMatchResult {
  linesUpdated: number;
  docIds: string[];
  mtrl: number | null;
  expn: number | null;
  lin: number | null;
  code: string | null;
  name: string | null;
  analytics: LineAnalytics;
}

/** Ένας στόχος αντιστοίχισης λυμένος πάνω στο τοπικό μητρώο — κωδικός, περιγραφή, φύση. */
export interface ResolvedMatch {
  mtrl: number | null;
  expn: number | null;
  lin: number | null;
  code: string | null;
  name: string | null;
  isService: boolean;
  kind: MatchKind;
}

/**
 * Διαβάζει τον στόχο (`mtrl` | `expn` | `lin`) από το τοπικό μητρώο SoftOne. ΜΙΑ πηγή
 * αλήθειας για την ουρά «Είδη & έξοδα» ΚΑΙ για τη σελίδα του παραστατικού: ίδιοι κωδικοί
 * σφάλματος, ίδιο `isService`, ίδια περιγραφή — ώστε οι δύο δρόμοι να μη διαφωνούν ποτέ.
 */
export async function resolveMatchTarget(target: MatchTarget, isServiceHint?: boolean): Promise<ResolvedMatch> {
  const mtrl = target.mtrl != null ? Number(target.mtrl) : null;
  const expn = target.expn != null ? Number(target.expn) : null;
  const lin = target.lin != null ? Number(target.lin) : null;
  if (mtrl == null && expn == null && lin == null) {
    throw new QueueError('missing_target', 'Δώσε είδος (mtrl), έξοδο (expn) ή χρεοπίστωση (lin).');
  }

  if (mtrl != null) {
    const item = await prisma.softoneItem.findUnique({ where: { mtrl } });
    if (!item) throw new QueueError('item_not_found', `Το είδος ${mtrl} δεν βρέθηκε στο μητρώο.`, 404);
    return {
      mtrl, expn: null, lin: null, code: item.code, name: item.name,
      isService: item.isService, kind: item.isService ? 'service' : 'product',
    };
  }
  if (lin != null) {
    const lineItem = await prisma.softoneLineItem.findUnique({ where: { mtrl: lin } });
    if (!lineItem) throw new QueueError('lineitem_not_found', `Η χρεοπίστωση ${lin} δεν βρέθηκε στο μητρώο.`, 404);
    // Μια χρεοπίστωση δεν είναι υπηρεσία: το flag αφορά μόνο τον διαχωρισμό ITELINES/SRVLINES.
    return { mtrl: null, expn: null, lin, code: lineItem.code, name: lineItem.name, isService: false, kind: 'lineitem' };
  }
  const expense = await prisma.softoneExpense.findUnique({ where: { expn: expn! } });
  if (!expense) throw new QueueError('expense_not_found', `Το έξοδο ${expn} δεν βρέθηκε στο μητρώο.`, 404);
  return {
    mtrl: null, expn, lin: null, code: expense.code, name: expense.name,
    isService: !!isServiceHint, kind: 'expense',
  };
}

/** Η αναλυτική είναι ανεξάρτητη από το τι ταίριαξε: `null` σημαίνει «κανένα», και γράφεται. */
export function normalizeAnalytics(a: LineAnalytics | undefined): LineAnalytics {
  const num0 = (v: number | null | undefined): number | null => (v == null || Number(v) <= 0 ? null : Number(v));
  return { costCntr: num0(a?.costCntr), prjc: num0(a?.prjc), prjcStage: num0(a?.prjcStage) };
}

/** Τα πεδία αντιστοίχισης μιας γραμμής — γράφονται ΜΑΖΙ, ποτέ μισά. */
function lineMatchData(m: ResolvedMatch, analytics: LineAnalytics) {
  return {
    softoneMtrl: m.mtrl, softoneExpn: m.expn, softoneLinMtrl: m.lin,
    softoneCode: m.code, softoneName: m.name,
    softoneIsService: m.isService, softoneMatchedBy: 'manual',
    softoneCostCntr: analytics.costCntr, softonePrjc: analytics.prjc, softonePrjcStage: analytics.prjcStage,
  };
}

/**
 * Γράφει τη ΜΝΗΜΗ μιας χειροκίνητης απόφασης: `LineMatchRule`, unique `afm + pattern`
 * (γενικός κανόνας = `afm: ''`). Είναι το ΜΟΝΟ σημείο που γράφει αυτόν τον κανόνα, ώστε η
 * ουρά «Είδη & έξοδα» και η σελίδα του παραστατικού να παράγουν ΤΟ ΙΔΙΟ κλειδί και το ίδιο
 * περιεχόμενο — αυτό είναι που κάνει το επόμενο παραστατικό του ίδιου εκδότη να συμπληρώνεται
 * μόνο του (το πέρασμα μνήμης του `matchDocItems`).
 *
 * Ο ΑΦΜ πρέπει να είναι ΠΑΝΤΑ το `OcrDocument.issuerAfm` (κανονικοποιημένο, με πρόθεμα χώρας
 * όπου υπάρχει) — όχι κάποια δεύτερη παραγωγή από το JSON.
 */
export async function rememberLineMatch(input: {
  afm: string;
  pattern: string;
  match: ResolvedMatch;
  analytics: LineAnalytics;
  userId?: string | null;
}): Promise<void> {
  const afm = String(input.afm ?? '').trim();
  const pattern = String(input.pattern ?? '').trim();
  if (!pattern) return;
  const { mtrl, expn, lin, isService } = input.match;
  // ΜΟΝΟ ρητή επιλογή στόχου από άνθρωπο φτάνει εδώ ⇒ `targetSource: 'manual'`.
  // Ο κανόνας ξαναχρησιμοποιήθηκε (ο χρήστης επιβεβαίωσε την ίδια αντιστοίχιση): +1 χρήση.
  // Το `update` γράφει ΚΑΙ τα τρία πεδία στόχου, οπότε αλλαγή γνώμης (είδος → έξοδο) σβήνει
  // τον παλιό στόχο αντί να αφήσει δύο.
  await prisma.lineMatchRule.upsert({
    where: { afm_pattern: { afm, pattern } },
    update: { mtrl, expn, lin, isService, ...input.analytics, targetSource: 'manual', timesUsed: { increment: 1 } },
    create: { afm, pattern, mtrl, expn, lin, isService, ...input.analytics, targetSource: 'manual', createdById: input.userId ?? null },
  });
}

/**
 * Η μνήμη μιας αλλαγής ΜΟΝΟ αναλυτικής. Τρεις απαγορεύσεις, ανεξάρτητα από το ποιος διάλεξε τον
 * στόχο της γραμμής (άνθρωπος ή αυτόματη αντιστοίχιση):
 *  1. ΠΟΤΕ δεν αλλάζει τον στόχο (`mtrl`/`expn`/`lin`) ενός κανόνα — η αναλυτική δεν είναι απόφαση
 *     για το «σε τι ταιριάζει» η γραμμή. (Πριν: σε γραμμή `manual` ξαναέγραφε τον ΠΑΛΙΟ στόχο της
 *     γραμμής πάνω σε νεότερο ανθρώπινο κανόνα και ανέβαζε το `timesUsed`.)
 *  2. Ενημερώνει την αναλυτική ΜΟΝΟ αν ο κανόνας δείχνει στον ΙΔΙΟ στόχο με τη γραμμή. Αλλιώς ένα
 *     έργο που ορίστηκε για τη χρεοπίστωση Χ θα κολλούσε σε κανόνα → έξοδο Ε και το πέρασμα μνήμης
 *     θα το μετέφερε σε κάθε μελλοντική γραμμή Ε (όπου το EXPANAL το πετά σιωπηλά), ή το κέντρο
 *     κόστους της Χ θα απλωνόταν σε κάθε μελλοντική γραμμή της Υ.
 *  3. ΠΟΤΕ δεν δημιουργεί κανόνα: ένας νέος κανόνας θα κατέγραφε ως μνήμη έναν στόχο που κανείς δεν
 *     επέλεξε σε αυτή την ενέργεια.
 * Επιστρέφει `true` μόνο όταν ενημερώθηκε πράγματι κανόνας.
 */
export async function rememberAnalyticsOnly(input: {
  afm: string;
  pattern: string;
  target: { mtrl: number | null; expn: number | null; lin: number | null };
  analytics: LineAnalytics;
}): Promise<boolean> {
  const afm = String(input.afm ?? '').trim();
  const pattern = String(input.pattern ?? '').trim();
  if (!pattern) return false;
  const rule = await prisma.lineMatchRule.findUnique({
    where: { afm_pattern: { afm, pattern } },
    select: { id: true, mtrl: true, expn: true, lin: true },
  });
  if (!rule) return false;
  const t = input.target;
  if ((rule.mtrl ?? null) !== (t.mtrl ?? null) || (rule.expn ?? null) !== (t.expn ?? null) || (rule.lin ?? null) !== (t.lin ?? null)) {
    return false;
  }
  await prisma.lineMatchRule.update({ where: { id: rule.id }, data: { ...input.analytics } });
  return true;
}

/**
 * Εφαρμόζει μία αντιστοίχιση σε ΟΛΕΣ τις γραμμές της ομάδας, γράφει τη μνήμη
 * (`LineMatchRule`, unique `afm+pattern` — γενικός κανόνας = `afm: ''`) και
 * ξαναϋπολογίζει τα σύνολα γραμμών των παραστατικών που άγγιξε.
 */
export async function applyMatchToGroup(input: {
  afm: string;
  pattern: string;
  target: MatchTarget;
  isService?: boolean;
  analytics?: LineAnalytics;
  userId?: string | null;
}): Promise<GroupMatchResult> {
  const afm = String(input.afm ?? '').trim();
  const pattern = String(input.pattern ?? '').trim();
  if (!pattern) throw new QueueError('missing_pattern', 'Λείπει το κείμενο της ομάδας.');

  const match = await resolveMatchTarget(input.target, input.isService);
  const { mtrl, expn, lin, code, name } = match;
  const analytics = normalizeAnalytics(input.analytics);

  const { lineIds, docIds } = await groupLineIds(afm, pattern);
  // Καμία γραμμή: η ομάδα έφυγε από την ουρά όσο ο χρήστης αποφάσιζε (άλλη καρτέλα, νέα
  // σάρωση). Δεν γράφουμε μνήμη για ομάδα-φάντασμα — θα «διόρθωνε» γραμμές που κανείς δεν είδε.
  if (lineIds.length === 0) {
    return { linesUpdated: 0, docIds, mtrl, expn, lin, code, name, analytics };
  }

  await prisma.ocrInvoiceItem.updateMany({
    where: { id: { in: lineIds } },
    data: lineMatchData(match, analytics),
  });

  // Ο χρήστης διάλεξε ΡΗΤΑ αυτόν τον στόχο στην ουρά.
  await rememberLineMatch({ afm, pattern, match, analytics, userId: input.userId });

  await refreshDocTallies(docIds);
  return { linesUpdated: lineIds.length, docIds, mtrl, expn, lin, code, name, analytics };
}

/** Το αποτέλεσμα μιας αντιστοίχισης ΜΙΑΣ γραμμής, από τη σελίδα του παραστατικού. */
export interface LineMatchResult extends ResolvedMatch {
  lineId: string;
  docId: string;
  /** ΑΦΜ εκδότη και κανονικοποιημένο κείμενο — το κλειδί της μνήμης που γράφτηκε. */
  afm: string;
  pattern: string;
  /** `false` όταν το κείμενο της γραμμής κανονικοποιείται σε κενό (δεν υπάρχει κλειδί μνήμης). */
  remembered: boolean;
  analytics: LineAnalytics;
}

/**
 * Αντιστοιχίζει ΜΙΑ γραμμή παραστατικού — η ενέργεια της σελίδας `/admin/ocr/<id>`.
 *
 * Γράφει τα ΙΔΙΑ πεδία και την ΙΔΙΑ μνήμη με την ουρά: ο ΑΦΜ βγαίνει από το
 * `OcrDocument.issuerAfm` του ΙΔΙΟΥ παραστατικού και το pattern από το `normalizeLineText`
 * του κειμένου της γραμμής — ακριβώς όπως τα παράγει η ομαδοποίηση της ουράς. Έτσι μια
 * απόφαση εδώ «εκπαιδεύει» το επόμενο παραστατικό του ίδιου εκδότη και το αντίστροφο.
 */
export async function applyMatchToLine(input: {
  lineId: string;
  target: MatchTarget;
  isService?: boolean;
  analytics?: LineAnalytics;
  userId?: string | null;
}): Promise<LineMatchResult> {
  const lineId = String(input.lineId ?? '').trim();
  if (!lineId) throw new QueueError('missing_lineId', 'Λείπει η γραμμή.');

  const line = await prisma.ocrInvoiceItem.findUnique({
    where: { id: lineId },
    select: { id: true, documentId: true, name: true },
  });
  if (!line) throw new QueueError('line_not_found', 'Η γραμμή δεν βρέθηκε.', 404);

  const match = await resolveMatchTarget(input.target, input.isService);
  const analytics = normalizeAnalytics(input.analytics);

  const doc = await prisma.ocrDocument.findUnique({
    where: { id: line.documentId },
    select: { issuerAfm: true },
  });
  // Ίδιο κλειδί με την ουρά: `issuerAfm` (όχι δεύτερη παραγωγή από το JSON) + normalizeLineText.
  const afm = doc?.issuerAfm ?? '';
  const pattern = normalizeLineText(line.name);

  await prisma.ocrInvoiceItem.update({
    where: { id: lineId },
    data: lineMatchData(match, analytics),
  });

  // Ο χρήστης διάλεξε ΡΗΤΑ αυτόν τον στόχο στη σελίδα του παραστατικού.
  if (pattern) await rememberLineMatch({ afm, pattern, match, analytics, userId: input.userId });

  await refreshDocTallies([line.documentId]);
  return { ...match, lineId, docId: line.documentId, afm, pattern, remembered: !!pattern, analytics };
}

/**
 * Γράφει ΜΟΝΟ την αναλυτική (κέντρο κόστους / έργο / δραστηριότητα) μιας γραμμής, χωρίς να
 * αγγίξει την αντιστοίχισή της — η δεύτερη μισή δουλειά που κάνει ο χρήστης πάνω στο
 * παραστατικό. Αν η γραμμή έχει ήδη στόχο, η επιλογή μπαίνει και στη ΜΝΗΜΗ με το ίδιο
 * κλειδί, ώστε να έρθει συμπληρωμένη στο επόμενο παραστατικό.
 *
 * Τα τρία πεδία είναι ΠΡΟΑΙΡΕΤΙΚΑ στο SoftOne: κενό δεν εμποδίζει ποτέ καταχώριση.
 */
export async function applyAnalyticsToLine(input: {
  lineId: string;
  analytics?: LineAnalytics;
  userId?: string | null;
}): Promise<{ lineId: string; docId: string; analytics: LineAnalytics; remembered: boolean }> {
  const lineId = String(input.lineId ?? '').trim();
  if (!lineId) throw new QueueError('missing_lineId', 'Λείπει η γραμμή.');

  const line = await prisma.ocrInvoiceItem.findUnique({
    where: { id: lineId },
    select: {
      id: true, documentId: true, name: true,
      softoneMtrl: true, softoneExpn: true, softoneLinMtrl: true,
      softoneCode: true, softoneName: true, softoneIsService: true,
    },
  });
  if (!line) throw new QueueError('line_not_found', 'Η γραμμή δεν βρέθηκε.', 404);

  const analytics = normalizeAnalytics(input.analytics);
  const empty = analytics.costCntr == null && analytics.prjc == null && analytics.prjcStage == null;
  // Το έξοδο καταχωρείται σε `EXPANAL`, που ΔΕΝ έχει πεδία αναλυτικής. Μια τιμή εκεί θα
  // γραφόταν στη βάση και θα χανόταν σιωπηλά στην αποστολή — καλύτερα να το πούμε.
  if (line.softoneExpn != null && !empty) {
    throw new QueueError(
      'analytics_unsupported',
      'Η γραμμή καταχωρείται σε «Ανάλυση εξόδων», που δεν έχει κέντρο κόστους / έργο / δραστηριότητα.',
    );
  }

  await prisma.ocrInvoiceItem.update({
    where: { id: lineId },
    data: {
      softoneCostCntr: analytics.costCntr, softonePrjc: analytics.prjc, softonePrjcStage: analytics.prjcStage,
    },
  });

  // Χωρίς στόχο δεν υπάρχει κανόνας να θυμηθεί. Με στόχο: ΜΟΝΟ ενημέρωση αναλυτικής σε ΥΠΑΡΧΟΝΤΑ
  // κανόνα με ΤΟΝ ΙΔΙΟ στόχο — ποτέ αλλαγή στόχου, ποτέ νέος κανόνας (`rememberAnalyticsOnly`).
  const hasTarget = line.softoneMtrl != null || line.softoneExpn != null || line.softoneLinMtrl != null;
  const pattern = hasTarget ? normalizeLineText(line.name) : '';
  let remembered = false;
  if (hasTarget && pattern) {
    const doc = await prisma.ocrDocument.findUnique({ where: { id: line.documentId }, select: { issuerAfm: true } });
    remembered = await rememberAnalyticsOnly({
      afm: doc?.issuerAfm ?? '',
      pattern,
      target: { mtrl: line.softoneMtrl, expn: line.softoneExpn, lin: line.softoneLinMtrl },
      analytics,
    });
  }

  return { lineId, docId: line.documentId, analytics, remembered };
}

/**
 * Καθαρίζει την αντιστοίχιση ΜΙΑΣ γραμμής: η γραμμή γυρίζει στην ουρά «Είδη & έξοδα».
 *
 * Καθαρίζονται ΚΑΙ το έξοδο ΚΑΙ η χρεοπίστωση (αλλιώς η γραμμή έμενε «αντιστοιχισμένη» και
 * δεν επέστρεφε ποτέ στην ουρά) ΚΑΙ η αναλυτική: κέντρο κόστους / έργο / δραστηριότητα
 * επιλέχθηκαν ΓΙΑ ΤΗΝ ΠΡΟΗΓΟΥΜΕΝΗ αντιστοίχιση και δεν πρέπει να ταξιδέψουν αθόρυβα μαζί με
 * τον επόμενο κωδικό. Η ΜΝΗΜΗ δεν σβήνεται εδώ — σβήνει/αλλάζει με την επόμενη απόφαση.
 */
export async function clearLineMatch(lineId: string): Promise<{ lineId: string; docId: string | null }> {
  const id = String(lineId ?? '').trim();
  if (!id) throw new QueueError('missing_lineId', 'Λείπει η γραμμή.');
  const line = await prisma.ocrInvoiceItem.findUnique({ where: { id }, select: { documentId: true } });
  await prisma.ocrInvoiceItem.update({
    where: { id },
    data: {
      softoneMtrl: null, softoneExpn: null, softoneLinMtrl: null, softoneCode: null,
      softoneName: null, softoneIsService: null, softoneMatchedBy: null,
      softoneCostCntr: null, softonePrjc: null, softonePrjcStage: null,
    },
  });
  if (line?.documentId) await refreshDocTallies([line.documentId]);
  return { lineId: id, docId: line?.documentId ?? null };
}

/**
 * Η αναλυτική που θυμάται ο κανόνας μιας ομάδας, με ελληνικές ετικέτες. Ο κανόνας του εκδότη
 * υπερισχύει του γενικού — ίδια προτεραιότητα με τις προτάσεις είδους.
 */
export async function rememberedAnalytics(input: { afm: string; pattern: string }): Promise<RememberedAnalytics | null> {
  const afm = String(input.afm ?? '').trim();
  const pattern = String(input.pattern ?? '').trim();
  if (!pattern) return null;
  const rules = await prisma.lineMatchRule.findMany({
    where: { pattern, afm: { in: afm ? [afm, ''] : [''] } },
    select: { afm: true, costCntr: true, prjc: true, prjcStage: true },
  });
  const rule = rules.find((r) => r.afm !== '') ?? rules[0];
  if (!rule || (rule.costCntr == null && rule.prjc == null && rule.prjcStage == null)) return null;

  const [cc, pj, st] = await Promise.all([
    rule.costCntr != null
      ? prisma.softoneCostCenter.findUnique({ where: { costcntr: rule.costCntr }, select: { code: true, name: true } })
      : Promise.resolve(null),
    rule.prjc != null
      ? prisma.softoneProject.findUnique({ where: { prjc: rule.prjc }, select: { code: true, name: true } })
      : Promise.resolve(null),
    rule.prjcStage != null
      ? prisma.softoneProjectStage.findUnique({ where: { prjcStage: rule.prjcStage }, select: { code: true, name: true } })
      : Promise.resolve(null),
  ]);
  const label = (r: { code: string; name: string } | null) => (r ? `${r.code} — ${r.name}` : null);
  return {
    costCntr: rule.costCntr, prjc: rule.prjc, prjcStage: rule.prjcStage,
    labels: { costCntr: label(cc), prjc: label(pj), prjcStage: label(st) },
  };
}

/**
 * Η ίδια πληροφορία με το {@link rememberedAnalytics}, για ΠΟΛΛΕΣ ομάδες με σταθερό αριθμό
 * ερωτημάτων: ένα για τους κανόνες και τρία για τις ετικέτες των μητρώων.
 */
export async function loadRememberedAnalytics(
  groups: { afm: string; pattern: string }[],
): Promise<Map<string, RememberedAnalytics>> {
  const out = new Map<string, RememberedAnalytics>();
  const patterns = Array.from(new Set(groups.map((g) => g.pattern).filter(Boolean)));
  if (patterns.length === 0) return out;
  const afms = Array.from(new Set(groups.map((g) => String(g.afm ?? '').trim()))).filter(Boolean);

  const rules = await prisma.lineMatchRule.findMany({
    where: { pattern: { in: patterns }, afm: { in: [...afms, ''] } },
    select: { afm: true, pattern: true, costCntr: true, prjc: true, prjcStage: true },
  });
  if (rules.length === 0) return out;

  const [ccRows, pjRows, stRows] = await Promise.all([
    prisma.softoneCostCenter.findMany({
      where: { costcntr: { in: uniqueIds(rules.map((r) => r.costCntr)) } },
      select: { costcntr: true, code: true, name: true },
    }),
    prisma.softoneProject.findMany({
      where: { prjc: { in: uniqueIds(rules.map((r) => r.prjc)) } },
      select: { prjc: true, code: true, name: true },
    }),
    prisma.softoneProjectStage.findMany({
      where: { prjcStage: { in: uniqueIds(rules.map((r) => r.prjcStage)) } },
      select: { prjcStage: true, code: true, name: true },
    }),
  ]);
  const label = (r: { code: string; name: string } | undefined) => (r ? `${r.code} — ${r.name}` : null);
  const ccBy = new Map(ccRows.map((r) => [r.costcntr, r]));
  const pjBy = new Map(pjRows.map((r) => [r.prjc, r]));
  const stBy = new Map(stRows.map((r) => [r.prjcStage, r]));

  for (const g of groups) {
    const afm = String(g.afm ?? '').trim();
    const mine = rules.filter((r) => r.pattern === g.pattern && (r.afm === afm || r.afm === ''));
    // Ο κανόνας του εκδότη υπερισχύει του γενικού — ίδια προτεραιότητα με τις προτάσεις είδους.
    const rule = mine.find((r) => r.afm !== '') ?? mine[0];
    if (!rule || (rule.costCntr == null && rule.prjc == null && rule.prjcStage == null)) continue;
    out.set(`${afm}|${g.pattern}`, {
      costCntr: rule.costCntr, prjc: rule.prjc, prjcStage: rule.prjcStage,
      labels: {
        costCntr: label(rule.costCntr != null ? ccBy.get(rule.costCntr) : undefined),
        prjc: label(rule.prjc != null ? pjBy.get(rule.prjc) : undefined),
        prjcStage: label(rule.prjcStage != null ? stBy.get(rule.prjcStage) : undefined),
      },
    });
  }
  return out;
}

const uniqueIds = (v: (number | null)[]): number[] =>
  Array.from(new Set(v.filter((x): x is number => x != null)));

/**
 * «Παράλειψη»: οι γραμμές της ομάδας βγαίνουν από την ουρά (`softoneMatchedBy: 'skipped'`)
 * χωρίς να γραφτεί κανόνας μνήμης — αναιρέσιμο από το UI της γραμμής.
 */
export async function skipGroup(input: { afm: string; pattern: string }): Promise<{ linesUpdated: number; docIds: string[] }> {
  const pattern = String(input.pattern ?? '').trim();
  if (!pattern) throw new QueueError('missing_pattern', 'Λείπει το κείμενο της ομάδας.');
  const { lineIds, docIds } = await groupLineIds(String(input.afm ?? '').trim(), pattern);
  if (lineIds.length > 0) {
    await prisma.ocrInvoiceItem.updateMany({
      where: { id: { in: lineIds } },
      data: { softoneMatchedBy: 'skipped' },
    });
  }
  return { linesUpdated: lineIds.length, docIds };
}

// ============================================================
// Μετρητές για τα badges του sidebar
// ============================================================

/**
 * Πλήθος ΟΜΑΔΩΝ της ουράς «Είδη & έξοδα» — ίδια ομαδοποίηση με τη σελίδα
 * (ΑΦΜ εκδότη + κανονικοποιημένο κείμενο) και ίδιο πλαφόν γραμμών, ώστε το badge
 * να λέει τον ίδιο αριθμό με τη λίστα. Κατεβάζει μόνο τα πεδία της ομαδοποίησης.
 */
async function countItemGroups(): Promise<number> {
  const lines = await prisma.ocrInvoiceItem.findMany({
    where: UNMATCHED_LINE_WHERE,
    select: { id: true, documentId: true, name: true, code: true },
    orderBy: { id: 'asc' },
    take: MAX_QUEUE_LINES,
  });
  if (lines.length === 0) return 0;

  const docIds = Array.from(new Set(lines.map((l) => l.documentId)));
  const docRows = await prisma.ocrDocument.findMany({
    where: { id: { in: docIds } },
    // Μόνο το indexed ΑΦΜ εκδότη — κανένα JSON.
    select: { id: true, issuerAfm: true },
  });
  const afmOf = new Map(docRows.map((d) => [d.id, d.issuerAfm ?? '']));

  return groupLines(lines.map((l) => ({
    id: l.id,
    afm: afmOf.get(l.documentId) ?? '',
    docId: l.documentId,
    name: l.name,
    code: l.code,
  }))).length;
}

/**
 * Φθηνοί μετρητές των δύο ουρών: διακριτά ΑΦΜ χωρίς συναλλασσόμενο (χωρίς τους
 * αγνοημένους) και πλήθος ΟΜΑΔΩΝ γραμμών — ό,τι ακριβώς μετρά και κάθε σελίδα.
 */
export async function countQueues(): Promise<{ traders: number; items: number }> {
  const [pending, ignoredRows, items] = await Promise.all([
    // ΙΔΙΟΣ κανόνας με τη σελίδα (`collectPendingTraderDocs`) και όχι ένα φθηνότερο `groupBy` σε
    // `softoneTrdr: null`: μετά την ανά τύπο εκκρεμότητα, ένα `groupBy` θα έλεγε άλλον αριθμό από
    // τη λίστα — ένα badge που δεν συμφωνεί με τη σελίδα του είναι χειρότερο από ένα ακριβό badge.
    collectPendingTraderDocs(),
    prisma.ignoredIssuer.findMany({ select: { afm: true } }),
    countItemGroups(),
  ]);
  const ignored = new Set(ignoredRows.map((r) => r.afm));
  const afms = new Set(
    pending.docs.map((d) => d.issuerAfm).filter((a): a is string => !!a && !ignored.has(a)),
  );
  return { traders: afms.size, items };
}
