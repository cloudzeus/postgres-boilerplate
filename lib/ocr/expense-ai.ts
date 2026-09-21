// lib/ocr/expense-ai.ts — SERVER. «Σε ποια δαπάνη ανήκει αυτή η γραμμή;» με το μοντέλο,
// ΜΟΝΟ για ό,τι δεν έλυσε ο φθηνός δρόμος.
//
// Σειρά που δεν αλλάζει: (1) μνήμη `LineMatchRule`, (2) ντετερμινιστικό scoring σε κωδικό/όνομα
// (`lib/ocr/line-match.ts`), (3) — και μόνο τότε — το μοντέλο. Μια γραμμή που λύθηκε φθηνά ΔΕΝ
// φτάνει ποτέ στο μοντέλο, και το μοντέλο δεν τρέχει ποτέ μόνο του: το πατάει ο χρήστης.
//
// Το μοντέλο ΠΡΟΤΕΙΝΕΙ, δεν αποφασίζει: επιστρέφει κωδικό από τη λίστα υποψηφίων που του
// στείλαμε, και ό,τι δεν ανήκει στη λίστα πετιέται σιωπηλά. Δεν εφευρίσκεται ποτέ δαπάνη.
import 'server-only';
import { prisma } from '@/lib/db';
import { callTextLLM, callTextViaVision, resolveCfg } from './extract';
import { groupVatRates, suggestForGroup, type QueueSuggestion } from './queues';
import { resolveOwnCompany, UNKNOWN_OWN_COMPANY, type OwnCompanyProfile } from './own-company';
import { AI_CONFIDENT_SCORE, bestSuggestionScore } from './ai-apply';
import type { MatchKind } from './line-match';
import { TRADER_KIND_SODTYPE } from '@/lib/softone';
import { accountVatRate, type ChartAccount } from './account-check';
import {
  BRANCH_LEVEL, branchCodeOf, groundArticles, candidateLine, candidateSignaturePart, branchCatalogue,
  articlesInBranches, mergeWhitelist, issuerHistory, parseBranchAnswer,
  type GroundedArticle, type HistoryRule,
} from './chart-grounding';

/**
 * Πάνω από αυτό το σκορ ο φθηνός δρόμος θεωρείται αρκετός — καμία κλήση μοντέλου. Ένα κατώφλι,
 * μοιρασμένο με την ουρά (`lib/ocr/ai-apply.ts`): το UI δεν πρέπει να στέλνει ομάδες που ο
 * server θα παραλείψει ούτως ή άλλως.
 */
export const CONFIDENT_SCORE = AI_CONFIDENT_SCORE;
/** Πόσες ομάδες το πολύ σε μία κλήση. */
export const MAX_GROUPS = 20;
/** Πόσους υποψήφιους στέλνουμε όταν ΔΕΝ έχει επιλεγεί κατηγορία δαπάνης. */
export const MAX_CANDIDATES_FREE = 40;
/**
 * Κάτω από αυτή τη βεβαιότητα ΔΕΝ δηλώνουμε τύπο: η ομάδα μένει «χωρίς κατηγορία». Ένα chip με
 * σιγουριά που είναι λάθος κοστίζει περισσότερο από ένα κενό που ζητά απόφαση.
 */
export const MIN_KIND_CONFIDENCE = 0.6;
/** Πόσες γραμμές χαρακτηρισμού myDATA στέλνουμε ως λευκή λίστα (η λίστα είναι 123 + 30). */
export const MAX_MYDATA_TYPES = 60;
export const MAX_MYDATA_CATEGORIES = 30;
/** …και όταν έχει επιλεγεί (τότε η λίστα είναι ήδη στενή και τη στέλνουμε σχεδόν ολόκληρη). */
export const MAX_CANDIDATES_CATEGORY = 120;
/**
 * Πόσα ΕΞΟΔΑ (`EXPN`) στέλνουμε ως λευκή λίστα. Το μητρώο εξόδων μιας εγκατάστασης είναι
 * **μικρό** — στον ζωντανό tenant είναι **έξι** γραμμές — και το να το στείλουμε **ολόκληρο**
 * κοστίζει ελάχιστα και αντικαθιστά εικασία με κατάλογο. Το πλαφόν υπάρχει μόνο ως δικλείδα
 * για εγκατάσταση με ασυνήθιστα μεγάλο μητρώο.
 */
export const MAX_EXPENSES = 40;
/**
 * Πόσες χρεοπιστώσεις με ΑΞΙΟΠΙΣΤΟ λογαριασμό στέλνουμε σε ΜΙΑ κλήση (στρατηγική `single`).
 * Πάνω από αυτό το πλήθος η λίστα στενεύει πρώτα κατά κλάδο (`two-stage`), ώστε το prompt να
 * μένει φραγμένο.
 *
 * Μέτρηση στον ζωντανό tenant (2026-09-21, 136 τέτοιες χρεοπιστώσεις, παρτίδα 20 ομάδων,
 * `deepseek-chat`): `single` 18.977 in / 1.662 out = $0,00695 · `two-stage` 14.222 in / 2.219
 * out σε ΔΥΟ κλήσεις = $0,00628. Η στένωση ήταν ~10% φθηνότερη αλλά ΟΧΙ ίδιας ποιότητας: στις
 * 20 ομάδες έδωσε τις ίδιες 8 προτάσεις κωδικού και μία επιπλέον ΛΑΘΟΣ («Ειδ. Τέλος 5%» →
 * «ΦΠΑ μη εκπιπτόμενος»), γιατί ο στενός κλάδος δεν είχε σωστή επιλογή και το μοντέλο διάλεξε
 * ό,τι βρήκε. Γι' αυτό η προεπιλογή είναι η μία κλήση. Όσο ο λογιστής διορθώνει τις 307
 * χρεοπιστώσεις χωρίς έγκυρο λογαριασμό, το πλήθος μεγαλώνει· πάνω από το όριο η εφαρμογή
 * περνά μόνη της στη στένωση κατά κλάδο αντί να κόψει αυθαίρετα τη λίστα.
 */
export const MAX_GROUNDED_SINGLE = 200;
/** Πόσους κλάδους το πολύ κρατάμε ανά ομάδα από το 1ο στάδιο. */
export const MAX_BRANCHES_PER_GROUP = 3;

/** Πώς διαλέγονται οι χρεοπιστώσεις με αξιόπιστο λογαριασμό που βλέπει το μοντέλο. */
export type ShortlistStrategy = 'single' | 'two-stage';

export interface AiGroupInput {
  /** Κλειδί ομάδας όπως το ξέρει το UI (`afm|pattern`). */
  key: string;
  afm: string;
  pattern: string;
  sample?: string | null;
  code?: string | null;
  /** Η επωνυμία του εκδότη όπως τη δείχνει η ουρά — συμφραζόμενο, όχι κλειδί. */
  supplier?: string | null;
}

/**
 * Η απάντηση του μοντέλου για μία ομάδα. Τρεις μορφές, όλες νόμιμες:
 *
 *  • **πρόταση δαπάνης** (`lin`/`code`/`name`) — μπαίνει ως υποψηφιότητα προς επιβεβαίωση·
 *  • **μόνο τύπος** (`kind`) — η ομάδα παύει να είναι «χωρίς κατηγορία»·
 *  • **σκέτη ΠΑΡΑΤΗΡΗΣΗ** (`kind: null`, `code: null`, με `reason`) — δεν επιλέγει τίποτα,
 *    εμφανίζεται ως σημείωση. Εδώ προσγειώνεται το ΠΑΓΙΟ, που το prompt ζητά ρητά να δηλωθεί
 *    με χαμηλή βεβαιότητα και εξήγηση στο `reason`.
 */
export interface AiSuggestion {
  key: string;
  /**
   * Ο ΤΥΠΟΣ μητρώου που προτείνει το μοντέλο (είδος / υπηρεσία / έξοδο / χρεοπίστωση).
   * `null` όταν η βεβαιότητα είναι κάτω από το {@link MIN_KIND_CONFIDENCE} — τότε η ομάδα
   * μένει ρητά «χωρίς κατηγορία» αντί να πάρει λάθος chip.
   */
  kind: MatchKind | null;
  /** MTRL της χρεοπίστωσης που προτείνεται — `null` όταν το μοντέλο πρότεινε μόνο τύπο. */
  lin: number | null;
  code: string | null;
  name: string | null;
  /** 0–1, όπως το δήλωσε το μοντέλο (φραγμένο). */
  confidence: number;
  /** Σύντομη ελληνική αιτιολόγηση, με την ομάδα ΕΛΠ που επικαλείται το μοντέλο. */
  reason: string;
  /** Ο χαρακτηρισμός myDATA που πρότεινε, ΜΟΝΟ αν ανήκει στη λίστα που στείλαμε. */
  myDataType?: string | null;
}

