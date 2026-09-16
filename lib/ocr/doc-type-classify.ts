// lib/ocr/doc-type-classify.ts — PURE. Maps a scanned document to one of the ENABLED SoftOne series (spec 2026-09-11 §1).
import { n as toNumber } from './invoice-math';
import { SERIES_SIDE_LABEL, type SeriesTraderKind } from './posting-target';

/**
 * Η ΠΛΕΥΡΑ μιας σειράς — ίδια έννοια με το `SeriesTraderKind` του `posting-target.ts`, από όπου
 * και προκύπτει: αγορές/ειδικές συναλλαγές προμηθευτών, πιστωτών ή χρεωστών.
 */
export type SeriesKind = SeriesTraderKind;
export type SeriesCandidate = { code: string; abbrev: string | null; name: string; kind: SeriesKind; sosource: number };
export type Family = 'TPY' | 'TDA' | 'TIM' | 'DA' | 'PT' | 'APY' | 'ALP' | 'LOG';
export type ClassifyInput = { documentTypeLabel: string | null | undefined; issuerKind: 'supplier' | 'creditor' | 'debtor' | null; totalAmount: number | null | undefined; invoiceKind: 'service' | 'product' | 'mixed' | null | undefined };
export type ClassifyResult = { code: string; sosource: number; kind: SeriesKind; confidence: number; reason: string; tie: boolean; alternatives: { code: string; sosource: number; abbrev: string | null; name: string; score: number }[] };

