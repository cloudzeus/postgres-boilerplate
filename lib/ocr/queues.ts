import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { normalizeAfm, vatCountry } from '@/lib/ocr/validate';
import { splitGluedAddress } from '@/lib/ocr/address';
import { refreshDocTallies } from '@/lib/ocr/softone-match';
import { loadDocumentJson, saveDocumentJson } from '@/lib/ocr/document';
import { setPath } from '@/lib/ocr/canonical';
import { SODTYPE_LABEL, TRADER_KIND_SODTYPE } from '@/lib/softone';
import {
  groupLines,
  scoreCandidates,
  suggestTraderKind,
  type MatchCandidate,
  type MatchKind,
} from '@/lib/ocr/line-match';
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
export const TRADER_KIND_LABEL: Record<'supplier' | 'creditor', string> = {
  supplier: SODTYPE_LABEL[TRADER_KIND_SODTYPE.supplier],
  creditor: SODTYPE_LABEL[TRADER_KIND_SODTYPE.creditor],
};

export interface TraderQueueDoc {
  id: string;
  fileName: string;
  date: string | null;
  total: number | null;
  series: string | null;
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
  suggestedKind: 'supplier' | 'creditor';
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
  seriesKinds: ('purchase' | 'creditor')[];
  invoiceKinds: (string | null)[];
  docs: TraderQueueDoc[];
}

const topName = (names: Map<string, number>): string | null => {
  let best: string | null = null;
  let bestN = 0;
  for (const [n, c] of names) if (c > bestN) { best = n; bestN = c; }
  return best;
};

/**
 * Ολοκληρωμένα έγγραφα χωρίς συναλλασσόμενο SoftOne, ομαδοποιημένα κατά ΑΦΜ εκδότη.
 * Οι αγνοημένοι (`IgnoredIssuer`) βγαίνουν από τις ομάδες και επιστρέφονται χωριστά
 * όταν ζητηθούν (φίλτρο «Αγνοημένοι» της σελίδας).
 */
export async function loadTraderQueue(opts: { includeIgnored?: boolean } = {}): Promise<{
  groups: TraderGroup[];
  ignored: IgnoredIssuerRow[];
  truncated: boolean;
}> {
  const [docs, ignoredRows] = await Promise.all([
    prisma.ocrDocument.findMany({
      // Το ΑΦΜ εκδότη είναι στήλη με index (`issuerAfm`): κανένα φιλτράρισμα πάνω σε JSON.
      where: {
        status: 'COMPLETED', softoneTrdr: null, softoneChecked: { not: null },
        issuerAfm: { not: null },
      },
      select: {
        id: true, fileName: true, thumbUrl: true, createdAt: true, extractedData: true,
        issuerAfm: true, softoneSeries: true, seriesSource: true, invoiceKind: true,
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_QUEUE_DOCS,
    }),
    prisma.ignoredIssuer.findMany({ select: { afm: true, reason: true } }),
  ]);

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
        docCount: 0, total: 0, lastDate: null, thumbUrl: null, seriesKinds: [], invoiceKinds: [], docs: [],
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
    if (doc.seriesSource != null) g.seriesKinds.push(doc.seriesSource === 1653 ? 'creditor' : 'purchase');
    g.invoiceKinds.push(doc.invoiceKind ?? null);
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
      suggestedKind: suggestTraderKind({ seriesKinds: g.seriesKinds, invoiceKinds: g.invoiceKinds }),
      docs: g.docs,
    });
  }
  // Αγνοημένοι χωρίς κανένα εκκρεμές έγγραφο: τους δείχνουμε κι αυτούς (αναιρέσιμο).
  for (const [afm, reason] of ignoredReason) {
    if (!acc.has(afm)) ignored.push({ afm, name: null, reason });
  }

  groups.sort((a, b) => (b.docCount - a.docCount) || (b.total - a.total) || a.afm.localeCompare(b.afm));
  // Το πλαφόν χτύπησε: η σελίδα βλέπει μέρος της ουράς (οι μετρητές του sidebar μένουν σωστοί).
  return { groups, ignored: opts.includeIgnored ? ignored : [], truncated: docs.length >= MAX_QUEUE_DOCS };
}

export interface TraderLink {
  trdr: number;
  code: string | null;
  name: string;
  kind: string;
}