export interface AiSuggestResult {
  suggestions: AiSuggestion[];
  /** Πόσες ομάδες όντως ρωτήθηκαν. */
  asked: number;
  /** Πόσες παραλείφθηκαν επειδή τις είχε λύσει ο φθηνός δρόμος. */
  skipped: number;
  /** Πόσες απαντήθηκαν από την κρυφή μνήμη (χωρίς κόστος). */
  cached: number;
  /** `true` όταν κανένας πάροχος δεν απάντησε — «καμία πρόταση», όχι σφάλμα. */
  degraded: boolean;
  /**
   * `true` όταν η ταξινόμηση έτρεξε **χωρίς να ξέρουμε τι κάνει η δική μας επιχείρηση**
   * (`resolveOwnCompany().activity === null`).
   *
   * Δεν είναι λεπτομέρεια: το αν μια γραμμή είναι **προϊόν** δεν είναι ιδιότητα του πράγματος
   * αλλά του **τι κάνει ο αγοραστής** με αυτό (δες την κεφαλίδα του `lib/ocr/own-company.ts`).
   * Το ίδιο ψωμί είναι απόθεμα για φούρνο και έξοδο για γραφείο. Όταν λείπει, το prompt γράφει
   * ρητά «ΑΓΝΩΣΤΗ δραστηριότητα» και το μοντέλο κρίνει χωρίς το πιο κρίσιμο δεδομένο — αλλά ο
   * χρήστης δεν το μάθαινε πουθενά, και οι προτάσεις έμοιαζαν το ίδιο σίγουρες. Η λειτουργία
   * **δεν** μπλοκάρει· απλώς παύει να υποβαθμίζεται σιωπηλά.
   */
  ownCompanyUnknown: boolean;
}

/**
 * Σταθερή, σύντομη υπογραφή που καλύπτει ΟΛΟΥΣ τους υποψηφίους (πλήθος + hash). Ένα σκέτο
 * `slice()` πάνω στη λίστα θα άφηνε μια αλλαγή στο τέλος να περάσει απαρατήρητη.
 */
export function candidateSignature(parts: string[]): string {
  let h = 2166136261;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      h ^= part.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= 0x2c; // διαχωριστικό, ώστε ['ab','c'] ≠ ['a','bc']
    h = Math.imul(h, 16777619);
  }
  return `${parts.length}:${(h >>> 0).toString(36)}`;
}

// ── Κρυφή μνήμη ────────────────────────────────────────────────────────────
// Κλειδί = ομάδα + κατηγορία + ΥΠΟΓΡΑΦΗ ΥΠΟΨΗΦΙΩΝ: αν αλλάξει το μητρώο ή η κατηγορία, η
// απάντηση δεν ισχύει πια και ξαναρωτιέται. Ζει όσο η διεργασία — αρκεί για «ξαναφόρτωσα
// τη σελίδα», που είναι και ο λόγος που υπάρχει.
const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { at: number; value: AiSuggestion | null }>();

const cacheKey = (g: AiGroupInput, categoryId: number | null, signature: string): string =>
  `${g.afm}|${g.pattern}|${categoryId ?? ''}|${signature}`;

/** Μόνο για τα tests: καθαρίζει την κρυφή μνήμη. */
export const clearExpenseAiCache = (): void => cache.clear();

// ── Καθαρός parser ─────────────────────────────────────────────────────────

/**
 * Πόσους χαρακτήρες χρειάζεται μια αιτιολόγηση για να σταθεί **μόνη της** ως παρατήρηση, χωρίς
 * τύπο και χωρίς κωδικό. Ένα «—» ή ένα «ok» δεν είναι πληροφορία για τον χρήστη· μια πρόταση
 * σαν «πρόκειται για πάγιο εξοπλισμό που αποσβένεται» είναι.
 */
export const MIN_NOTE_REASON = 12;

/** `true` όταν η αιτιολόγηση αξίζει να φτάσει στον χρήστη ακόμη και χωρίς καμία πρόταση. */
export const standsAlone = (reason: string): boolean =>
  String(reason ?? '').trim().length >= MIN_NOTE_REASON;

export interface ParsedAnswer {
  key: string;
  /** Ο τύπος όπως τον έγραψε το μοντέλο — ΔΕΝ έχει ελεγχθεί ακόμη. */
  kind: string;
  /** Κωδικός χρεοπίστωσης· κενό όταν το μοντέλο πρότεινε μόνο τύπο. */
  code: string;
  /** Κωδικός χαρακτηρισμού myDATA· κενό όταν δεν πρότεινε. */
  mydata: string;
  confidence: number;
  reason: string;
}

/**
 * Διαβάζει την απάντηση του μοντέλου. Ανέχεται markdown fences και σκουπίδια γύρω από το JSON.
 * ΔΕΝ εμπιστεύεται τίποτα: ο έλεγχος «ο κωδικός υπάρχει στους υποψηφίους» γίνεται από τον καλούντα.
 */
export function parseAiAnswer(raw: string): ParsedAnswer[] {
  const text = String(raw ?? '').trim();
  const body = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    const m = body.match(/\{[\s\S]*\}/);
    if (!m) return [];
    try { parsed = JSON.parse(m[0]); } catch { return []; }
  }
  const root = parsed as { matches?: unknown } | null;
  const list = Array.isArray(root?.matches) ? root.matches : Array.isArray(parsed) ? parsed : [];
  const out: ParsedAnswer[] = [];
  for (const row of list as Record<string, unknown>[]) {
    if (!row || typeof row !== 'object') continue;
    const key = String(row.key ?? '').trim();
    const code = String(row.code ?? '').trim();
    const kind = String(row.kind ?? '').trim().toLowerCase();
    const reason = String(row.reason ?? '').trim().slice(0, 300);
    // Χωρίς ΟΥΤΕ τύπο ΟΥΤΕ κωδικό μένει μόνο η αιτιολόγηση — και κρατιέται ΜΟΝΟ αν στέκει μόνη
    // της ως παρατήρηση (ο δρόμος που ζητά το prompt για τα ΠΑΓΙΑ). Αλλιώς δεν λέει τίποτα.
    if (!key || (!code && !kind && !standsAlone(reason))) continue;
    const c = Number(row.confidence);
    out.push({
      key,
      kind,
      code,
      mydata: String(row.mydata ?? '').trim(),
      confidence: Number.isFinite(c) ? Math.max(0, Math.min(1, c)) : 0.5,
      reason,
    });
  }
  return out;
}

/**
 * Το κλειδί που επέστρεψε το μοντέλο, δεμένο σε ένα κλειδί που ΟΝΤΩΣ ρωτήσαμε — αλλιώς `null`.
 *
 * Η γραμμή του prompt είναι `<key> :: <δείγμα>`, και το μοντέλο αντιγράφει συχνά ΟΛΗ τη γραμμή
 * στο `key`. Με σκέτο `Set.has()` έπεφτε τότε **κάθε** απάντηση στη λευκή λίστα, σιωπηλά: η
 * «Πρόταση με AI» πλήρωνε την κλήση και γύριζε μηδέν προτάσεις χωρίς να παραπονεθεί πουθενά.
 * Δεν κόβουμε στο `' :: '` (ένα κλειδί θα μπορούσε να το περιέχει) αλλά δεχόμαστε το πιο ΜΑΚΡΥ
 * κλειδί που είναι πρόθεμα της απάντησης: η λευκή λίστα μένει λευκή λίστα.
 */
export function resolveAnswerKey(raw: string, asked: Set<string>): string | null {
  const k = String(raw ?? '').trim();
  if (!k) return null;
  if (asked.has(k)) return k;
  let best: string | null = null;
  for (const a of asked) {
    if (k.startsWith(a) && (best === null || a.length > best.length)) best = a;
  }
  return best;
}

/** Η καλύτερη ντετερμινιστική πρόταση μιας ομάδας — αυτή κρίνει αν χρειάζεται μοντέλο. */
const bestScore = (suggestions: QueueSuggestion[]): number => bestSuggestionScore(suggestions);

/**
 * ΟΛΕΣ οι ενεργές χρεοπιστώσεις, με τον λογαριασμό τους ΟΠΟΥ ο σύνδεσμος είναι αξιόπιστος
 * (`lib/ocr/chart-grounding.ts`). Μία ανάγνωση ανά κλικ: ~450 χρεοπιστώσεις και μόνο οι
 * λογαριασμοί που χρειάζονται (οι ίδιοι + ο κλάδος τους), όχι ολόκληρο το σχέδιο των 5.000+.
 */
