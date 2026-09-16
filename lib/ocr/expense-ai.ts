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

/** Πάνω από αυτό το σκορ ο φθηνός δρόμος θεωρείται αρκετός — καμία κλήση μοντέλου. */
export const CONFIDENT_SCORE = 0.8;
/** Πόσες ομάδες το πολύ σε μία κλήση. */
export const MAX_GROUPS = 20;
/** Πόσους υποψήφιους στέλνουμε όταν ΔΕΝ έχει επιλεγεί κατηγορία δαπάνης. */
export const MAX_CANDIDATES_FREE = 40;
/** …και όταν έχει επιλεγεί (τότε η λίστα είναι ήδη στενή και τη στέλνουμε σχεδόν ολόκληρη). */
export const MAX_CANDIDATES_CATEGORY = 120;

export interface AiGroupInput {
  /** Κλειδί ομάδας όπως το ξέρει το UI (`afm|pattern`). */
  key: string;
  afm: string;
  pattern: string;
  sample?: string | null;
  code?: string | null;
}

export interface AiSuggestion {
  key: string;
  /** MTRL της χρεοπίστωσης που προτείνεται. */
  lin: number;
  code: string;
  name: string;
  /** 0–1, όπως το δήλωσε το μοντέλο (φραγμένο). */
  confidence: number;
  reason: string;
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

export interface ParsedAnswer { key: string; code: string; confidence: number; reason: string }

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
    if (!key || !code) continue;
    const c = Number(row.confidence);
    out.push({
      key,
      code,
      confidence: Number.isFinite(c) ? Math.max(0, Math.min(1, c)) : 0.5,
      reason: String(row.reason ?? '').trim().slice(0, 200),
    });
  }
  return out;
}

/** Η καλύτερη ντετερμινιστική πρόταση μιας ομάδας — αυτή κρίνει αν χρειάζεται μοντέλο. */
const bestScore = (suggestions: QueueSuggestion[]): number =>
  suggestions.reduce((max, s) => Math.max(max, s.by === 'memory' ? 1 : s.score), 0);

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

const SYSTEM = 'Είσαι λογιστής. Αντιστοιχίζεις γραμμές τιμολογίων σε κωδικούς δαπάνης (χρεοπιστώσεις) '
  + 'ενός ελληνικού ERP. Απαντάς ΜΟΝΟ με JSON της μορφής '
  + '{"matches":[{"key":"<key>","code":"<code από τη λίστα>","confidence":0.0-1.0,"reason":"<λίγες λέξεις>"}]}. '
  + 'Χρησιμοποιείς ΜΟΝΟ κωδικούς από τη λίστα υποψηφίων. Αν καμία δαπάνη δεν ταιριάζει, παραλείπεις τη γραμμή.';

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

  const candidates = await loadCandidates(unresolved, categoryId, deterministic);
  if (candidates.length === 0) {
    return { suggestions: [], asked: 0, skipped, cached: 0, degraded: false };
  }
  // Η υπογραφή των υποψηφίων μπαίνει στο κλειδί της μνήμης: αλλάζει το μητρώο ⇒ νέα ερώτηση.
  const signature = `${candidates.length}:${candidates.map((c) => c.mtrl).join(',').slice(0, 120)}`;

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
  const lines = fresh.map((g) => `${g.key} :: ${(g.sample ?? g.pattern).slice(0, 160)}`).join('\n');
  const user = `Γραμμές τιμολογίων:\n${lines}\n\nΥποψήφιες δαπάνες (κωδικός — περιγραφή):\n${list}\n\n`
    + 'Επέστρεψε JSON με μία εγγραφή ανά γραμμή που ταιριάζει.';

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
    if (!askedKeys.has(a.key) || seen.has(a.key)) continue;
    // ΛΕΥΚΗ ΛΙΣΤΑ: δεκτός μόνο κωδικός που όντως στείλαμε. Ό,τι άλλο πετιέται σιωπηλά.
    const c = byCode.get(a.code.trim().toUpperCase());
    if (!c) continue;
    seen.add(a.key);
    const suggestion: AiSuggestion = {
      key: a.key, lin: c.mtrl, code: c.code, name: c.name,
      confidence: a.confidence, reason: a.reason || 'πρόταση μοντέλου',
    };
    out.push(suggestion);
    cache.set(cacheKey(fresh.find((g) => g.key === a.key)!, categoryId, signature), { at: now, value: suggestion });
  }
  // Ομάδες που το μοντέλο άφησε αναπάντητες: τις θυμόμαστε κι αυτές, για να μην ξαναπληρώσουμε.
  for (const g of fresh) {
    if (!seen.has(g.key)) cache.set(cacheKey(g, categoryId, signature), { at: now, value: null });
  }

  return { suggestions: out, asked: fresh.length, skipped, cached, degraded: false };
}