/**
 * Γράφει τον συναλλασσόμενο σε ΟΛΑ τα έγγραφα του ΑΦΜ που δεν έχουν ήδη
 * αντιστοίχιση (spec §2: μία δημιουργία/σύνδεση ξεμπλοκάρει όλη την ομάδα).
 * Επιστρέφει πόσα ενημερώθηκαν.
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

  const where = { status: 'COMPLETED', softoneTrdr: null, issuerAfm: target } as const;
  const stamp = {
    softoneTrdr: trader.trdr,
    softoneCode: trader.code ?? null,
    softoneName: trader.name,
    softoneKind: trader.kind,
    softoneChecked: new Date(),
  };

  // Κοινή περίπτωση: ένα `updateMany` πάνω στο indexed `issuerAfm` — καμία
  // ανάγνωση/σάρωση JSON.
  if (!next) {
    const res = await prisma.ocrDocument.updateMany({ where, data: stamp });
    return res.count;
  }

  // Αλλαγή ΑΦΜ: το κανονικό έγγραφο είναι JSON, οπότε χρειάζεται read-modify-write ανά έγγραφο.
  // ΔΕΝ γράφουμε `issuerAfm`/`extractedData` με το χέρι — θα τα ξαναέφτιαχνε από το `document` η
  // επόμενη αποθήκευση και το πρόθεμα θα χανόταν. Ο συναλλασσόμενος ταξιδεύει ως `also`, δηλαδή
  // στο ΙΔΙΟ transaction με το έγγραφο: ένα έγγραφο δεν μένει ποτέ μισο-ενημερωμένο.
  const docs = await prisma.ocrDocument.findMany({ where, select: { id: true } });
  if (docs.length === 0) return 0;
  for (const d of docs) {
    const document = setPath(await loadDocumentJson(d.id), 'issuer.vat', next);
    await saveDocumentJson(d.id, document, { also: stamp });
  }
  return docs.length;
}

// ============================================================
// §3 — Ουρά «Είδη & έξοδα»
// ============================================================

/** Εκκρεμής = χωρίς είδος, έξοδο ή χρεοπίστωση, και χωρίς ρητή παράλειψη. */
const UNMATCHED_LINE_WHERE: Prisma.OcrInvoiceItemWhereInput = {
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
  category: MatchKind;
  suggestions: QueueSuggestion[];
  lines: ItemQueueLine[];
  /** TRDR του εκδότη — για να δείξουμε πρώτα τα έργα του. */
  trdr: number | null;
  /** Η αναλυτική που θυμάται ο κανόνας της ομάδας — ΠΡΟΤΑΣΗ, όχι γραμμένη τιμή. */
  remembered: RememberedAnalytics | null;
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
};
type QueueDocInfo = { fileName: string | null; afm: string; supplier: string | null; trdr: number | null };

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
      quantity: true, price: true, total: true, softoneIsService: true,
    },
    orderBy: { id: 'asc' },
    take: MAX_QUEUE_LINES,
  })) as unknown as UnmatchedLine[];

  const docIds = Array.from(new Set(lines.map((l) => l.documentId)));
  const docRows = docIds.length
    ? await prisma.ocrDocument.findMany({
        where: { id: { in: docIds } },
        select: { id: true, fileName: true, extractedData: true, softoneName: true, issuerAfm: true, softoneTrdr: true },
      })
    : [];
  const docs = new Map<string, QueueDocInfo>();
  for (const d of docRows) {
    const ed = (d.extractedData ?? {}) as Record<string, unknown>;
    docs.set(d.id, {
      fileName: d.fileName ?? null,
      // Το ΑΦΜ εκδότη έρχεται από τη στήλη· το JSON μένει μόνο για την επωνυμία-εφεδρεία.
      afm: d.issuerAfm ?? '',
      supplier: d.softoneName ?? str(ed.companyName),
      // Ο TRDR του εκδότη επιτρέπει να δείξουμε πρώτα τα ΕΡΓΑ ΤΟΥ (PRJC.TRDR).
      trdr: d.softoneTrdr ?? null,
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
      category: defaultCategory(groupLinesData, suggestions),
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

/** Προεπιλεγμένη κατηγορία: κανόνας μνήμης → `softoneIsService` των γραμμών → προϊόν. */
function defaultCategory(lines: { softoneIsService: boolean | null }[], suggestions: QueueSuggestion[]): MatchKind {
  const memory = suggestions.find((s) => s.by === 'memory');
  if (memory) return memory.kind;
  if (lines.some((l) => l.softoneIsService === true)) return 'service';
  return 'product';
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

  const mtrl = input.target.mtrl != null ? Number(input.target.mtrl) : null;
  const expn = input.target.expn != null ? Number(input.target.expn) : null;
  const lin = input.target.lin != null ? Number(input.target.lin) : null;
  if (mtrl == null && expn == null && lin == null) {
    throw new QueueError('missing_target', 'Δώσε είδος (mtrl), έξοδο (expn) ή χρεοπίστωση (lin).');
  }

  let code: string | null = null;
  let name: string | null = null;
  let isService = !!input.isService;
  if (mtrl != null) {
    const item = await prisma.softoneItem.findUnique({ where: { mtrl } });
    if (!item) throw new QueueError('item_not_found', `Το είδος ${mtrl} δεν βρέθηκε στο μητρώο.`, 404);
    code = item.code;
    name = item.name;
    isService = item.isService;
  } else if (lin != null) {
    const lineItem = await prisma.softoneLineItem.findUnique({ where: { mtrl: lin } });
    if (!lineItem) throw new QueueError('lineitem_not_found', `Η χρεοπίστωση ${lin} δεν βρέθηκε στο μητρώο.`, 404);
    code = lineItem.code;
    name = lineItem.name;
    // Μια χρεοπίστωση δεν είναι υπηρεσία: το flag αφορά μόνο τον διαχωρισμό ITELINES/SRVLINES.
    isService = false;
  } else {
    const expense = await prisma.softoneExpense.findUnique({ where: { expn: expn! } });
    if (!expense) throw new QueueError('expense_not_found', `Το έξοδο ${expn} δεν βρέθηκε στο μητρώο.`, 404);
    code = expense.code;
    name = expense.name;
  }

  // Η αναλυτική είναι ανεξάρτητη από το τι ταίριαξε: `null` σημαίνει «κανένα», και γράφεται.
  const num0 = (v: number | null | undefined): number | null => (v == null || Number(v) <= 0 ? null : Number(v));
  const analytics: LineAnalytics = {
    costCntr: num0(input.analytics?.costCntr),
    prjc: num0(input.analytics?.prjc),
    prjcStage: num0(input.analytics?.prjcStage),
  };

  const { lineIds, docIds } = await groupLineIds(afm, pattern);
  // Καμία γραμμή: η ομάδα έφυγε από την ουρά όσο ο χρήστης αποφάσιζε (άλλη καρτέλα, νέα
  // σάρωση). Δεν γράφουμε μνήμη για ομάδα-φάντασμα — θα «διόρθωνε» γραμμές που κανείς δεν είδε.
  if (lineIds.length === 0) {
    return { linesUpdated: 0, docIds, mtrl, expn, lin, code, name, analytics };
  }

  await prisma.ocrInvoiceItem.updateMany({
    where: { id: { in: lineIds } },
    data: {
      softoneMtrl: mtrl, softoneExpn: expn, softoneLinMtrl: lin, softoneCode: code, softoneName: name,
      softoneIsService: isService, softoneMatchedBy: 'manual',
      softoneCostCntr: analytics.costCntr, softonePrjc: analytics.prjc, softonePrjcStage: analytics.prjcStage,
    },
  });

  // Ο κανόνας ξαναχρησιμοποιήθηκε (ο χρήστης επιβεβαίωσε την ίδια αντιστοίχιση): +1 χρήση.
  await prisma.lineMatchRule.upsert({
    where: { afm_pattern: { afm, pattern } },
    update: { mtrl, expn, lin, isService, ...analytics, timesUsed: { increment: 1 } },
    create: { afm, pattern, mtrl, expn, lin, isService, ...analytics, createdById: input.userId ?? null },
  });

  await refreshDocTallies(docIds);
  return { linesUpdated: lineIds.length, docIds, mtrl, expn, lin, code, name, analytics };
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
  const [afmRows, ignoredRows, items] = await Promise.all([
    // `groupBy` πάνω στο indexed `issuerAfm`: τα διακριτά ΑΦΜ χωρίς να κατέβει ούτε ένα JSON.
    prisma.ocrDocument.groupBy({
      by: ['issuerAfm'],
      where: {
        status: 'COMPLETED', softoneTrdr: null, softoneChecked: { not: null },
        issuerAfm: { not: null },
      },
    }),
    prisma.ignoredIssuer.findMany({ select: { afm: true } }),
    countItemGroups(),
  ]);
  const ignored = new Set(ignoredRows.map((r) => r.afm));
  const traders = afmRows.filter((r) => r.issuerAfm && !ignored.has(r.issuerAfm)).length;
  return { traders, items };
}