async function loadGroundedPool(): Promise<Map<number, GroundedArticle & { mtrCategory: number | null }>> {
  const rows = await prisma.softoneLineItem.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: { mtrl: true, code: true, name: true, mtrCategory: true, acnmsk: true, acnmskSyncedAt: true },
  });
  const catIds = Array.from(new Set(rows.map((r) => r.mtrCategory).filter((v): v is number => v != null)));
  const codes = new Set<string>();
  for (const r of rows) {
    const m = (r.acnmsk ?? '').trim();
    if (!m || m.includes('*')) continue;
    codes.add(m);
    const b = branchCodeOf(m, BRANCH_LEVEL);
    if (b) codes.add(b);
  }
  const [cats, accounts] = await Promise.all([
    catIds.length
      ? prisma.softoneLineCategory.findMany({ where: { mtrCategory: { in: catIds } }, select: { mtrCategory: true, name: true } })
      : Promise.resolve([] as { mtrCategory: number; name: string }[]),
    codes.size
      ? prisma.softoneAccount
        .findMany({ where: { code: { in: [...codes] } }, select: { code: true, name: true, postable: true, isActive: true } })
        .catch(() => [] as ChartAccount[])
      : Promise.resolve([] as ChartAccount[]),
  ]);
  const catName = new Map(cats.map((c) => [c.mtrCategory, c.name]));
  const chart = new Map<string, ChartAccount>(accounts.map((a) => [a.code.trim(), a]));
  const grounded = groundArticles(rows.map((r) => ({
    mtrl: r.mtrl, code: r.code, name: r.name,
    acnmsk: r.acnmsk, acnmskKnown: Boolean(r.acnmskSyncedAt),
    category: r.mtrCategory != null ? catName.get(r.mtrCategory) ?? null : null,
  })), chart);
  return new Map(grounded.map((g, i) => [g.mtrl, { ...g, mtrCategory: rows[i].mtrCategory }]));
}

/**
 * Οι υποψήφιες χρεοπιστώσεις από τον ΠΑΛΙΟ δρόμο: της επιλεγμένης κατηγορίας, αλλιώς οι
 * κορυφαίες κατά ομοιότητα κειμένου. Είναι ο ΜΟΝΟΣ δρόμος για χρεοπιστώσεις χωρίς αξιόπιστο
 * λογαριασμό — αυτές δεν έχουν κλάδο, άρα δεν τις βρίσκει η στένωση κατά κλάδο.
 */
function textCandidates(
  pool: ReadonlyMap<number, GroundedArticle & { mtrCategory: number | null }>,
  categoryId: number | null, deterministic: Map<string, QueueSuggestion[]>,
): GroundedArticle[] {
  if (categoryId) {
    return [...pool.values()].filter((a) => a.mtrCategory === categoryId).slice(0, MAX_CANDIDATES_CATEGORY);
  }
  // Χωρίς κατηγορία: οι χρεοπιστώσεις που ήδη βρήκε το string-matching για ΟΛΕΣ τις ομάδες,
  // κατά φθίνον σκορ. Δεν στέλνουμε ποτέ ολόκληρο το μητρώο από αυτόν τον δρόμο.
  const scored = new Map<number, number>();
  for (const list of deterministic.values()) {
    for (const s of list) {
      if (s.lin == null) continue;
      scored.set(s.lin, Math.max(scored.get(s.lin) ?? 0, s.score));
    }
  }
  return Array.from(scored.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([mtrl]) => pool.get(mtrl))
    .filter((a): a is GroundedArticle & { mtrCategory: number | null } => a != null)
    .slice(0, MAX_CANDIDATES_FREE);
}

/**
 * Το ιστορικό κάθε εκδότη από την ΑΝΘΡΩΠΙΝΗ μνήμη (`LineMatchRule` — τη γράφουν μόνο οι
 * χειροκίνητες αντιστοιχίσεις). Ποτέ αυτόματες αντιστοιχίσεις, ποτέ παλιές απαντήσεις του
 * μοντέλου: αυτές δεν γράφουν κανόνα.
 */
async function loadIssuerHistory(
  afms: readonly string[], pool: ReadonlyMap<number, GroundedArticle>,
): Promise<Map<string, { branches: string[]; line: string }>> {
  const keys = Array.from(new Set(afms.map((a) => String(a ?? '').trim()).filter(Boolean)));
  const out = new Map<string, { branches: string[]; line: string }>();
  if (keys.length === 0) return out;
  const rules: HistoryRule[] = await prisma.lineMatchRule
    .findMany({
      where: { afm: { in: keys }, lin: { not: null }, createdById: { not: null }, targetSource: 'manual' },
      select: { afm: true, lin: true, createdById: true, targetSource: true },
    })
    .catch(() => [] as HistoryRule[]);
  for (const afm of keys) {
    const h = issuerHistory(afm, rules, pool);
    if (h) out.set(afm, h);
  }
  return out;
}

/** Οι τέσσερις τύποι μητρώου, όπως μπορεί να τους γράψει το μοντέλο (αγγλικά ή ελληνικά). */
const KIND_WORDS: Record<string, MatchKind> = {
  product: 'product', 'είδος': 'product', ειδος: 'product', 'προϊόν': 'product', 'προιον': 'product',
  service: 'service', 'υπηρεσία': 'service', 'υπηρεσια': 'service',
  expense: 'expense', 'έξοδο': 'expense', 'εξοδο': 'expense',
  lineitem: 'lineitem', 'χρεοπίστωση': 'lineitem', 'χρεοπιστωση': 'lineitem',
};

/**
 * Το system prompt.
 *
 * Η ΚΕΝΤΡΙΚΗ ιδέα δεν είναι «αναγνώρισε το αντικείμενο» αλλά **«τι κάνει με αυτό η αγοράστρια
 * επιχείρηση»**: το ίδιο ψωμί είναι απόθεμα για φούρνο και έξοδο για γραφείο. Γι' αυτό το prompt
 * δίνει ποιοι είμαστε ΕΜΕΙΣ, ποιος εκδίδει, και ζητά συλλογισμό μέσα στο **Ελληνικό Γενικό
 * Λογιστικό Σχέδιο** (όπως το κληρονομούν τα ΕΛΠ από την ευρωπαϊκή λογιστική οδηγία) — όχι
 * ελεύθερη κατηγοριοποίηση από το κείμενο της γραμμής.
 */
