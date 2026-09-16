/**
 * Καθαρή λογική αντιστοίχισης γραμμών παραστατικού με το μητρώο SoftOne
 * (είδη/υπηρεσίες MTRL, έξοδα EXPN, χρεοπιστώσεις LINEITEM) — spec 2026-09-11 §3.
 *
 * Δεν αγγίζει DB ούτε SoftOne: κανονικοποίηση κειμένου, ομαδοποίηση όμοιων
 * γραμμών, ομοιότητα ονομάτων (Dice σε bigrams) και πρόταση τύπου συναλλασσομένου.
 */
import type { SeriesTraderKind } from '@/lib/ocr/posting-target';

// Tokens που δεν λένε τίποτα για το είδος: ποσά/ποσότητες, με ή χωρίς μονάδα.
const AMOUNT_TOKEN = /^[\d.,]+(kg|lt|ml|gr|τεμ|%)?$/;
const MAX_PATTERN = 120;

/**
 * Κανονικοποιεί το κείμενο μιας γραμμής σε «pattern»: πεζά, χωρίς τόνους,
 * χωρίς σημεία στίξης/σύμβολα, χωρίς ποσά/ποσότητες, με απλά κενά.
 * Το ίδιο pattern είναι το κλειδί της μνήμης (`LineMatchRule.pattern`).
 */
