// lib/ocr/analytics-ai.ts — SERVER. «Σε ποιο κέντρο κόστους / έργο / δραστηριότητα ανήκει αυτή
// η γραμμή;» με το μοντέλο, και τα ΤΡΙΑ σε μία κλήση.
//
// Ίδιοι κανόνες με το `expense-ai.ts`: τρέχει ΜΟΝΟ με κλικ, σε παρτίδες, με περιορισμένη λίστα
// υποψηφίων (κωδικός + όνομα, ποτέ ολόκληρο το μητρώο), με ΛΕΥΚΗ ΛΙΣΤΑ ανά πεδίο ώστε κανένας
// επινοημένος κωδικός να μην περνά, με κρυφή μνήμη, και με «καμία πρόταση» αντί για σφάλμα όταν
// δεν απαντά κανένας πάροχος.
//
// Το μοντέλο ΠΡΟΤΕΙΝΕΙ. Η τιμή γράφεται μόνο όταν την επιβεβαιώσει ο χρήστης — και τότε τη
// θυμάται ο κανόνας (`LineMatchRule`), οπότε η επόμενη ίδια γραμμή είναι δωρεάν.
import 'server-only';
import { prisma } from '@/lib/db';
import { callTextLLM, callTextViaVision, resolveCfg } from './extract';
import { candidateSignature, MAX_GROUPS, type AiGroupInput } from './expense-ai';

/** Πόσους υποψήφιους στέλνουμε ανά πεδίο. Μικρό επίτηδες: η λίστα είναι για επιλογή, όχι για dump. */
export const MAX_CANDIDATES = 60;

export interface AnalyticsSuggestion {
  key: string;
  costCntr: number | null;
  prjc: number | null;
  prjcStage: number | null;
  /** Ετικέτες για το UI («ΚΚ01 — ΠΑΡΑΓΩΓΗ»). */
  labels: { costCntr: string | null; prjc: string | null; prjcStage: string | null };
  confidence: number;
  reason: string;
}

export interface AnalyticsAiResult {
  suggestions: AnalyticsSuggestion[];
  asked: number;
  cached: number;
  /** `true` όταν κανένας πάροχος δεν απάντησε — «καμία πρόταση», όχι σφάλμα. */
  degraded: boolean;
}

type Candidate = { id: number; code: string; name: string };

const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { at: number; value: AnalyticsSuggestion | null }>();

/** Μόνο για tests. */
export const clearAnalyticsAiCache = (): void => cache.clear();

const label = (c: Candidate | undefined): string | null => (c ? `${c.code} — ${c.name}` : null);

/** Καθαρός parser — ίδια ανοχή με του `expense-ai` (fences, σκουπίδια γύρω από το JSON). */
export interface ParsedAnalytics {
  key: string; costCntr: string | null; prjc: string | null; prjcStage: string | null;
  confidence: number; reason: string;
}