const SYSTEM = [
  'Είσαι έμπειρος Έλληνας λογιστής. Κατατάσσεις γραμμές ΕΙΣΕΡΧΟΜΕΝΩΝ τιμολογίων μιας ελληνικής',
  'επιχείρησης σε ΕΝΑ από τα τέσσερα μητρώα ενός ελληνικού ERP (SoftOne):',
  '  • "product"  = ΕΙΔΟΣ (απόθεμα) — αγοράζεται για μεταπώληση ή για ανάλωση στην παραγωγή.',
  '  • "service"  = ΥΠΗΡΕΣΙΑ που τηρείται ως εγγραφή υπηρεσίας στο μητρώο ειδών.',
  '  • "expense"  = ΕΞΟΔΟ — οργανικό έξοδο κατ’ είδος, δεν αποθεματοποιείται.',
  '  • "lineitem" = ΧΡΕΟΠΙΣΤΩΣΗ — γραμμή ειδικής συναλλαγής (δαπάνες προμηθευτών/πιστωτών).',
  '',
  'ΤΟ ΠΛΑΙΣΙΟ: η εφαρμογή καταχωρεί ΜΟΝΟ ΕΙΣΕΡΧΟΜΕΝΑ παραστατικά — ΑΓΟΡΕΣ, ΕΞΟΔΑ και ΠΑΓΙΑ.',
  'Δεν υπάρχει καθόλου πλευρά πωλήσεων. Η ερώτηση είναι πάντα «τι αποκτήσαμε και για ποια',
  'χρήση», ΠΟΤΕ «τι πουλάμε». Σε τέτοιο σύστημα τα συνηθισμένα είναι έξοδο, υπηρεσία και',
  'χρεοπίστωση· "product" μόνο όταν είναι πράγματι απόθεμα που κρατά η επιχείρηση.',
  '',
  'ΚΑΝΟΝΑΣ ΠΟΥ ΔΙΕΠΕΙ ΤΑ ΠΑΝΤΑ: το αν μια γραμμή είναι "product" ΔΕΝ είναι ιδιότητα του',
  'πράγματος· είναι ιδιότητα του ΤΙ ΚΑΝΕΙ Η ΑΓΟΡΑΣΤΡΙΑ ΕΠΙΧΕΙΡΗΣΗ με αυτό. Το ίδιο ψωμί είναι',
  'απόθεμα για φούρνο και έξοδο για γραφείο. Σκέψου ΠΡΩΤΑ τη δραστηριότητα του αγοραστή.',
  '',
  'Συλλογίσου μέσα στο Ελληνικό Γενικό Λογιστικό Σχέδιο (ΕΛΠ / ευρωπαϊκή λογιστική οδηγία):',
  '  • Ομάδα 2 — ΑΠΟΘΕΜΑΤΑ: αγαθά για μεταπώληση ή ανάλωση στην παραγωγή  ⇒ "product".',
  '  • Ομάδα 6 — ΟΡΓΑΝΙΚΑ ΕΞΟΔΑ ΚΑΤ’ ΕΙΔΟΣ:',
  '      61 αμοιβές και έξοδα τρίτων (λογιστής, δικηγόρος, εργολάβος),',
  '      62 παροχές τρίτων (ρεύμα, νερό, τηλεπικοινωνίες, ενοίκια, cloud/hosting, συντηρήσεις),',
  '      63 φόροι και τέλη, 64 διάφορα έξοδα (μεταφορικά, έντυπα, φιλοξενία, καύσιμα).',
  '    ⇒ "expense", ή "lineitem" όταν η δαπάνη καταχωρείται ως ειδική συναλλαγή.',
  '  • Υπηρεσία που καταναλώνεται και τηρείται στο μητρώο ειδών ως υπηρεσία ⇒ "service".',
  '',
  'ΑΔΕΙΕΣ ΚΑΙ ΣΥΝΔΡΟΜΕΣ ΔΕΝ ΕΙΝΑΙ ΑΠΟΘΕΜΑ: άδεια χρήσης, συνδρομή, ανανέωση, συμβόλαιο',
  'συντήρησης ή «πρόγραμμα αναβάθμισης» ανά serial/εγκατάσταση είναι δικαίωμα χρήσης που',
  'καταναλώνεται — ΟΧΙ αγαθό που μπαίνει σε απογραφή. Ισχύει ΑΚΟΜΗ ΚΑΙ ΟΤΑΝ ο εκδότης είναι',
  'προμηθευτής εμπορευμάτων: ο ίδιος οίκος πουλά και μηχανήματα και άδειες. Ένας κωδικός',
  'σειράς (SN, P.ID) μέσα στην περιγραφή δείχνει συνήθως άδεια δεμένη σε ΥΠΑΡΧΟΥΣΑ συσκευή.',
  '',
  'ΑΠΑΝΤΑΣ ΜΟΝΟ με JSON αυτής της μορφής, χωρίς κείμενο γύρω του:',
  '{"matches":[{"key":"<key>","kind":"product|service|expense|lineitem",',
  '"code":"<κωδικός ΜΟΝΟ από τη λίστα υποψηφίων, ή κενό>",',
  '"mydata":"<κωδικός ΜΟΝΟ από τη λίστα χαρακτηρισμών myDATA, ή κενό>",',
  '"confidence":0.0-1.0,"reason":"<μία σύντομη ελληνική πρόταση που ΟΝΟΜΑΖΕΙ την ομάδα ΕΛΠ>"}]}',
  '',
  'ΑΥΣΤΗΡΟΙ ΚΑΝΟΝΕΣ:',
  '  • ΠΟΤΕ κωδικό εκτός της λίστας υποψηφίων και ΠΟΤΕ χαρακτηρισμό εκτός της λίστας myDATA.',
  '  • Αν δεν βρίσκεις κωδικό που να ταιριάζει, άφησε το "code" κενό και δώσε μόνο το "kind".',
  '  • Αν δεν είσαι σίγουρος για τον τύπο, βάλε ΧΑΜΗΛΟ confidence — μη μαντεύεις.',
  '  • ΠΑΓΙΟ (εξοπλισμός που αποσβένεται): η εφαρμογή ΔΕΝ καταχωρεί ακόμη πάγια και δεν υπάρχει',
  '    τέτοιο "kind". Βάλε ΧΑΜΗΛΟ confidence, άσε ΚΕΝΟ το "code" και γράψε ρητά στο "reason" ότι',
  '    πρόκειται για πάγιο — η πρόταση εμφανίζεται τότε ως ΠΑΡΑΤΗΡΗΣΗ και τη διαβάζει ο χρήστης.',
  '    Μην το στριμώξεις σε "product" ή "expense".',
  '  • Το "reason" στα ελληνικά, έως 25 λέξεις, π.χ. «παροχή τρίτων, ομάδα 62 — υπηρεσία cloud',
  '    που καταναλώνεται, δεν αποθεματοποιείται».',
].join('\n');

/**
 * Οι καρτέλες `TRDR` που υπάρχουν για το ΑΦΜ ενός εκδότη.
 *
 * Στο SoftOne κάθε τύπος συναλλασσομένου είναι **ξεχωριστή γραμμή** του `TRDR`: `SODTYPE 12`
 * προμηθευτής, `SODTYPE 16` πιστωτής. Ο διαχωρισμός είναι ο ελληνικός λογιστικός διαχωρισμός —
 * προμηθευτής για εμπορεύματα/αποθέματα (ΕΛΠ ομάδα 2), πιστωτής για δαπάνες και παροχές τρίτων
 * (ομάδα 6) — και τον συντηρεί σκόπιμα ο λογιστής.
 *
 * ⚠️ Ζει **εδώ** και όχι στο `lib/ocr/line-kind.ts` επίτηδες. Δοκιμάσαμε να την κάνουμε
 * ντετερμινιστική βαθμίδα και **απέτυχε πάνω σε ζωντανά δεδομένα**: η καρτέλα είναι **αναγκαία,
 * όχι ικανή** — λέει «αυτός ο οίκος μας πουλά αγαθά», ποτέ «αυτή η γραμμή είναι αγαθό». Ο ίδιος
 * `SODTYPE 12` κουβαλά και τον κατασκευαστή σφιγκτήρων και τον προμηθευτή συστημάτων που τιμολογεί
 * **άδειες λογισμικού ανά serial**. Το prompt είναι το μόνο σημείο όπου η καρτέλα συνδυάζεται με
 * το **κείμενο της γραμμής**, που είναι ό,τι πραγματικά ξεχωρίζει τις δύο περιπτώσεις.
 */
export interface IssuerTraderCards {
  /** Υπάρχει καρτέλα **προμηθευτή** (`SODTYPE` 12). */
  supplier: boolean;
  /** Υπάρχει καρτέλα **πιστωτή** (`SODTYPE` 16). */
  creditor: boolean;
}

/** Στοιχεία εκδότη από τον τοπικό καθρέφτη — επωνυμία, δραστηριότητα, καρτέλες `TRDR`. */
type IssuerInfo = { name: string | null; profession: string | null; cards: IssuerTraderCards };

/**
 * Ποιος εκδίδει: μία ανάγνωση για όλες τις ομάδες.
 *
 * Μαζεύουμε **όλες** τις καρτέλες κάθε ΑΦΜ, όχι την πρώτη γραμμή. Η παλιά έκδοση κρατούσε το
 * `kind` της **πρώτης** γραμμής που γύρναγε η βάση: ένας εκδότης με καρτέλα προμηθευτή **και**
 * πιστωτή δήλωνε αυθαίρετα τη μία από τις δύο, ανάλογα με τη σειρά των εγγραφών — ακριβώς η
 * περίπτωση όπου η ένδειξη αυτοαναιρείται και δεν πρέπει να δηλωθεί τίποτα.
 */
async function loadIssuers(groups: readonly AiGroupInput[]): Promise<Map<string, IssuerInfo>> {
  const afms = Array.from(new Set(groups.map((g) => g.afm).filter(Boolean)));
  const out = new Map<string, IssuerInfo>();
  if (afms.length === 0) return out;
  const rows = await prisma.softoneTrader
    .findMany({
      where: { afm: { in: afms }, isActive: true },
      select: { afm: true, name: true, profession: true, sodtype: true },
    })
    .catch(() => [] as { afm: string | null; name: string; profession: string | null; sodtype: number }[]);
  for (const r of rows) {
    if (!r.afm) continue;
    const cur = out.get(r.afm)
      ?? { name: null, profession: null, cards: { supplier: false, creditor: false } };
    cur.name = cur.name ?? (r.name ?? null);
    cur.profession = cur.profession ?? (r.profession ?? null);
    if (r.sodtype === TRADER_KIND_SODTYPE.supplier) cur.cards.supplier = true;
    if (r.sodtype === TRADER_KIND_SODTYPE.creditor) cur.cards.creditor = true;
    out.set(r.afm, cur);
  }
  return out;
}