export function normalizeLineText(raw: string | null | undefined): string {
  const flat = String(raw ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')     // τόνοι/διαλυτικά
    .replace(/[^\p{L}\p{N}]+/gu, ' ')    // στίξη & σύμβολα → κενό
    .trim();
  if (!flat) return '';
  return flat
    .split(/\s+/)
    .filter((t) => t && !AMOUNT_TOKEN.test(t))
    .join(' ')
    .slice(0, MAX_PATTERN)
    .trim();
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/**
 * Συντελεστής Dice (0–1) πάνω σε bigrams χαρακτήρων των κανονικοποιημένων
 * κειμένων — συμμετρικός, 1 για ταυτόσημα, 0 για ξένα μεταξύ τους.
 */
export function dice(a: string | null | undefined, b: string | null | undefined): number {
  const x = normalizeLineText(a);
  const y = normalizeLineText(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const bx = bigrams(x);
  const by = bigrams(y);
  let nx = 0;
  let ny = 0;
  for (const n of bx.values()) nx += n;
  for (const n of by.values()) ny += n;
  if (nx === 0 || ny === 0) return 0;
  let inter = 0;
  for (const [g, n] of bx) inter += Math.min(n, by.get(g) ?? 0);
  return (2 * inter) / (nx + ny);
}

/**
 * Σε τι μπορεί να αντιστοιχιστεί μια γραμμή. Το `lineitem` είναι η ΧΡΕΟΠΙΣΤΩΣΗ (SoftOne object
 * LINEITEM → MTRL με SODTYPE 53): το μόνο πράγμα που δέχεται το `MTRL` μιας γραμμής LINLINES,
 * δηλαδή των «Ειδικών συναλλαγών» — δεν είναι ούτε είδος, ούτε υπηρεσία, ούτε έξοδο EXPN.
 */
export type MatchKind = 'product' | 'service' | 'expense' | 'lineitem';
export type MatchedBy = 'code2' | 'code1' | 'code' | 'name';

export interface MatchCandidate {
  id: string;
  kind: MatchKind;
  code: string;
  name: string;
  code1: string | null;   // EAN / barcode
  code2: string | null;   // κωδικός εργοστασίου
}
export interface ScoredCandidate extends MatchCandidate {
  score: number;
  by: MatchedBy;
}

/** Κάτω από αυτό το σκορ η πρόταση ονόματος δεν αξίζει να δειχτεί. */
export const MIN_NAME_SCORE = 0.3;
const BY_ORDER: MatchedBy[] = ['code2', 'code1', 'code', 'name'];

const sameCode = (a: string, b: string | null | undefined) =>
  !!b && a === String(b).trim().toLowerCase();

/**
 * Βαθμολογεί υποψήφια είδη/υπηρεσίες/έξοδα για μια γραμμή: ακριβής κωδικός
 * (εργοστασίου → barcode → κωδικός) = 1, αλλιώς ομοιότητα ονόματος. Επιστρέφει
 * τα καλύτερα `limit` με σκορ ≥ {@link MIN_NAME_SCORE}, φθίνουσα σειρά.
 */
export function scoreCandidates(
  line: { code?: string | null; name?: string | null },
  candidates: MatchCandidate[],
  limit = 5,
): ScoredCandidate[] {
  const code = String(line.code ?? '').trim().toLowerCase();
  const out: ScoredCandidate[] = [];
  for (const c of candidates) {
    let by: MatchedBy | null = null;
    if (code) {
      if (sameCode(code, c.code2)) by = 'code2';
      else if (sameCode(code, c.code1)) by = 'code1';
      else if (sameCode(code, c.code)) by = 'code';
    }
    if (by) { out.push({ ...c, score: 1, by }); continue; }
    const score = dice(line.name, c.name);
    if (score >= MIN_NAME_SCORE) out.push({ ...c, score, by: 'name' });
  }
  out.sort((a, b) => (b.score - a.score) || (BY_ORDER.indexOf(a.by) - BY_ORDER.indexOf(b.by)));
  return out.slice(0, limit);
}

export interface LineForGrouping {
  id: string;
  /** ΑΦΜ εκδότη ('' / null για άγνωστο). */
  afm?: string | null;
  docId: string;
  name: string;
  code?: string | null;
}
export interface LineGroup {
  key: string;
  afm: string;
  pattern: string;
  /** Ο πρώτος μη κενός κωδικός γραμμής της ομάδας (για αναζήτηση με κωδικό). */
  code: string | null;
  /** Αντιπροσωπευτικό κείμενο (το πρώτο όπως τυπώθηκε). */
  sample: string;
  lineIds: string[];
  docIds: string[];
  docCount: number;
}

/**
 * Ομαδοποιεί γραμμές κατά (ΑΦΜ εκδότη, κανονικοποιημένο κείμενο), ώστε μία
 * απόφαση του χρήστη να εφαρμόζεται σε όλες τις όμοιες γραμμές. Σειρά: πρώτα
 * οι ομάδες με τις περισσότερες γραμμές.
 */
export function groupLines(lines: LineForGrouping[]): LineGroup[] {
  const map = new Map<string, LineGroup>();
  for (const l of lines) {
    const pattern = normalizeLineText(l.name);
    if (!pattern) continue;
    const afm = String(l.afm ?? '').trim();
    const key = `${afm}|${pattern}`;
    let g = map.get(key);
    if (!g) {
      g = { key, afm, pattern, code: null, sample: l.name, lineIds: [], docIds: [], docCount: 0 };
      map.set(key, g);
    }
    g.lineIds.push(l.id);
    if (!g.code && String(l.code ?? '').trim()) g.code = String(l.code).trim();
    if (!g.docIds.includes(l.docId)) g.docIds.push(l.docId);
    g.docCount = g.docIds.length;
  }
  return Array.from(map.values()).sort((a, b) => b.lineIds.length - a.lineIds.length);
}

/**
 * Προτείνει τύπο συναλλασσομένου για έναν εκδότη. Η ΣΕΙΡΑ του παραστατικού είναι η ισχυρότερη
 * ένδειξη — αν κάποιο έγγραφό του έπεσε σε σειρά χρεωστών ή πιστωτών, αυτό είναι· ο χρεώστης
 * προηγείται γιατί είναι η πιο ρητή (και σπανιότερη) ταξινόμηση. Αλλιώς κρίνει το είδος των
 * παραστατικών: κατά πλειοψηφία υπηρεσίες → πιστωτής, αλλιώς προμηθευτής.
 *
 * Είναι ΜΟΝΟ πρόταση: ο χρήστης τη γυρίζει με ένα κλικ στην ουρά.
 */
export function suggestTraderKind(input: {
  seriesKinds: SeriesTraderKind[];
  invoiceKinds: (string | null | undefined)[];
}): 'supplier' | 'creditor' | 'debtor' {
  if (input.seriesKinds.some((k) => k === 'debtor')) return 'debtor';
  if (input.seriesKinds.some((k) => k === 'creditor')) return 'creditor';
  const kinds = input.invoiceKinds.filter(Boolean) as string[];
  if (kinds.length === 0) return 'supplier';
  const services = kinds.filter((k) => k === 'service').length;
  return services >= kinds.length / 2 ? 'creditor' : 'supplier';
}