// Τελεία ανάμεσα σε ΜΟΝΟΓΡΑΜΜΑΤΕΣ συντμήσεις σβήνεται («Δ.Α.» → «ΔΑ», «Τ.Δ.Α.» → «ΤΔΑ»)· τελεία πριν από
// ολόκληρη λέξη γίνεται κενό («Δ.ΑΠΟΣΤΟΛΗΣ» → «Δ ΑΠΟΣΤΟΛΗΣ», «ΤΙΜ. ΠΑΡΟΧΗΣ» → «ΤΙΜ ΠΑΡΟΧΗΣ»).
const ABBREV_DOT = /(?<=(?<![A-ZΑ-Ω])[A-ZΑ-Ω])\.(?=[A-ZΑ-Ω](?![A-ZΑ-Ω]))/g;
export function normalizeGreek(s: string): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(ABBREV_DOT, '').replace(/[^A-ZΑ-Ω0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
// Σύντμηση ως αυτοτελής λέξη. Το `\b` της JS δουλεύει μόνο με [A-Za-z0-9_], άρα ΔΕΝ πιάνει ποτέ
// ελληνικά (π.χ. /\bΤΠΥ\b/ δεν ταιριάζει στο «ΤΠΥ»): χρησιμοποιούμε lookarounds στο κανονικοποιημένο αλφάβητο.
const w = (abbrev: string) => `(?<![A-ZΑ-Ω0-9])${abbrev}(?![A-ZΑ-Ω0-9])`;
// «ΔΕΛΤΙΟ ΑΠΟΣΤΟΛΗΣ» ή η σύντμηση «Δ.ΑΠΟΣΤΟΛΗΣ» (→ «Δ ΑΠΟΣΤΟΛΗΣ» μετά την κανονικοποίηση).
const DELTIO = `(ΔΕΛΤΙΟ ΑΠΟΣΤΟΛ|${w('Δ')} ΑΠΟΣΤΟΛ)`;
// Order matters: more specific families first. Οι κανόνες ΑΠΥ/ΑΛΠ προηγούνται του ΤΠΥ, γιατί το ΤΠΥ
// πιάνει και σκέτο «ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙΩΝ» — η «ΑΠΟΔΕΙΞΗ ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙΩΝ» πρέπει να μείνει ΑΠΥ.
const FAMILY_RULES: [Family, RegExp][] = [
  ['PT', /ΠΙΣΤΩΤ|CREDIT NOTE|CREDIT INVOICE/],
  ['TDA', new RegExp(`(ΤΙΜΟΛΟΓΙΟ.*${DELTIO}|${DELTIO}.*ΤΙΜΟΛΟΓΙΟ|${w('ΤΔΑ')}|${w('ΤΔΑΠ')}|${w('ΔΑΤ')})`)],
  ['APY', new RegExp(`(ΑΠΟΔΕΙΞΗ ΠΑΡΟΧΗΣ|${w('ΑΠΥ')})`)],
  // Σκέτο «ΑΠΟΔΕΙΞΗ» τελευταίο: πέφτει εδώ μόνο αν δεν ταίριαξε ο ειδικός κανόνας ΑΠΥ παραπάνω.
  ['ALP', new RegExp(`(ΑΠΟΔΕΙΞΗ ΛΙΑΝΙΚ|${w('ΑΛΠ')}|RECEIPT|ΑΠΟΔΕΙΞΗ)`)],
  ['TPY', new RegExp(`(ΤΙΜΟΛΟΓΙΟ ΠΑΡΟΧΗΣ|ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙ|${w('ΤΠΥ')}|SERVICE INVOICE)`)],
  ['LOG', /(ΛΟΓΑΡΙΑΣΜΟΣ|ΕΚΚΑΘΑΡΙΣΤΙΚ|BILL)/],
  ['DA', new RegExp(`(${DELTIO}|${w('ΔΑ')}|DELIVERY NOTE)`)],
  ['TIM', new RegExp(`(ΤΙΜΟΛΟΓΙΟ|${w('ΤΙΜ')}|INVOICE|DEBIT NOTE)`)],
];
export function familyOf(label: string | null | undefined): Family | null {
  const n = normalizeGreek(label ?? ''); if (!n) return null;
  for (const [fam, re] of FAMILY_RULES) if (re.test(n)) return fam;
  return null;
}
/* ------------------------------------------------------------------ */
/* Ένδειξη τύπου από το ΟΝΟΜΑ ΑΡΧΕΙΟΥ                                  */
/* ------------------------------------------------------------------ */

/**
 * Σύντομες ενδείξεις τύπου όπως γράφονται σε ονόματα αρχείων, ως ΑΥΤΟΤΕΛΗ tokens →
 * ετικέτα που καταλαβαίνει το `familyOf`. Μόνο tokens που δίνουν οικογένεια: το «ΠΤ»
 * ή το «ΔΕΛΤΙΟ» σκέτα δεν ταιριάζουν σε κανέναν κανόνα, οπότε δεν μπαίνουν.
 */
const FILE_NAME_HINTS = new Map<string, string>([
  ['ΠΙΣΤΩΤΙΚΟ', 'ΠΙΣΤΩΤΙΚΟ'], ['ΤΔΑΠ', 'ΤΔΑΠ'], ['ΤΔΑ', 'ΤΔΑ'], ['ΔΑΤ', 'ΔΑΤ'],
  ['ΤΠΥ', 'ΤΠΥ'], ['ΑΠΥ', 'ΑΠΥ'], ['ΑΛΠ', 'ΑΛΠ'], ['ΔΑ', 'ΔΑ'],
  ['ΤΙΜΟΛΟΓΙΟ', 'ΤΙΜΟΛΟΓΙΟ'], ['ΤΙΜ', 'ΤΙΜ'], ['ΑΠΟΔΕΙΞΗ', 'ΑΠΟΔΕΙΞΗ'], ['ΛΟΓΑΡΙΑΣΜΟΣ', 'ΛΟΓΑΡΙΑΣΜΟΣ'],
  ['INVOICE', 'INVOICE'], ['INV', 'INVOICE'], ['RECEIPT', 'RECEIPT'], ['CREDIT', 'ΠΙΣΤΩΤΙΚΟ'],
]);

/**
 * ΑΔΥΝΑΜΗ ένδειξη τύπου από το όνομα αρχείου, για έγγραφα χωρίς τυπωμένο τύπο.
 * Καθαρή συνάρτηση. Δέχεται ΜΟΝΟ αυτοτελή tokens του basename — έτσι το «invoices/…»
 * (φάκελος) ή το «S1Prt_260129» δεν παράγουν ψεύτικη ένδειξη. Ο τύπος συχνά κολλάει
 * στον αριθμό («ΤΠΥ1032»), οπότε σπάμε και τα όρια γράμματος/ψηφίου.
 */
export function labelFromFileName(name: string | null | undefined): string | null {
  const base = String(name ?? '').split(/[\\/]/).pop() ?? '';
  const stem = base.replace(/\.[A-Za-z0-9]{1,5}$/, '');
  const spaced = normalizeGreek(stem)
    .replace(/(?<=[A-ZΑ-Ω])(?=[0-9])/g, ' ')
    .replace(/(?<=[0-9])(?=[A-ZΑ-Ω])/g, ' ');
  for (const token of spaced.split(' ')) {
    const hit = FILE_NAME_HINTS.get(token);
    if (hit) return hit;
  }
  return null;
}

/** Family of a SERIES from its abbrev + name (same lexicon). */
export function seriesFamily(c: SeriesCandidate): Family | null { return familyOf(`${c.abbrev ?? ''} ${c.name}`); }
const SERVICE_FAMILIES = new Set<Family>(['TPY', 'APY', 'LOG']);
const GOODS_FAMILIES = new Set<Family>(['TIM', 'TDA', 'DA']);
/** How well a document family fits a series family (0–1). */
function familyAffinity(doc: Family | null, series: Family | null): number {
  if (!doc || !series) return 0.2;
  if (doc === series) return 1;
  if (doc === 'LOG' && series === 'TPY') return 0.9;
  // Σκέτο «ΤΙΜΟΛΟΓΙΟ» ταιριάζει εξίσου σε σειρά ΤΠΥ («Τιμολόγιο Παροχής Υπηρεσιών»): η πλευρά
  // (αγορών/πιστωτών) κρίνεται από τον εκδότη ή το invoiceKind — αλλιώς είναι πραγματική ισοπαλία.
  if (doc === 'TIM' && series === 'TPY') return 1;
  if (doc === 'TDA' && series === 'TIM') return 0.6;
  if (doc === 'TIM' && series === 'TDA') return 0.5;
  if (doc === 'APY' && series === 'TPY') return 0.5;
  if (SERVICE_FAMILIES.has(doc) && SERVICE_FAMILIES.has(series)) return 0.4;
  if (GOODS_FAMILIES.has(doc) && GOODS_FAMILIES.has(series)) return 0.4;
  return 0.1;
}
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const TIE_GAP = 0.15;
const EPS = 1e-9;
export function classifySeries(input: ClassifyInput, candidates: SeriesCandidate[]): ClassifyResult | null {
  if (!candidates.length) return null;
  const docFam = familyOf(input.documentTypeLabel);
  const isCredit = docFam === 'PT' || (typeof input.totalAmount === 'number' && input.totalAmount < 0);
  // «mixed» δεν δείχνει πλευρά: το αντιμετωπίζουμε σαν άγνωστο περιεχόμενο (spec §1.2).
  const sideHint: SeriesKind | null = input.invoiceKind === 'service' ? 'creditor' : input.invoiceKind === 'product' ? 'purchase' : null;
  // Ο ΤΥΠΟΣ ΤΟΥ ΕΚΔΟΤΗ στο μητρώο είναι η μόνη σίγουρη ένδειξη πλευράς: προμηθευτής → αγορές,
  // πιστωτής → πιστωτών, χρεώστης → χρεωστών.
  const ISSUER_SIDE = { supplier: 'purchase', creditor: 'creditor', debtor: 'debtor' } as const;
  const wantedSide: SeriesKind | null = input.issuerKind ? ISSUER_SIDE[input.issuerKind] : null;
  const pool = wantedSide ? candidates.filter((c) => c.kind === wantedSide) : candidates;
  const emptyPool = !!wantedSide && !pool.length;
  const scored = (pool.length ? pool : candidates).map((c) => {
    const sf = seriesFamily(c);
    const creditSeries = sf === 'PT';
    // `base` = ταίριασμα ΜΟΝΟ από τον τύπο του εντύπου, πριν από οποιοδήποτε side hint.
    // Σε πιστωτικό με άγνωστο εκδότη οι πιστωτικές σειρές των δύο πλευρών βαθμολογούνται ίσα:
    // η ισοπαλία περνάει στο μοντέλο (spec §1.3), που κρίνει την πλευρά από το κείμενο.
    const base = isCredit ? (creditSeries ? 1 : 0.05) : (creditSeries ? 0.02 : familyAffinity(docFam, sf));
    let score = base;
    // Side hint when the issuer is unknown: services → creditors, goods → purchases.
    if (!input.issuerKind && sideHint) score += c.kind === sideHint ? 0.15 : -0.15;
    else if (!input.issuerKind && docFam && (SERVICE_FAMILIES.has(docFam) ? c.kind !== 'creditor' : GOODS_FAMILIES.has(docFam) ? c.kind !== 'purchase' : false)) score -= 0.1;
    return { c, sf, base, score };
  }).sort((a, b) => b.score - a.score);
  const best = scored[0]; const second = scored[1];
  // Το gap βγαίνει από τα ΑΚΑΘΑΡΙΣΤΑ (unclamped) σκορ: αλλιώς δύο υποψήφιες που ξεπερνούν το 1
  // (π.χ. 1,15 και 0,85) θα φαίνονταν κολλητές μετά το clamp και θα δήλωναν ψεύτικη ισοπαλία.
  const gap = second ? best.score - second.score : 1;
  const tie = !!second && gap < TIE_GAP - EPS;
  // Αν οι δύο κορυφαίες είναι σε ΔΙΑΦΟΡΕΤΙΚΕΣ πλευρές και ταιριάζουν εξίσου καλά στον τύπο του
  // εντύπου, την πλευρά την έκρινε μόνο το (αδύναμο) invoiceKind → καπάκι βεβαιότητας στο 0,7.
  const sideDecidedOnly = !!second && best.c.kind !== second.c.kind && Math.abs(best.base - second.base) < EPS;
  let confidence = clamp01(best.score) * (tie ? 0.75 : 1);
  if (sideDecidedOnly) confidence = Math.min(confidence, 0.7);
  const reason = [
    docFam ? `τύπος «${input.documentTypeLabel}» → ${docFam}` : 'χωρίς τυπωμένο τύπο',
    input.issuerKind === 'supplier' ? 'εκδότης προμηθευτής'
      : input.issuerKind === 'creditor' ? 'εκδότης πιστωτής'
      : input.issuerKind === 'debtor' ? 'εκδότης χρεώστης' : 'εκδότης άγνωστος',
    isCredit ? 'πιστωτικό' : null,
    input.invoiceKind ? `περιεχόμενο ${input.invoiceKind}` : null,
    emptyPool && wantedSide ? `δεν υπάρχουν ενεργές σειρές ${SERIES_SIDE_LABEL[wantedSide].toLowerCase()}` : null,
  ].filter(Boolean).join(' · ');
  return { code: best.c.code, sosource: best.c.sosource, kind: best.c.kind, confidence: clamp01(confidence), reason, tie, alternatives: scored.slice(0, 5).map((s) => ({ code: s.c.code, sosource: s.c.sosource, abbrev: s.c.abbrev, name: s.c.name, score: Math.round(clamp01(s.score) * 100) / 100 })) };
}

/* ------------------------------------------------------------------ */
/* Ταυτότητα σειράς                                                    */
/* ------------------------------------------------------------------ */

/**
 * Ταυτότητα μιας σειράς είναι το ΖΕΥΓΟΣ `sosource:code` — ο ίδιος κωδικός υπάρχει
 * και στις αγορές (1251) και στους πιστωτές (1653), άρα ο κωδικός μόνος του δεν αρκεί.
 */
export const seriesKey = (s: { sosource: number; code: string }): string => `${s.sosource}:${s.code}`;

/**
 * Διαβάζει την απάντηση του μοντέλου: δέχεται είτε το ζεύγος «1251:7001» είτε σκέτο
 * κωδικό «7001» — ο σκέτος κωδικός γίνεται δεκτός ΜΟΝΟ αν είναι μοναδικός ανάμεσα
 * στις επιλογές (αλλιώς δεν ξέρουμε ποια ενότητα εννοεί το μοντέλο).
 */
export function parseSeriesChoice(raw: string | null | undefined, options: SeriesCandidate[]): SeriesCandidate | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const pair = s.match(/^(\d+)\s*:\s*(.+)$/);
  if (pair) {
    const key = `${Number(pair[1])}:${pair[2].trim()}`;
    return options.find((o) => seriesKey(o) === key) ?? null;
  }
  const hits = options.filter((o) => o.code === s);
  return hits.length === 1 ? hits[0] : null;
}

/* ------------------------------------------------------------------ */
/* invoiceKind πριν από τη συσχέτιση γραμμών                           */
/* ------------------------------------------------------------------ */

// Λέξεις που δείχνουν υπηρεσία μέσα στην περιγραφή της γραμμής.
const SERVICE_WORDS = ['ΥΠΗΡΕΣ', 'ΠΑΡΟΧ', 'ΣΥΝΤΗΡΗΣ', 'ΜΕΤΑΦΟΡ', 'ΑΜΟΙΒ', 'ΣΥΜΒΟΥΛ', 'FEE', 'SERVICE'];
// Μονάδες μέτρησης: δείχνουν εμπόρευμα. Ως αυτοτελείς λέξεις, αλλιώς το «LT» πιάνει το «ΑΛΤ».
const UNIT_RE = new RegExp(`(${['KG', 'ΤΕΜ', 'LT', 'M3'].map(w).join('|')})`);

type RawItem = { code?: unknown; name?: unknown; quantity?: unknown; unit?: unknown };

/**
 * Μαντεύει το `invoiceKind` ΜΟΝΟ από τα εξαγόμενα δεδομένα, για τη στιγμή της ταξινόμησης:
 * το κανονικό `OcrDocument.invoiceKind` το γράφει αργότερα το correlate (συσχέτιση γραμμών με
 * το μητρώο ειδών), οπότε στο πρώτο πέρασμα είναι πάντα `null`. Καθαρή συνάρτηση, χωρίς I/O.
 *
 * - χωρίς γραμμές → `null` (δεν μαντεύουμε από τον τύπο του εντύπου, αυτό το κάνει ήδη ο ταξινομητής)
 * - όλες οι ποσότητες κενές ή 1 **και** περιγραφές με λέξεις υπηρεσίας → `'service'`
 * - γραμμή με κωδικό είδους και ποσότητα > 1, ή μονάδα μέτρησης → `'product'`
 * - αλλιώς `null` (άγνωστο· ο ταξινομητής δεν παίρνει side hint)
 */
export function inferInvoiceKind(data: unknown): 'service' | 'product' | null {
  const raw = (data as { items?: unknown } | null | undefined)?.items;
  const items: RawItem[] = Array.isArray(raw) ? (raw as RawItem[]) : [];
  if (!items.length) return null;

  // Οι ποσότητες έρχονται συχνά ως κείμενο («1», «2,5»): ίδια μετατροπή με το `lib/ocr/invoice-math.ts`.
  const qtyOf = (it: RawItem): number | null => toNumber(it?.quantity);
  const textOf = (it: RawItem): string => normalizeGreek(`${it?.name ?? ''} ${it?.unit ?? ''}`);

  const allSingleQty = items.every((it) => { const q = qtyOf(it); return q == null || q === 1; });
  const anyServiceWord = items.some((it) => { const t = textOf(it); return SERVICE_WORDS.some((word) => t.includes(word)); });
  if (allSingleQty && anyServiceWord) return 'service';

  const anyGoods = items.some((it) => {
    const q = qtyOf(it);
    const hasCode = typeof it?.code === 'string' && it.code.trim() !== '';
    return (hasCode && q != null && q > 1) || UNIT_RE.test(textOf(it));
  });
  return anyGoods ? 'product' : null;
}