export function parseAnalyticsAnswer(raw: string): ParsedAnalytics[] {
  const body = String(raw ?? '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
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
  const out: ParsedAnalytics[] = [];
  for (const row of list as Record<string, unknown>[]) {
    if (!row || typeof row !== 'object') continue;
    const key = String(row.key ?? '').trim();
    if (!key) continue;
    const str = (v: unknown) => {
      const t = String(v ?? '').trim();
      return t ? t : null;
    };
    const c = Number(row.confidence);
    out.push({
      key,
      costCntr: str(row.costCntr),
      prjc: str(row.prjc),
      prjcStage: str(row.prjcStage),
      confidence: Number.isFinite(c) ? Math.max(0, Math.min(1, c)) : 0.5,
      reason: String(row.reason ?? '').trim().slice(0, 200),
    });
  }
  return out;
}

const SYSTEM = 'Είσαι λογιστής σε ελληνικό ERP. Για κάθε γραμμή τιμολογίου προτείνεις κέντρο κόστους, '
  + 'έργο και κατηγορία δραστηριότητας, ΜΟΝΟ από τις λίστες υποψηφίων που σου δίνονται. '
  + 'Απαντάς ΜΟΝΟ με JSON: {"matches":[{"key":"<key>","costCntr":"<code|null>","prjc":"<code|null>",'
  + '"prjcStage":"<code|null>","confidence":0.0-1.0,"reason":"<λίγες λέξεις>"}]}. '
  + 'Αν δεν είσαι σίγουρος για ένα πεδίο, βάζεις null σε αυτό — ποτέ κωδικό εκτός λίστας.';

const listOf = (rows: Candidate[]): string =>
  rows.map((r) => `${r.code} — ${r.name}`).join('\n') || '(καμία)';

/**
 * Προτείνει την αναλυτική για τις ομάδες που δόθηκαν. Δεν κρίνει «λύθηκε ή όχι» όπως το
 * `expense-ai`: κέντρο κόστους / έργο / δραστηριότητα ΔΕΝ βγαίνουν από ομοιότητα κειμένου, οπότε
 * δεν υπάρχει φθηνός δρόμος να προηγηθεί. Ό,τι ήδη θυμάται ο κανόνας το φιλτράρει ο καλών.
 */
export async function suggestAnalyticsWithAi(input: {
  groups: AiGroupInput[];
  /** TRDR του εκδότη — περιορίζει τα έργα σε αυτά ΤΟΥ συναλλασσομένου, όταν υπάρχουν. */
  trdr?: number | null;
  userId?: string | null;
}): Promise<AnalyticsAiResult> {
  const groups = input.groups.slice(0, MAX_GROUPS);
  if (groups.length === 0) return { suggestions: [], asked: 0, cached: 0, degraded: false };

  const trdr = input.trdr && input.trdr > 0 ? input.trdr : null;
  const [costCenters, projectsForTrader, stages] = await Promise.all([
    prisma.softoneCostCenter.findMany({
      where: { isActive: true }, orderBy: { name: 'asc' }, take: MAX_CANDIDATES,
      select: { costcntr: true, code: true, name: true },
    }),
    prisma.softoneProject.findMany({
      where: { isActive: true, ...(trdr ? { trdr } : {}) }, orderBy: { name: 'asc' }, take: MAX_CANDIDATES,
      select: { prjc: true, code: true, name: true },
    }),
    prisma.softoneProjectStage.findMany({
      where: { isActive: true }, orderBy: { name: 'asc' }, take: MAX_CANDIDATES,
      select: { prjcStage: true, code: true, name: true },
    }),
  ]);
  // Χωρίς έργα του συγκεκριμένου συναλλασσομένου, πέφτουμε στη γενική λίστα — αλλιώς το μοντέλο
  // θα έβλεπε κενή λίστα και θα «βοηθούσε» εφευρίσκοντας.
  const projects = projectsForTrader.length > 0 || !trdr
    ? projectsForTrader
    : await prisma.softoneProject.findMany({
        where: { isActive: true }, orderBy: { name: 'asc' }, take: MAX_CANDIDATES,
        select: { prjc: true, code: true, name: true },
      });

  const cc: Candidate[] = costCenters.map((r) => ({ id: r.costcntr, code: r.code, name: r.name }));
  const pj: Candidate[] = projects.map((r) => ({ id: r.prjc, code: r.code, name: r.name }));
  const st: Candidate[] = stages.map((r) => ({ id: r.prjcStage, code: r.code, name: r.name }));
  if (cc.length === 0 && pj.length === 0 && st.length === 0) {
    return { suggestions: [], asked: 0, cached: 0, degraded: false };
  }

  const signature = candidateSignature([
    ...cc.map((c) => `c${c.id}:${c.code}:${c.name}`),
    ...pj.map((c) => `p${c.id}:${c.code}:${c.name}`),
    ...st.map((c) => `s${c.id}:${c.code}:${c.name}`),
  ]);
  const keyOf = (g: AiGroupInput) => `${g.afm}|${g.pattern}|${trdr ?? ''}|${signature}`;

  const now = Date.now();
  const out: AnalyticsSuggestion[] = [];
  const fresh: AiGroupInput[] = [];
  let cached = 0;
  for (const g of groups) {
    const hit = cache.get(keyOf(g));
    if (hit && now - hit.at < CACHE_TTL_MS) {
      cached++;
      if (hit.value) out.push(hit.value);
      continue;
    }
    fresh.push(g);
  }
  if (fresh.length === 0) return { suggestions: out, asked: 0, cached, degraded: false };

  const lines = fresh.map((g) => `${g.key} :: ${(g.sample ?? g.pattern).slice(0, 160)}`).join('\n');
  const user = `Γραμμές τιμολογίων:\n${lines}\n\n`
    + `Κέντρα κόστους:\n${listOf(cc)}\n\nΈργα:\n${listOf(pj)}\n\nΚατηγορίες δραστηριότητας:\n${listOf(st)}\n\n`
    + 'Επέστρεψε JSON με μία εγγραφή ανά γραμμή.';

  const usage = { operation: 'ocr.suggest_costcenter', refType: 'OcrInvoiceItem', refId: fresh[0]?.key };
  const cfg = await resolveCfg();
  let raw: string | null = null;
  if (cfg.textKey) {
    try {
      raw = (await callTextLLM(cfg, SYSTEM, user, usage)).content;
    } catch (e) {
      console.warn('[analytics-ai] text model unavailable, trying vision', (e as Error).message);
    }
  }
  if (raw == null) {
    try {
      raw = (await callTextViaVision(cfg, SYSTEM, user, usage)).content;
    } catch (e) {
      console.error('[analytics-ai] no model available', (e as Error).message);
      return { suggestions: out, asked: 0, cached, degraded: true };
    }
  }

  // ΛΕΥΚΗ ΛΙΣΤΑ ΑΝΑ ΠΕΔΙΟ: ένας κωδικός που δεν στάλθηκε πετιέται, χωρίς να ακυρώνει τα υπόλοιπα.
  const byCode = (rows: Candidate[]) => new Map(rows.map((r) => [r.code.trim().toUpperCase(), r]));
  const ccByCode = byCode(cc);
  const pjByCode = byCode(pj);
  const stByCode = byCode(st);
  const pick = (m: Map<string, Candidate>, code: string | null) =>
    (code ? m.get(code.trim().toUpperCase()) : undefined);

  const askedKeys = new Set(fresh.map((g) => g.key));
  const seen = new Set<string>();
  for (const a of parseAnalyticsAnswer(raw)) {
    if (!askedKeys.has(a.key) || seen.has(a.key)) continue;
    const c = pick(ccByCode, a.costCntr);
    const p = pick(pjByCode, a.prjc);
    const t = pick(stByCode, a.prjcStage);
    seen.add(a.key);
    if (!c && !p && !t) {
      cache.set(keyOf(fresh.find((g) => g.key === a.key)!), { at: now, value: null });
      continue;
    }
    const suggestion: AnalyticsSuggestion = {
      key: a.key,
      costCntr: c?.id ?? null, prjc: p?.id ?? null, prjcStage: t?.id ?? null,
      labels: { costCntr: label(c), prjc: label(p), prjcStage: label(t) },
      confidence: a.confidence,
      reason: a.reason || 'πρόταση μοντέλου',
    };
    out.push(suggestion);
    cache.set(keyOf(fresh.find((g) => g.key === a.key)!), { at: now, value: suggestion });
  }
  for (const g of fresh) {
    if (!seen.has(g.key)) cache.set(keyOf(g), { at: now, value: null });
  }

  return { suggestions: out, asked: fresh.length, cached, degraded: false };
}
