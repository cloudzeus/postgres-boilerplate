// lib/ocr/purpose-ai.ts — SERVER. «Τι αφορά αυτή η αγορά;» με AI, για ΜΙΑ γραμμή.
//
// Οι κανόνες του `purchase-purpose.ts` πιάνουν τα προφανή (laptop, βενζίνη, ρεύμα). Για τα υπόλοιπα
// — «NB APPLE MACBOOK PRO 14 M3/1T», «Ξεφρακάρισμα κοχλία paglierani», «SBK sdfjc09hm7g» — ρωτάμε
// το μοντέλο, με τα συμφραζόμενα που θα κοίταζε ένας άνθρωπος: εκδότης και επάγγελμά του, ποσό,
// ποσότητα, οι άλλες γραμμές του παραστατικού. Η απάντηση είναι ΠΡΟΤΑΣΗ: ο χρήστης τη βλέπει με την
// αιτιολόγηση και διαλέγει. Τρέχει ΜΟΝΟ με κλικ, ποτέ αυτόματα (κοστίζει).
import 'server-only';
import { prisma } from '@/lib/db';
import { callTextLLM, callTextViaVision, parseJsonLoose, resolveCfg } from './extract';
import { TILE_ORDER, TILES, type Tile } from './purchase-purpose';

export interface PurposeAiAnswer {
  tile: Tile;
  /** 0–1, όπως το δήλωσε το μοντέλο (φραγμένο). */
  confidence: number;
  /** Μία-δύο προτάσεις στα ελληνικά, για μη λογιστή. */
  reason: string;
  /** Λέξη για την αναζήτηση κατηγορίας εξόδου/είδους στο 2ο βήμα (π.χ. «καύσιμα», «ρεύμα»). */
  searchHint: string | null;
}

const SYSTEM = [
  'Είσαι λογιστής που βοηθά έναν ΜΗ λογιστή υπάλληλο να καταχωρίσει μια γραμμή τιμολογίου ΑΓΟΡΑΣ.',
  'Διάλεξε ΜΙΑ καθημερινή κατηγορία από τη λίστα που σου δίνεται (μόνο από αυτές):',
  ...TILE_ORDER.map((t) => `  • "${t}" = ${TILES[t].title} (${TILES[t].examples})`),
  'Κανόνες:',
  '- "equipment" (πάγιο) ΜΟΝΟ για αγορά αντικειμένου που η επιχείρηση θα κρατήσει >1 χρόνο και κοστίζει >150 € το τεμάχιο (υπολογιστής, laptop, κινητό, μηχάνημα, έπιπλο, όχημα).',
  '- Εργασία ΠΑΝΩ σε εξοπλισμό (επισκευή, συντήρηση, καθαρισμός, τοποθέτηση) είναι "services", ΟΧΙ "equipment".',
  '- Μίσθωμα/leasing/ενοίκιο ⇒ "rent". Καύσιμα, διόδια, στάθμευση, εισιτήρια ⇒ "vehicle". Ρεύμα, νερό, τηλέφωνο, internet ⇒ "bills".',
  '- Ό,τι μπαίνει σε αποθήκη για μεταπώληση ή παραγωγή ⇒ "goods". Αναλώσιμα γραφείου μικρής αξίας ⇒ "services".',
  '- Οι κωδικοί προϊόντων (π.χ. «MacBook Pro M3», «ThinkPad») φανερώνουν το αντικείμενο — χρησιμοποίησέ τους.',
  '- reason: 1-2 σύντομες προτάσεις στα ελληνικά, απλή γλώσσα, χωρίς λογιστική ορολογία.',
  '- searchHint: μία-δύο λέξεις για αναζήτηση κατηγορίας εξόδου (π.χ. "καύσιμα", "ενοίκια", "ρεύμα", "επισκευές", "λογισμικό")· null για equipment/split.',
  'ΑΠΑΝΤΑΣ ΜΟΝΟ με JSON: {"tile":"<κατηγορία>","confidence":0.0-1.0,"reason":"...","searchHint":"..."|null}',
].join('\n');

