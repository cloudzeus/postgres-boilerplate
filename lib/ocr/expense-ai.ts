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
import { suggestForGroup, type QueueSuggestion } from './queues';
import { resolveOwnCompany, type OwnCompanyProfile } from './own-company';
import { AI_CONFIDENT_SCORE, bestSuggestionScore } from './ai-apply';
import type { MatchKind } from './line-match';

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

type Candidate = { mtrl: number; code: string; name: string; category: string | null };

/** Οι υποψήφιες χρεοπιστώσεις: της επιλεγμένης κατηγορίας, αλλιώς οι κορυφαίες κατά ομοιότητα. */
async function loadCandidates(
  groups: AiGroupInput[], categoryId: number | null, deterministic: Map<string, QueueSuggestion[]>,
): Promise<Candidate[]> {
  if (categoryId) {
    const rows = await prisma.softoneLineItem.findMany({
      where: { isActive: true, mtrCategory: categoryId },
      orderBy: { name: 'asc' },
      take: MAX_CANDIDATES_CATEGORY,
      select: { mtrl: true, code: true, name: true, mtrCategory: true },
    });
    const cat = await prisma.softoneLineCategory.findUnique({
      where: { mtrCategory: categoryId }, select: { name: true },
    });
    return rows.map((r) => ({ mtrl: r.mtrl, code: r.code, name: r.name, category: cat?.name ?? null }));
  }

  // Χωρίς κατηγορία: οι χρεοπιστώσεις που ήδη βρήκε το string-matching για ΟΛΕΣ τις ομάδες,
  // κατά φθίνον σκορ. Δεν στέλνουμε ποτέ ολόκληρο το μητρώο.
  const scored = new Map<number, number>();
  for (const list of deterministic.values()) {
    for (const s of list) {
      if (s.lin == null) continue;
      scored.set(s.lin, Math.max(scored.get(s.lin) ?? 0, s.score));
    }
  }
  const top = Array.from(scored.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_CANDIDATES_FREE)
    .map(([mtrl]) => mtrl);
  if (top.length === 0) return [];
  const rows = await prisma.softoneLineItem.findMany({
    where: { mtrl: { in: top }, isActive: true },
    select: { mtrl: true, code: true, name: true, mtrCategory: true },
  });
  const catIds = Array.from(new Set(rows.map((r) => r.mtrCategory).filter((v): v is number => v != null)));
  const cats = catIds.length
    ? await prisma.softoneLineCategory.findMany({ where: { mtrCategory: { in: catIds } }, select: { mtrCategory: true, name: true } })
    : [];
  const catName = new Map(cats.map((c) => [c.mtrCategory, c.name]));
  return rows.map((r) => ({
    mtrl: r.mtrl, code: r.code, name: r.name,
    category: r.mtrCategory != null ? catName.get(r.mtrCategory) ?? null : null,
  }));
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

/** Στοιχεία εκδότη από τον τοπικό καθρέφτη — επωνυμία, δραστηριότητα, σχέση μαζί μας. */
type IssuerInfo = { name: string | null; profession: string | null; kind: string | null };

/**
 * Ποιος εκδίδει: μία ανάγνωση για όλες τις ομάδες. Η **σχέση** (προμηθευτής / πιστωτής /
 * χρεώστης) είναι αφ' εαυτής ένδειξη — καρτέλα πιστωτή σημαίνει δαπάνη, όχι εμπόρευμα.
 */
async function loadIssuers(groups: readonly AiGroupInput[]): Promise<Map<string, IssuerInfo>> {
  const afms = Array.from(new Set(groups.map((g) => g.afm).filter(Boolean)));
  const out = new Map<string, IssuerInfo>();
  if (afms.length === 0) return out;
  const rows = await prisma.softoneTrader
    .findMany({
      where: { afm: { in: afms }, isActive: true },
      select: { afm: true, name: true, profession: true, kind: true },
    })
    .catch(() => [] as { afm: string | null; name: string; profession: string | null; kind: string }[]);
  for (const r of rows) {
    if (!r.afm || out.has(r.afm)) continue;
    out.set(r.afm, { name: r.name ?? null, profession: r.profession ?? null, kind: r.kind ?? null });
  }
  return out;
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

/** Ποιοι είμαστε, σε τρεις γραμμές prompt — με ΡΗΤΟ «άγνωστο» όπου δεν ξέρουμε. */
function ownCompanyBlock(own: OwnCompanyProfile): string {
  const name = own.name ?? '(άγνωστη επωνυμία)';
  const afm = own.afm ?? '(άγνωστο ΑΦΜ)';
  const activity = own.activity
    ?? 'ΑΓΝΩΣΤΗ — δεν έχει καταχωρηθεί δραστηριότητα· ΜΗΝ υποθέσεις εμπορία ή μεταπώληση.';
  return `Η ΔΙΚΗ ΜΑΣ ΕΠΙΧΕΙΡΗΣΗ (ο αγοραστής):\n  Επωνυμία: ${name}\n  ΑΦΜ: ${afm}\n  Δραστηριότητα: ${activity}`;
}

/**
 * Ζητά από το μοντέλο μία δαπάνη ανά ΑΝΑΠΑΝΤΗΤΗ ομάδα. Δεν πετάει ποτέ: αν και οι δύο πάροχοι
 * (κείμενο → vision) αποτύχουν, γυρίζει `degraded: true` και καμία πρόταση.
 */
export async function suggestExpensesWithAi(input: {
  groups: AiGroupInput[];
  categoryId?: number | null;
  userId?: string | null;
}): Promise<AiSuggestResult> {
  const categoryId = input.categoryId ?? null;
  const groups = input.groups.slice(0, MAX_GROUPS);
  if (groups.length === 0) return { suggestions: [], asked: 0, skipped: 0, cached: 0, degraded: false };

  // 1. Ο φθηνός δρόμος πρώτα — ό,τι λύνεται εδώ δεν κοστίζει τίποτα.
  const deterministic = new Map<string, QueueSuggestion[]>();
  await Promise.all(groups.map(async (g) => {
    deterministic.set(g.key, await suggestForGroup({ afm: g.afm, pattern: g.pattern, code: g.code, sample: g.sample }));
  }));
  const unresolved = groups.filter((g) => bestScore(deterministic.get(g.key) ?? []) < CONFIDENT_SCORE);
  const skipped = groups.length - unresolved.length;
  if (unresolved.length === 0) {
    return { suggestions: [], asked: 0, skipped, cached: 0, degraded: false };
  }

  // ΚΕΝΗ λίστα υποψηφίων ΔΕΝ ακυρώνει πια την κλήση: το μοντέλο μπορεί να μην έχει κωδικό να
  // προτείνει και να έχει κάλλιστα άποψη για τον ΤΥΠΟ — που είναι το ερώτημα που πονάει.
  const candidates = await loadCandidates(unresolved, categoryId, deterministic);
  // Η υπογραφή των υποψηφίων μπαίνει στο κλειδί της μνήμης: αλλάζει το μητρώο ⇒ νέα ερώτηση.
  // ΟΛΟΚΛΗΡΟ το σύνολο, όχι τα πρώτα λίγα: μια μετονομασία βαθιά στη λίστα πρέπει να την ακυρώνει.
  const signature = candidateSignature(candidates.map((c) => `${c.mtrl}:${c.code}:${c.name}`));

  const now = Date.now();
  const fresh: AiGroupInput[] = [];
  const out: AiSuggestion[] = [];
  let cached = 0;
  for (const g of unresolved) {
    const hit = cache.get(cacheKey(g, categoryId, signature));
    if (hit && now - hit.at < CACHE_TTL_MS) {
      cached++;
      if (hit.value) out.push(hit.value);
      continue;
    }
    fresh.push(g);
  }
  if (fresh.length === 0) return { suggestions: out, asked: 0, skipped, cached, degraded: false };

  const byCode = new Map(candidates.map((c) => [c.code.trim().toUpperCase(), c]));
  const list = candidates.map((c) => `${c.code} — ${c.name}${c.category ? ` [${c.category}]` : ''}`).join('\n');

  // Ποιοι είμαστε, ποιος εκδίδει, και η ΠΡΑΓΜΑΤΙΚΗ ταξινομία της ΑΑΔΕ ως λευκή λίστα.
  const [own, issuers, myData] = await Promise.all([
    resolveOwnCompany().catch(() => ({ afm: null, name: null, activity: null })),
    loadIssuers(fresh),
    loadMyDataLists(),
  ]);

  const lines = fresh.map((g) => {
    const iss = issuers.get(g.afm);
    const who = [
      iss?.name ?? g.supplier ?? null,
      g.afm ? `ΑΦΜ ${g.afm}` : null,
      iss?.profession ?? null,
      // Η ΣΧΕΣΗ με τον εκδότη είναι από μόνη της ένδειξη: καρτέλα πιστωτή σημαίνει δαπάνη,
      // όχι εμπόρευμα (οι σειρές πιστωτών καταχωρούν σε «Ειδικές συναλλαγές»).
      iss?.kind ? `σχέση: ${iss.kind}` : null,
    ].filter(Boolean).join(' · ');
    return `${g.key} :: ${(g.sample ?? g.pattern).slice(0, 160)}${who ? `\n    εκδότης: ${who}` : ''}`;
  }).join('\n');

  const user = [
    ownCompanyBlock(own),
    '',
    `Γραμμές τιμολογίων (${fresh.length}):`,
    lines,
    '',
    'Υποψήφιες δαπάνες / χρεοπιστώσεις (κωδικός — περιγραφή):',
    list || '(καμία)',
    '',
    myData.prompt,
    '',
    'Επέστρεψε JSON με ΜΙΑ εγγραφή ανά γραμμή. Δώσε πάντα "kind" και "reason"·',
    'το "code" μόνο όταν υπάρχει πραγματικό ταίριασμα στη λίστα υποψηφίων.',
    'Το "key" είναι ΑΚΡΙΒΩΣ το κείμενο ΠΡΙΝ από το " :: " της γραμμής — αντέγραψέ το',
    'αυτούσιο, χωρίς το δείγμα και χωρίς τη γραμμή «εκδότης».',
  ].join('\n');

  const usage = { operation: 'ocr.suggest_expense', refType: 'OcrInvoiceItem', refId: fresh[0]?.key };
  const cfg = await resolveCfg();
  let raw: string | null = null;
  // Το κλειδί κειμένου μπορεί να λείπει ή να απαντά 401 — το vision endpoint είναι επίσης
  // OpenAI-compatible και σηκώνει την ίδια text-only κλήση (ίδιο μοτίβο με το doc-type).
  if (cfg.textKey) {
    try {
      raw = (await callTextLLM(cfg, SYSTEM, user, usage)).content;
    } catch (e) {
      console.warn('[expense-ai] text model unavailable, trying vision', (e as Error).message);
    }
  }
  if (raw == null) {
    try {
      raw = (await callTextViaVision(cfg, SYSTEM, user, usage)).content;
    } catch (e) {
      // Κανένας πάροχος: «καμία πρόταση», ΟΧΙ σφάλμα — η ουρά συνεχίζει να δουλεύει χειροκίνητα.
      console.error('[expense-ai] no model available', (e as Error).message);
      return { suggestions: out, asked: 0, skipped, cached, degraded: true };
    }
  }

  const answers = parseAiAnswer(raw);
  const askedKeys = new Set(fresh.map((g) => g.key));
  const seen = new Set<string>();
  for (const a of answers) {
    const key = resolveAnswerKey(a.key, askedKeys);
    if (!key || seen.has(key)) continue;
    // ΛΕΥΚΗ ΛΙΣΤΑ: δεκτός μόνο κωδικός που όντως στείλαμε. Ό,τι άλλο πετιέται σιωπηλά.
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
    const suggestion: AiSuggestion = {
      key,
      kind,
      lin: c?.mtrl ?? null,
      code: c?.code ?? null,
      name: c?.name ?? null,
      confidence: a.confidence,
      reason: a.reason || 'πρόταση μοντέλου',
      // Και ο χαρακτηρισμός περνά από λευκή λίστα: δεκτός μόνο αν τον στείλαμε εμείς.
      myDataType: a.mydata && myData.allowedTypes.has(a.mydata.trim()) ? a.mydata.trim() : null,
    };
    out.push(suggestion);
    cache.set(cacheKey(fresh.find((g) => g.key === key)!, categoryId, signature), { at: now, value: suggestion });
  }
  // Ομάδες που το μοντέλο άφησε αναπάντητες: τις θυμόμαστε κι αυτές, για να μην ξαναπληρώσουμε.
  for (const g of fresh) {
    if (!seen.has(g.key)) cache.set(cacheKey(g, categoryId, signature), { at: now, value: null });
  }

  return { suggestions: out, asked: fresh.length, skipped, cached, degraded: false };
}