/**
 * Η **σχέση** με τον εκδότη, γραμμένη ώστε να λέει τι ΣΥΝΕΠΑΓΕΤΑΙ και όχι μόνο πώς λέγεται.
 *
 * Το παλιό `σχέση: Πιστωτής` ήταν σκέτη ετικέτα: το μοντέλο έπρεπε να μαντέψει μόνο του τι
 * σημαίνει λογιστικά, και δεν το μάντευε σταθερά — τα ίδια εργαλεία χειρός του ίδιου εκδότη
 * έπαιρναν «έξοδο ομάδα 64» στη μία παρτίδα και «πάγιο» στην άλλη. Η καρτέλα **είναι** ο
 * ελληνικός λογιστικός διαχωρισμός, οπότε τον λέμε ρητά.
 *
 * Σκόπιμα **μία γραμμή**: το prompt κοστίζει ήδη ~3.000–5.000 επιπλέον tokens ανά παρτίδα.
 *
 * ⚠️ **Η γραμμή του προμηθευτή λέει ρητά ότι είναι ΕΝΔΕΙΞΗ, όχι απόφαση.** Μια πρώτη εκδοχή
 * έγραφε σκέτο «ΠΡΟΜΗΘΕΥΤΗΣ — αγορά για μεταπώληση, ομάδα 2» και **επαληθεύτηκε ζωντανά ότι
 * υπερδιορθώνει**: το μοντέλο άρχισε να δηλώνει `product` με βεβαιότητα 1,00 για **κάθε** γραμμή
 * τέτοιου εκδότη, άδειες λογισμικού ανά serial συμπεριλαμβανομένων. Είναι το ίδιο σφάλμα που
 * βγήκε από τον ντετερμινιστικό δρόμο (δες `lib/ocr/line-kind.ts`), μεταφερμένο στο prompt: η
 * καρτέλα είναι **αναγκαία, όχι ικανή**. Εδώ όμως το μοντέλο βλέπει **και** το κείμενο της
 * γραμμής, οπότε το σωστό δεν είναι να κρύψουμε τη σχέση αλλά να πούμε τι βάρος έχει.
 */
export function issuerRelationLine(cards: IssuerTraderCards): string | null {
  if (cards.supplier && cards.creditor) {
    return 'σχέση: καρτέλα ΚΑΙ προμηθευτή ΚΑΙ πιστωτή — η σχέση ΔΕΝ αποφασίζει, κρίνε από τη γραμμή';
  }
  if (cards.supplier) {
    // ΑΝΑΓΚΑΙΑ, ΟΧΙ ΙΚΑΝΗ — δες το σχόλιο της συνάρτησης.
    return 'σχέση: ΠΡΟΜΗΘΕΥΤΗΣ (TRDR 12) — ο λογιστής τον έχει καταχωρήσει ως προμηθευτή ΕΜΠΟΡΕΥΜΑΤΩΝ (ΕΛΠ ομάδα 2): ισχυρή ένδειξη υπέρ του "product", αλλά κρίνε και το κείμενο της γραμμής';
  }
  if (cards.creditor) {
    return 'σχέση: ΠΙΣΤΩΤΗΣ (TRDR 16) — δαπάνη ή παροχή τρίτων, ΕΛΠ ομάδα 6· ΟΧΙ απόθεμα';
  }
  return null;
}

/**
 * `true` για έξοδο της πλευράς των **ΠΩΛΗΣΕΩΝ**.
 *
 * Το μητρώο κρατά ζευγάρια: «Μεταφορικά Αγορών» / «Μεταφορικά Πωλήσεων». Η εφαρμογή καταχωρεί
 * **ΜΟΝΟ εισερχόμενα** παραστατικά, άρα η πλευρά των πωλήσεων δεν ισχύει ποτέ εδώ — και είναι
 * λάθος που δύσκολα το προσέχει κανείς, γιατί η γραμμή φαίνεται απολύτως εύλογη.
 *
 * Το επιβάλλουμε **στον κώδικα**, όχι με πρόταση μέσα στο prompt. Η αιτιολόγηση του μοντέλου
 * (`reason`) τυπώνεται στον χρήστη ως ο λόγος πάνω στον οποίο θα δράσει, οπότε ένα «Μεταφορικά
 * Πωλήσεων» εκεί έχει πραγματικό κόστος. Ίδια πειθαρχία με τη λευκή λίστα myDATA, που είναι
 * επίσης πραγματικά επιβεβλημένη: **ό,τι δεν στείλαμε δεν μπορεί να επιλεγεί**.
 */