/** Η απάντηση του μοντέλου → πρόταση, ΜΟΝΟ αν η κατηγορία είναι μία από τις επιτρεπτές. */
export function parsePurposeAnswer(raw: unknown, allowed: readonly Tile[]): PurposeAiAnswer | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  const tile = String(o.tile ?? '').trim().toLowerCase() as Tile;
  if (!allowed.includes(tile)) return null;
  const c = Number(o.confidence);
  const reason = String(o.reason ?? '').trim().slice(0, 400);
  const hint = o.searchHint == null ? '' : String(o.searchHint).trim().slice(0, 40);
  return {
    tile,
    confidence: Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0.5,
    reason: reason || 'Πρόταση του μοντέλου.',
    searchHint: hint && hint.toLowerCase() !== 'null' && tile !== 'equipment' && tile !== 'split' ? hint : null,
  };
}

const cache = new Map<string, { at: number; value: PurposeAiAnswer }>();
const TTL_MS = 6 * 60 * 60 * 1000;

const num = (v: unknown) => (v == null ? null : Number(v));

/** `null` = κανένας πάροχος δεν απάντησε ή η απάντηση δεν ήταν δεκτή. */
export async function suggestPurposeWithAi(input: { lineId: string; allowed: Tile[] }): Promise<PurposeAiAnswer | null> {
  const item = await prisma.ocrInvoiceItem.findUnique({
    where: { id: input.lineId },
    select: {
      name: true, code: true, quantity: true, price: true, total: true, vatRate: true,
      document: {
        select: {
          id: true, softoneName: true, document: true,
          items: { select: { id: true, name: true, total: true }, take: 15 },
        },
      },
    },
  });
  if (!item) return null;
  const key = `${input.lineId}|${item.name}|${input.allowed.join(',')}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const canon = (item.document.document ?? {}) as { issuer?: { name?: string | null; profession?: string | null } };
  const others = item.document.items.filter((i) => i.id !== input.lineId).map((i) => `- ${i.name} (${num(i.total) ?? '?'} €)`);
  const user = [
    `Επιτρεπτές κατηγορίες: ${input.allowed.join(', ')}`,
    `Εκδότης: ${canon.issuer?.name ?? item.document.softoneName ?? 'άγνωστος'}${canon.issuer?.profession ? ` — ${canon.issuer.profession}` : ''}`,
    `Γραμμή: ${item.name}${item.code ? ` (κωδ. ${item.code})` : ''}`,
    `Ποσότητα: ${num(item.quantity) ?? '?'} · Τιμή: ${num(item.price) ?? '?'} € · Σύνολο: ${num(item.total) ?? '?'} € · ΦΠΑ: ${num(item.vatRate) ?? '?'}%`,
    others.length ? `Άλλες γραμμές του ίδιου παραστατικού:\n${others.join('\n')}` : '',
  ].filter(Boolean).join('\n');

  const usage = { operation: 'ocr.suggest_purpose', refType: 'OcrInvoiceItem', refId: input.lineId };
  const cfg = await resolveCfg();
  let content: string | null = null;
  if (cfg.textKey) {
    try { content = (await callTextLLM(cfg, SYSTEM, user, usage)).content; } catch (e) {
      console.warn('[purpose-ai] text model unavailable, trying vision', (e as Error).message);
    }
  }
  if (content == null) {
    try { content = (await callTextViaVision(cfg, SYSTEM, user, usage)).content; } catch (e) {
      console.error('[purpose-ai] no model available', (e as Error).message);
      return null;
    }
  }
  let parsed: unknown;
  try { parsed = parseJsonLoose(content ?? ''); } catch { return null; }
  const value = parsePurposeAnswer(parsed, input.allowed);
  if (value) cache.set(key, { at: Date.now(), value });
  return value;
}