const isSalesExpense = (name: string): boolean =>
  // ΧΩΡΙΣ ΤΟΝΟΥΣ: το `'Μεταφορικά Πωλήσεων'.toUpperCase()` δίνει «ΠΩΛΉΣΕΩΝ» **με τόνο** (η JS
  // κρατά τον τόνο στα ελληνικά κεφαλαία), που δεν ταιριάζει με το άτονο «ΠΩΛΗΣΕΩΝ». Το
  // φίλτρο θα περνούσε σιωπηλά και η γραμμή θα έφτανε στο μοντέλο.
  String(name ?? '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes('ΠΩΛΗΣΕΩΝ');

/**
 * Το **ΜΗΤΡΩΟ ΕΞΟΔΩΝ** (`EXPN`) της εγκατάστασης, ως λευκή λίστα για το prompt.
 *
 * Γιατί μπήκε: το prompt ζητούσε από το μοντέλο να συλλογιστεί σε **ομάδες ΕΛΠ** («61 αμοιβές
 * τρίτων», «64 διάφορα έξοδα») — αφηρημένη ταξινομία, με το μοντέλο να διαλέγει ελεύθερα. Το
 * αποτέλεσμα ήταν ασταθές: τα ίδια εργαλεία χειρός έπαιρναν «έξοδο, ομάδα 64» στη μία παρτίδα
 * και «πάγιο» στην άλλη. Το πραγματικό μητρώο όμως είναι **έξι γραμμές**, με ονόματα που
 * απαντούν ακριβώς στην ερώτηση («Μεταφορικά Αγορών»). Ένας κατάλογος έξι γραμμών είναι
 * ασύγκριτα πιο αξιόπιστος από αφηρημένη ταξινομία — και το μοντέλο ή διαλέγει από αυτόν ή δεν
 * διαλέγει τίποτα.
 *
 * ⚠️ Η **σύγχυση αγορών/πωλήσεων** δηλώνεται ρητά: το μητρώο κρατά ζευγάρια όπως «Μεταφορικά
 * Αγορών» / «Μεταφορικά Πωλήσεων». Η εφαρμογή καταχωρεί **ΜΟΝΟ εισερχόμενα** παραστατικά, άρα
 * κάθε έξοδο **ΠΩΛΗΣΕΩΝ** είναι λάθος εδώ — και λάθος που δεν θα το πρόσεχε κανείς, γιατί η
 * γραμμή θα φαινόταν απολύτως εύλογη.
 */
async function loadExpenseRegistry(): Promise<{ prompt: string }> {
  const all = await prisma.softoneExpense
    .findMany({ where: { isActive: true }, orderBy: { code: 'asc' }, take: MAX_EXPENSES, select: { code: true, name: true } })
    .catch(() => [] as { code: string; name: string }[]);
  // Τα έξοδα ΠΩΛΗΣΕΩΝ δεν φεύγουν καν: αυτό που δεν στάλθηκε δεν μπορεί να επιλεγεί.
  const rows = all.filter((r) => !isSalesExpense(r.name));
  if (rows.length === 0) {
    return { prompt: 'Μητρώο εξόδων (EXPN): δεν έχει συγχρονιστεί — μην επικαλείσαι συγκεκριμένο έξοδο.' };
  }
  return {
    prompt: [
      `Το ΜΗΤΡΩΟ ΕΞΟΔΩΝ (EXPN) της εγκατάστασης — ${rows.length} γραμμές, ΟΛΕΣ όσες ισχύουν εδώ:`,
      ...rows.map((r) => `  ${r.code} — ${r.name}`),
      'Όταν κρίνεις "expense", ονόμασε στο "reason" ΠΟΙΑ από αυτές τις γραμμές ταιριάζει.',
      'Αν καμία δεν ταιριάζει, πες το — μην εφευρίσκεις έξοδο που δεν υπάρχει στη λίστα.',
    ].join('\n'),
  };
}

/**
 * Η ΠΡΑΓΜΑΤΙΚΗ ταξινομία χαρακτηρισμών myDATA, όπως τη συγχρονίσαμε από το SoftOne
 * (`SoftoneMyDataClassType` / `SoftoneMyDataClassCategory`) — λευκή λίστα, ώστε το μοντέλο να
 * συλλογίζεται μέσα στην ελληνική ταξινομία αντί να εφευρίσκει κατηγορίες.
 *
 * Φραγμένη σε {@link MAX_MYDATA_TYPES} + {@link MAX_MYDATA_CATEGORIES} γραμμές: οι πλήρεις
 * λίστες (123 + 30) θα κόστιζαν σε κάθε κλήση περισσότερο απ' όσο αξίζουν.
 */
async function loadMyDataLists(): Promise<{ prompt: string; allowedTypes: Set<string> }> {
  const [types, cats] = await Promise.all([
    prisma.softoneMyDataClassType
      .findMany({ select: { code: true, name: true, myDataCode: true }, orderBy: { code: 'asc' }, take: MAX_MYDATA_TYPES })
      .catch(() => [] as { code: number; name: string; myDataCode: string | null }[]),
    prisma.softoneMyDataClassCategory
      .findMany({ select: { code: true, name: true, myDataCode: true }, orderBy: { code: 'asc' }, take: MAX_MYDATA_CATEGORIES })
      .catch(() => [] as { code: number; name: string; myDataCode: string | null }[]),
  ]);
  // ΔΥΟ λίστες, ΔΥΟ σύνολα. Ένα κοινό `Set` θα δεχόταν κωδικό **κατηγορίας** στη θέση του
  // **τύπου** — δύο διαφορετικοί πίνακες του SoftOne με επικαλυπτόμενη αρίθμηση.
  const allowedTypes = new Set<string>();
  const line = (r: { code: number; name: string; myDataCode: string | null }) =>
    `${r.code} — ${r.name}${r.myDataCode ? ` (${r.myDataCode})` : ''}`;
  const typeLines = types.map((r) => { allowedTypes.add(String(r.code)); return line(r); });
  const catLines = cats.map(line);
  if (typeLines.length === 0 && catLines.length === 0) {
    return { prompt: 'Χαρακτηρισμοί myDATA: δεν έχουν συγχρονιστεί — άφησε το "mydata" κενό.', allowedTypes };
  }
  return {
    prompt: [
      'Χαρακτηρισμοί myDATA (κωδικός — περιγραφή) — το "mydata" ΜΟΝΟ από εδώ:',
      ...typeLines,
      ...(catLines.length
        ? ['Κατηγορίες myDATA (μόνο ως συμφραζόμενο — ΜΗΝ τις βάζεις στο "mydata"):', ...catLines]
        : []),
    ].join('\n'),
    allowedTypes,
  };
}

/**
 * Ποιοι είμαστε, σε λίγες γραμμές prompt — με ΡΗΤΟ «άγνωστο» όπου δεν ξέρουμε.
 *
 * Η **εμπορική** δραστηριότητα τυπώνεται χωριστά από την **κύρια**, γιατί το ερώτημα «για
 * μεταπώληση ή για ανάλωση;» το απαντά η πρώτη και όχι η δεύτερη: μια εταιρεία λογισμικού με
 * δευτερεύοντα ΚΑΔ χονδρικού εμπορίου εξοπλισμού πληροφορικής όντως μεταπωλεί υπολογιστές.
 *
 * Ο κενός πίνακας γράφεται **ρητά** ως «καμία εμπορική δραστηριότητα», ΟΧΙ ως σιωπή: είναι
 * κατηγορηματικό «δεν μεταπωλούμε» και το μοντέλο πρέπει να το διαβάσει έτσι.
 */
function ownCompanyBlock(own: OwnCompanyProfile): string {
  const name = own.name ?? '(άγνωστη επωνυμία)';
  const afm = own.afm ?? '(άγνωστο ΑΦΜ)';
  const activity = own.activity
    ?? 'ΑΓΝΩΣΤΗ — δεν έχει καταχωρηθεί δραστηριότητα· ΜΗΝ υποθέσεις εμπορία ή μεταπώληση.';
  const trade = own.tradeActivities.length > 0
    ? [
        '  Εμπορικές δραστηριότητες (ΚΑΔ εμπορίου — ΜΟΝΟ αυτά μεταπωλούμε):',
        ...own.tradeActivities.map((t) => `    • ${t}`),
      ].join('\n')
    : '  Εμπορικές δραστηριότητες: ΚΑΜΙΑ στο μητρώο — δεν μεταπωλούμε αγαθά.';
  return [
    'Η ΔΙΚΗ ΜΑΣ ΕΠΙΧΕΙΡΗΣΗ (ο αγοραστής):',
    `  Επωνυμία: ${name}`,
    `  ΑΦΜ: ${afm}`,
    `  Κύρια δραστηριότητα: ${activity}`,
    trade,
  ].join('\n');
}

/**
 * Το σύστημα του 1ου σταδίου (`two-stage`): μόνο ΚΛΑΔΟΙ, χωρίς μητρώα, χωρίς myDATA — μικρό και
 * φθηνό. Η απάντηση δεν δείχνεται ποτέ στον χρήστη· μόνο στενεύει τη λίστα του 2ου σταδίου.
 */
const SYSTEM_BRANCHES = [
  'Είσαι έμπειρος Έλληνας λογιστής. Η επιχείρηση καταχωρεί ΜΟΝΟ ΕΙΣΕΡΧΟΜΕΝΑ παραστατικά (αγορές,',
  'έξοδα, πάγια — ποτέ πωλήσεις). Για κάθε γραμμή τιμολογίου διάλεξε έως 3 ΚΛΑΔΟΥΣ του λογιστικού',
  'σχεδίου της επιχείρησης όπου θα μπορούσε να καταχωρηθεί, ΜΟΝΟ από τον κατάλογο που σου δίνεται.',
  'Αν κανένας δεν ταιριάζει, δώσε κενή λίστα — μην μαντεύεις.',
  'ΑΠΑΝΤΑΣ ΜΟΝΟ με JSON: {"branches":[{"key":"<key>","codes":["<κωδικός κλάδου>"]}]}',
].join('\n');

/**
 * Μία κλήση μοντέλου: κείμενο πρώτα, vision ως εφεδρεία (ίδιο μοτίβο με το doc-type). Κάθε
 * πετυχημένη κλήση γράφει ΕΝΑ `logAiUsage` μέσα στο `callTextLLM`/`callTextViaVision`.
 * `null` όταν κανένας πάροχος δεν απάντησε.
 */
async function callModel(
  system: string, user: string, usage: { operation: string; refType: string; refId?: string },
): Promise<string | null> {
  const cfg = await resolveCfg();
  if (cfg.textKey) {
    try {
      return (await callTextLLM(cfg, system, user, usage)).content;
    } catch (e) {
      console.warn('[expense-ai] text model unavailable, trying vision', (e as Error).message);
    }
  }
  try {
    return (await callTextViaVision(cfg, system, user, usage)).content;
  } catch (e) {
    console.error('[expense-ai] no model available', (e as Error).message);
    return null;
  }
}

/** «ΦΠΑ γραμμής: 6%» / «ΦΠΑ γραμμών: 6%, 13% (μικτοί)» / «άγνωστος». */
export function vatLine(rates: readonly number[] | undefined): string {
  const fmt = (r: number) => `${String(r).replace('.', ',')}%`;
  if (!rates || rates.length === 0) return 'ΦΠΑ γραμμής: άγνωστος';
  if (rates.length === 1) return `ΦΠΑ γραμμής: ${fmt(rates[0])}`;
  return `ΦΠΑ γραμμών: ${rates.map(fmt).join(', ')} (μικτοί)`;
}

const groupKey = (g: Pick<AiGroupInput, 'afm' | 'pattern'>): string => `${String(g.afm ?? '').trim()}|${g.pattern}`;

/**
 * Σημείωση ΦΠΑ πάνω στην πρόταση: ο λογαριασμός της χρεοπίστωσης κωδικοποιεί συντελεστή (κατάληξη
 * `00NN` ΚΑΙ όνομα που το λέει — {@link accountVatRate}) που ΔΕΝ είναι κανένας από τους ΦΠΑ της ομάδας.
 *
 * Γιατί στον κώδικα και όχι μόνο στο prompt: ζωντανά (2026-09-21, `deepseek-chat`) το μοντέλο πήρε
 * «ΦΠΑ γραμμής: 6%» και ρητό κανόνα «προτίμησε τον λογαριασμό με τον ίδιο ΦΠΑ», και ΠΑΡΟΛΑ ΑΥΤΑ
 * έδωσε `62.00.00.0024` (24%) με βεβαιότητα 0,85 χωρίς λέξη για τον ΦΠΑ. Η δομή του σχεδίου κερδίζει
 * τη βεβαιότητα του μοντέλου — αλλά ως ΕΝΔΕΙΞΗ: η πρόταση ΔΕΝ πετιέται και η βεβαιότητα δεν
 * αλλάζει· ο χρήστης απλώς διαβάζει τη διαφωνία πριν επιβεβαιώσει.
 */
export function vatNote(c: GroundedArticle | null, rates: readonly number[] | undefined): string | null {
  if (!c || !c.link.sound || !rates || rates.length === 0) return null;
  const acc = accountVatRate(c.link.account);
  if (acc == null || rates.some((r) => Math.abs(r - acc) < 0.001)) return null;
  const fmt = (r: number) => (r === 0 ? 'άνευ ΦΠΑ' : `ΦΠΑ ${String(r).replace('.', ',')}%`);
  return `⚠ ο λογαριασμός ${c.link.account.code} είναι για ${fmt(acc)} αλλά η γραμμή έχει ${rates.map((r) => `${String(r).replace('.', ',')}%`).join(' / ')}`;
}

/** Η περιγραφή μιας ομάδας στο prompt: δείγμα, ΦΠΑ, εκδότης, σχέση, και ιστορικό ΜΟΝΟ αν υπάρχει. */
function groupBlock(
  g: AiGroupInput, iss: IssuerInfo | undefined, history: { line: string } | undefined,
  rates: readonly number[] | undefined,
): string {
  const who = [
    iss?.name ?? g.supplier ?? null,
    g.afm ? `ΑΦΜ ${g.afm}` : null,
    iss?.profession ?? null,
    // Η ΣΧΕΣΗ με τον εκδότη είναι από μόνη της ένδειξη, και τη γράφουμε με ό,τι ΣΥΝΕΠΑΓΕΤΑΙ
    // υπό τα ΕΛΠ — όχι σκέτη ετικέτα που το μοντέλο πρέπει να μεταφράσει μόνο του.
    iss ? issuerRelationLine(iss.cards) : null,
  ].filter(Boolean).join(' · ');
  return `${g.key} :: ${(g.sample ?? g.pattern).slice(0, 160)}`
    + `\n    ${vatLine(rates)}`
    + (who ? `\n    εκδότης: ${who}` : '')
    + (history ? `\n    ${history.line}` : '');
}

/**
 * Ζητά από το μοντέλο μία δαπάνη ανά ΑΝΑΠΑΝΤΗΤΗ ομάδα. Δεν πετάει ποτέ: αν και οι δύο πάροχοι
 * (κείμενο → vision) αποτύχουν, γυρίζει `degraded: true` και καμία πρόταση.
 *
 * Η λευκή λίστα χωρίς επιλεγμένη κατηγορία έχει ΔΥΟ πηγές, ενωμένες χωρίς διπλότυπα:
 *  1. ο παλιός δρόμος της ομοιότητας κειμένου (ο μόνος για χρεοπιστώσεις χωρίς έγκυρο λογαριασμό)·
 *  2. οι χρεοπιστώσεις με ΑΞΙΟΠΙΣΤΟ λογαριασμό — όλες σε μία κλήση (`single`) ή, όταν είναι
 *     πάνω από {@link MAX_GROUNDED_SINGLE}, όσες ανήκουν στους κλάδους που διάλεξε ένα φθηνό
 *     1ο στάδιο (`two-stage`) μαζί με τους κλάδους του ιστορικού του εκδότη.
 * Το `strategy` υπάρχει για τη μέτρηση και τα tests· η εφαρμογή το αφήνει στην αυτόματη επιλογή.
 */
export async function suggestExpensesWithAi(input: {
  groups: AiGroupInput[];
  categoryId?: number | null;
  userId?: string | null;
  strategy?: ShortlistStrategy;
}): Promise<AiSuggestResult> {
  const categoryId = input.categoryId ?? null;
  const groups = input.groups.slice(0, MAX_GROUPS);
  if (groups.length === 0) {
    return { suggestions: [], asked: 0, skipped: 0, cached: 0, degraded: false, ownCompanyUnknown: false };
  }

  // 1. Ο φθηνός δρόμος πρώτα — ό,τι λύνεται εδώ δεν κοστίζει τίποτα.
  const deterministic = new Map<string, QueueSuggestion[]>();
  await Promise.all(groups.map(async (g) => {
    deterministic.set(g.key, await suggestForGroup({ afm: g.afm, pattern: g.pattern, code: g.code, sample: g.sample }));
  }));
  const unresolved = groups.filter((g) => bestScore(deterministic.get(g.key) ?? []) < CONFIDENT_SCORE);
  const skipped = groups.length - unresolved.length;
  if (unresolved.length === 0) {
    // Καμία ερώτηση στο μοντέλο ⇒ καμία ταξινόμηση που θα μπορούσε να υποβαθμιστεί.
    return { suggestions: [], asked: 0, skipped, cached: 0, degraded: false, ownCompanyUnknown: false };
  }

  // ΚΕΝΗ λίστα υποψηφίων ΔΕΝ ακυρώνει πια την κλήση: το μοντέλο μπορεί να μην έχει κωδικό να
  // προτείνει και να έχει κάλλιστα άποψη για τον ΤΥΠΟ — που είναι το ερώτημα που πονάει.
  const pool = await loadGroundedPool();
  const text = textCandidates(pool, categoryId, deterministic);
  // Με επιλεγμένη κατηγορία η λίστα είναι ήδη στενή: καμία στένωση κατά κλάδο.
  const sound = categoryId ? [] : [...pool.values()]
    .filter((a) => a.link.sound)
    .sort((a, b) => (a.link.sound && b.link.sound ? a.link.account.code.localeCompare(b.link.account.code, 'el', { numeric: true }) : 0));
  const strategy: ShortlistStrategy = input.strategy ?? (sound.length <= MAX_GROUNDED_SINGLE ? 'single' : 'two-stage');
  const [history, vatRates] = await Promise.all([
    loadIssuerHistory(unresolved.map((g) => g.afm), pool),
    // Ο ΦΠΑ από τις ίδιες τις εκκρεμείς γραμμές στη βάση — όχι από το σώμα του αιτήματος.
    groupVatRates().catch(() => new Map<string, number[]>()),
  ]);

  // Η υπογραφή μπαίνει στο κλειδί της μνήμης: αλλάζει το μητρώο, ο λογαριασμός μιας
  // χρεοπίστωσης ή το όνομα ενός κλάδου ⇒ νέα ερώτηση. Καλύπτει ΟΛΟ ό,τι θα μπορούσε να φτάσει
  // στο μοντέλο (και στις δύο στρατηγικές), ώστε να είναι γνωστή ΠΡΙΝ από κάθε κλήση.
  const signature = candidateSignature([
    strategy,
    ...mergeWhitelist([text, sound], Number.MAX_SAFE_INTEGER).map(candidateSignaturePart),
  ]);
  // Ο ΦΠΑ της ομάδας μπαίνει κι αυτός στο κλειδί: άλλος ΦΠΑ ⇒ άλλη σωστή χρεοπίστωση.
  const keyOf = (g: AiGroupInput) => cacheKey(
    g, categoryId, `${signature}|${history.get(g.afm)?.line ?? ''}|${(vatRates.get(groupKey(g)) ?? []).join(',')}`,
  );

  const now = Date.now();
  const fresh: AiGroupInput[] = [];
  const out: AiSuggestion[] = [];
  let cached = 0;
  for (const g of unresolved) {
    const hit = cache.get(keyOf(g));
    if (hit && now - hit.at < CACHE_TTL_MS) {
      cached++;
      if (hit.value) out.push(hit.value);
      continue;
    }
    fresh.push(g);
  }
  if (fresh.length === 0) return { suggestions: out, asked: 0, skipped, cached, degraded: false, ownCompanyUnknown: false };

  // Ποιοι είμαστε, ποιος εκδίδει, και η ΠΡΑΓΜΑΤΙΚΗ ταξινομία της ΑΑΔΕ ως λευκή λίστα.
  const [own, issuers, myData, expenses] = await Promise.all([
    resolveOwnCompany().catch(() => UNKNOWN_OWN_COMPANY),
    loadIssuers(fresh),
    loadMyDataLists(),
    loadExpenseRegistry(),
  ]);

  // Η ΚΡΙΣΙΜΗ έλλειψη, δηλωμένη αντί να περάσει απαρατήρητη: χωρίς δραστηριότητα δεν απαντιέται
  // το «για μεταπώληση ή για ανάλωση;» — και αυτό είναι όλο το ερώτημα «προϊόν ή έξοδο;».
  const ownCompanyUnknown = own.activity == null;
  const lines = fresh.map((g) => groupBlock(g, issuers.get(g.afm), history.get(g.afm), vatRates.get(groupKey(g)))).join('\n');

  // 2. Οι χρεοπιστώσεις με αξιόπιστο λογαριασμό που θα δει το μοντέλο.
  let grounded: GroundedArticle[] = sound;
  if (strategy === 'two-stage' && sound.length) {
    const catalogue = branchCatalogue(sound);
    const allowed = new Set(catalogue.map((b) => b.code));
    const raw1 = await callModel(SYSTEM_BRANCHES, [
      `Γραμμές τιμολογίων (${fresh.length}):`,
      lines,
      '',
      `Κατάλογος κλάδων του λογιστικού σχεδίου (${catalogue.length}) — κωδικός «όνομα»:`,
      ...catalogue.map((b) => `${b.code} «${b.name}»`),
      '',
      'Το "key" είναι ΑΚΡΙΒΩΣ το κείμενο ΠΡΙΝ από το " :: " της γραμμής.',
    ].join('\n'), { operation: 'ocr.suggest_expense.branches', refType: 'OcrInvoiceItem', refId: fresh[0]?.key });
    const picked = raw1 ? parseBranchAnswer(raw1, allowed, MAX_BRANCHES_PER_GROUP) : new Map<string, string[]>();
    const chosen = new Set<string>();
    const asked = new Set(fresh.map((g) => g.key));
    for (const [k, codes] of picked) {
      if (!resolveAnswerKey(k, asked)) continue;
      codes.forEach((c) => chosen.add(c));
    }
    // Το ιστορικό του εκδότη ΔΙΕΥΡΥΝΕΙ τη λίστα, δεν τη στενεύει: ένδειξη, όχι απόφαση. Μπαίνει
    // ΠΡΩΤΟ, ώστε όταν το πλαφόν κόβει (ταξινόμηση κατά κωδικό λογαριασμού) να μην πέφτουν οι
    // κλάδοι όπου άνθρωπος έχει ήδη στείλει γραμμές αυτού του εκδότη.
    const fromHistory = new Set<string>();
    for (const g of fresh) history.get(g.afm)?.branches.forEach((b) => allowed.has(b) && fromHistory.add(b));
    grounded = mergeWhitelist(
      [articlesInBranches(sound, fromHistory), articlesInBranches(sound, chosen)],
      Number.MAX_SAFE_INTEGER,
    );
  }
  const candidates = mergeWhitelist([text, grounded], MAX_CANDIDATES_FREE + MAX_GROUNDED_SINGLE);
  const byCode = new Map(candidates.map((c) => [c.code.trim().toUpperCase(), c]));
  const list = candidates.map(candidateLine).join('\n');
  const hasGrounding = candidates.some((c) => c.link.sound);

  const user = [
    ownCompanyBlock(own),
    '',
    `Γραμμές τιμολογίων (${fresh.length}):`,
    lines,
    '',
    'Υποψήφιες δαπάνες / χρεοπιστώσεις (κωδικός — περιγραφή):',
    list || '(καμία)',
    ...(hasGrounding
      ? [
          '',
          'Όπου μια χρεοπίστωση δείχνει «→ λογαριασμός … · κλάδος …», αυτός είναι ο λογαριασμός του',
          'ΛΟΓΙΣΤΙΚΟΥ ΣΧΕΔΙΟΥ της επιχείρησης όπου θα γραφτεί η γραμμή («ίδιος κωδικός» = ο κωδικός της',
          'χρεοπίστωσης ΕΙΝΑΙ ο λογαριασμός). Είναι ΠΛΗΡΟΦΟΡΙΑ, όχι εγγύηση: ο σύνδεσμος χρεοπίστωσης →',
          'λογαριασμού μπορεί να είναι λάθος. Όταν το όνομα της χρεοπίστωσης και το όνομα του λογαριασμού',
          'λένε ΔΙΑΦΟΡΕΤΙΚΑ πράγματα (π.χ. «Ύδρευση 9%» → «Έξοδα εκθέσεων εσωτερικού»), αυτό είναι ΑΒΕΒΑΙΟΤΗΤΑ:',
          'μην τη διαλέξεις με σιγουριά, ΧΑΜΗΛΩΣΕ το confidence και ΓΡΑΨΕ τη διαφωνία στο "reason".',
          'ΦΠΑ: σε αυτό το λογιστικό σχέδιο η 4η βαθμίδα του λογαριασμού κωδικοποιεί ΣΥΧΝΑ τον ΣΥΝΤΕΛΕΣΤΗ',
          'ΦΠΑ — αλλά ΜΟΝΟ όταν το όνομα του λογαριασμού γράφει ρητά ΦΠΑ με συντελεστή («με Φ.Π.Α. 24%»,',
          '«άνευ Φ.Π.Α.»). Ποσοστό ΧΩΡΙΣ τη λέξη ΦΠΑ (π.χ. «Ποσοστά για πωλήσεις και αγορές 9%», «Φόρος',
          'προμηθευτών 5%») ΔΕΝ είναι ΦΠΑ — μην το ταιριάζεις με τον ΦΠΑ της γραμμής. Κάθε γραμμή',
          'δίνει τον ΦΠΑ της («ΦΠΑ γραμμής»). ΠΡΟΤΙΜΗΣΕ τη χρεοπίστωση της οποίας ο λογαριασμός ταιριάζει',
          'με τον ΦΠΑ της γραμμής. Αν στον σωστό κλάδο καμία δεν ταιριάζει, μπορείς να δώσεις την πιο',
          'κοντινή, αλλά ΓΡΑΨΕ στο "reason" ότι ο ΦΠΑ δεν ταιριάζει και βάλε χαμηλότερο confidence.',
          'Με μικτούς ΦΠΑ, πες το στο "reason".',
          'Χρεοπιστώσεις χωρίς «→ λογαριασμός» δεν έχουν επαληθευμένο λογαριασμό: κρίνε μόνο από το όνομα.',
        ]
      : []),
    '',
    expenses.prompt,
    '',
    myData.prompt,
    '',
    'Επέστρεψε JSON με ΜΙΑ εγγραφή ανά γραμμή. Δώσε πάντα "kind" και "reason"·',
    'το "code" μόνο όταν υπάρχει πραγματικό ταίριασμα στη λίστα υποψηφίων (ΚΩΔΙΚΟΣ ΧΡΕΟΠΙΣΤΩΣΗΣ,',
    'ποτέ λογαριασμός ή κλάδος).',
    'Το "key" είναι ΑΚΡΙΒΩΣ το κείμενο ΠΡΙΝ από το " :: " της γραμμής — αντέγραψέ το',
    'αυτούσιο, χωρίς το δείγμα και χωρίς τις γραμμές «εκδότης» / ιστορικού.',
  ].join('\n');

  const raw = await callModel(SYSTEM, user, { operation: 'ocr.suggest_expense', refType: 'OcrInvoiceItem', refId: fresh[0]?.key });
  // Κανένας πάροχος: «καμία πρόταση», ΟΧΙ σφάλμα — η ουρά συνεχίζει να δουλεύει χειροκίνητα.
  if (raw == null) return { suggestions: out, asked: 0, skipped, cached, degraded: true, ownCompanyUnknown };

  const answers = parseAiAnswer(raw);
  const askedKeys = new Set(fresh.map((g) => g.key));
  const seen = new Set<string>();
  for (const a of answers) {
    const key = resolveAnswerKey(a.key, askedKeys);
    if (!key || seen.has(key)) continue;
    // ΛΕΥΚΗ ΛΙΣΤΑ: δεκτός μόνο κωδικός χρεοπίστωσης που όντως στείλαμε. Ένας λογαριασμός ή ένας
    // κλάδος στη θέση του κωδικού δεν ταιριάζει με τίποτα εδώ και πετιέται σιωπηλά.
    const c = a.code ? byCode.get(a.code.trim().toUpperCase()) ?? null : null;
    // Ο ΤΥΠΟΣ δηλώνεται μόνο πάνω από το κατώφλι βεβαιότητας: χαμηλή βεβαιότητα ⇒ «χωρίς
    // κατηγορία», που είναι μια χρήσιμη απάντηση, όχι ένα λάθος chip.
    const kind = a.confidence >= MIN_KIND_CONFIDENCE ? KIND_WORDS[a.kind] ?? null : null;
    // Ούτε τύπος ούτε κωδικός: η απάντηση κρατιέται ΜΟΝΟ αν κουβαλά αιτιολόγηση που στέκει
    // μόνη της — τότε είναι ΠΑΡΑΤΗΡΗΣΗ, όχι επιλογή. Αυτός είναι ο δρόμος που ζητά ρητά το
    // prompt για τα ΠΑΓΙΑ («χαμηλό confidence + γράψε στο reason ότι είναι πάγιο»): πριν, η
    // απάντηση πετιόταν εδώ και ο χρήστης δεν έβλεπε ποτέ τον λόγο που του γράφτηκε.
    if (!c && !kind && !standsAlone(a.reason)) continue;
    seen.add(key);
    const note = vatNote(c, vatRates.get(groupKey(fresh.find((g) => g.key === key)!)));
    const suggestion: AiSuggestion = {
      key,
      kind,
      lin: c?.mtrl ?? null,
      code: c?.code ?? null,
      name: c?.name ?? null,
      confidence: a.confidence,
      reason: [a.reason || 'πρόταση μοντέλου', note].filter(Boolean).join(' · '),
      // Και ο χαρακτηρισμός περνά από λευκή λίστα: δεκτός μόνο αν τον στείλαμε εμείς.
      myDataType: a.mydata && myData.allowedTypes.has(a.mydata.trim()) ? a.mydata.trim() : null,
    };
    out.push(suggestion);
    cache.set(keyOf(fresh.find((g) => g.key === key)!), { at: now, value: suggestion });
  }
  // Ομάδες που το μοντέλο άφησε αναπάντητες: τις θυμόμαστε κι αυτές, για να μην ξαναπληρώσουμε.
  for (const g of fresh) {
    if (!seen.has(g.key)) cache.set(keyOf(g), { at: now, value: null });
  }

  return { suggestions: out, asked: fresh.length, skipped, cached, degraded: false, ownCompanyUnknown };
}
