// lib/kad.ts — ΚΑΘΑΡΟ. ΚΑΔ της ΑΑΔΕ → γραμμή του μητρώου ΚΑΔ του SoftOne (`KADTAXIS`).
//
// Η καρτέλα συναλλασσομένου κρατά τον ΚΑΔ στο `<SUP|CRE|DEB>EXTRA.KAD` (κύρια) και `KAD1`
// (δευτερεύουσα): αριθμητικό κλειδί `KADTAXIS.KADTAXIS`, ΟΧΙ ο κωδικός.
//
// ΓΙΑΤΙ ΟΧΙ ΑΠΛΗ ΣΥΓΚΡΙΣΗ ΚΩΔΙΚΟΥ: η ΑΑΔΕ δίνει πλέον τους ΝΕΟΥΣ ΚΑΔ (NACE Rev. 2.1), ενώ το μητρώο
// της εγκατάστασης μπορεί να έχει ακόμη τους παλιούς. Ο ίδιος κωδικός σημαίνει άλλο πράγμα: το
// 46.72.01.00 της ΑΑΔΕ είναι «χονδρικό εμπόριο ελαστικών», το 46.72 του SoftOne «μετάλλων και
// μεταλλευμάτων»· το 46.71.11.02 «τροχόσπιτα» έναντι «γαιανθράκων». Γι' αυτό:
//   1. ίδιος κωδικός ΚΑΙ η περιγραφή συμφωνεί  → «matched»
//   2. αλλιώς η πιο ειδική γραμμή που συμφωνεί ΚΑΤΑ ΠΕΡΙΓΡΑΦΗ  → «suggested» (ο χρήστης το βλέπει)
//   3. τίποτα αξιόπιστο  → «missing», με σημείωση — ποτέ μαντεψιά.

export interface KadRow {
  /** `KADTAXIS.KADTAXIS` — το κλειδί που γράφεται στην καρτέλα. */
  id: number;
  /** Κωδικός με τελείες, π.χ. «45.31.11». */
  code: string;
  name: string;
  isActive: boolean;
}

/** Μία δραστηριότητα από το μητρώο ΑΑΔΕ (`firm_act_tab`). */
export interface AadeActivity {
  /** Ψηφία, π.χ. «46720100». */
  code: string;
  descr: string;
  /** «1» κύρια, «2» δευτερεύουσα, κ.λπ. */
  kind: string;
}

export type KadMapping =
  | { status: 'matched' | 'suggested'; row: KadRow; aade: AadeActivity; note: string | null }
  | { status: 'missing'; row: null; aade: AadeActivity | null; note: string }
  | { status: 'unavailable'; row: null; aade: AadeActivity | null; note: string };

/** Μόνο τα ψηφία, χωρίς τα μηδενικά της ουράς (το «46.72» και το «46720000» είναι το ίδιο). */
export function normalizeKadCode(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '').replace(/0+$/, '');
}

// Λέξεις που δεν λένε ΤΙ πουλά/κάνει η επιχείρηση. Οι «ΧΟΝΔΡ»/«ΛΙΑΝ» ΜΕΝΟΥΝ — χονδρικό και λιανικό
// είναι διαφορετικοί ΚΑΔ.
const STOP = new Set([
  'ΚΑΙ', 'ΤΟΥ', 'ΤΗΣ', 'ΤΩΝ', 'ΤΟΝ', 'ΤΗΝ', 'ΜΕ', 'ΣΕ', 'ΑΠΟ', 'ΓΙΑ', 'ΠΟΥ', 'ΔΕΝ', 'ΩΣ', 'ΗΤΟΙ', 'ΟΠΩΣ', 'ΕΠΙ',
  'ΥΠΗΡΕΣΙΕΣ', 'ΥΠΗΡΕΣΙΩΝ', 'ΥΠΗΡΕΣΙΑ', 'ΕΜΠΟΡΙΟ', 'ΕΜΠΟΡΙΟΥ', 'ΑΛΛΩΝ', 'ΑΛΛΑ', 'ΑΛΛΕΣ', 'ΑΛΛΟ', 'ΑΛΛΟΥ',
  'ΑΛΛΗ', 'ΑΛΛΟΙ', 'ΕΙΔΩΝ', 'ΕΙΔΗ', 'ΔΡΑΣΤΗΡΙΟΤΗΤΕΣ', 'ΔΡΑΣΤΗΡΙΟΤΗΤΩΝ', 'ΠΑΡΟΧΗ', 'ΠΑΡΟΧΗΣ', 'ΠΩΛΗΣΗ', 'ΠΩΛΗΣΗΣ', 'ΠΩΛΗΣΕΙΣ',
  'ΚΑΤΑΤΑΣΣΟΝΤΑΙ', 'ΚΑΤΑΤΑΣΣΕΤΑΙ', 'ΑΛΛΟΥ', 'ΣΥΝΑΦΕΙΣ', 'ΣΧΕΤΙΚΕΣ', 'ΣΧΕΤΙΚΩΝ',
]);

const stem = (w: string) => w.slice(0, 5);

/** Οι «σημαίνουσες» ρίζες μιας περιγραφής: κεφαλαία, χωρίς τόνους, χωρίς κοινές λέξεις. */
export function kadStems(text: string): Set<string> {
  const plain = String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const out = new Set<string>();
  for (const w of plain.split(/[^A-ZΑ-Ω]+/)) {
    if (w.length < 4 || STOP.has(w)) continue;
    out.add(stem(w));
  }
  return out;
}

const WHOLESALE = 'ΧΟΝΔΡ';
const RETAIL = 'ΛΙΑΝΙ';

/**
 * Πόσο από την περιγραφή της ΑΑΔΕ καλύπτει η γραμμή του SoftOne (0…1). Χονδρικό≠λιανικό ⇒ 0.
 * Το «χονδρικό»/«λιανικό» μόνο ΑΠΟΚΛΕΙΕΙ — δεν μετρά ως συμφωνία (αλλιώς «χονδρικό εμπόριο
 * ποδηλάτων» θα έμοιαζε κατά το μισό με «χονδρικό εμπόριο γαιανθράκων»).
 */
export function kadNameScore(aade: Set<string>, softone: Set<string>): number {
  const conflict = (aade.has(WHOLESALE) && softone.has(RETAIL)) || (aade.has(RETAIL) && softone.has(WHOLESALE));
  if (conflict) return 0;
  let size = 0;
  let hit = 0;
  for (const s of aade) {
    if (s === WHOLESALE || s === RETAIL) continue;
    size += 1;
    if (softone.has(s)) hit += 1;
  }
  return size === 0 ? 0 : hit / size;
}

/** Οι ρίζες που μετρούν στο σκορ (χωρίς χονδρικό/λιανικό). */
const scoredSize = (stems: Set<string>) => [...stems].filter((s) => s !== WHOLESALE && s !== RETAIL).length;

/** Ίδιος κωδικός: αρκεί να συμφωνεί η μισή περιγραφή. Κατά περιγραφή μόνο: πολύ πιο αυστηρά. */
const CODE_MIN = 0.5;
const NAME_MIN = 0.75;
const NAME_MIN_HITS = 2;

/** Ευρετήριο για γρήγορη αναζήτηση ανά ρίζα (10.000+ γραμμές). */
export interface KadIndex {
  rows: KadRow[];
  stems: Set<string>[];
  byCode: Map<string, number[]>;
  byStem: Map<string, number[]>;
}

export function buildKadIndex(rows: KadRow[]): KadIndex {
  const active = rows.filter((r) => r.isActive && r.id > 0 && r.code);
  const stems = active.map((r) => kadStems(r.name));
  const byCode = new Map<string, number[]>();
  const byStem = new Map<string, number[]>();
  active.forEach((r, i) => {
    const c = normalizeKadCode(r.code);
    if (c) byCode.set(c, [...(byCode.get(c) ?? []), i]);
    for (const s of stems[i]) {
      const list = byStem.get(s);
      if (list) list.push(i); else byStem.set(s, [i]);
    }
  });
  return { rows: active, stems, byCode, byStem };
}

const label = (a: AadeActivity) => `${formatAadeKad(a.code)} ${a.descr}`.trim();

/** «46720100» → «46.72.01.00» (όπως τυπώνεται στην ΑΑΔΕ). */
export function formatAadeKad(code: string): string {
  const d = String(code ?? '').replace(/\D/g, '');
  return d.match(/.{1,2}/g)?.join('.') ?? d;
}

/** Μία δραστηριότητα της ΑΑΔΕ → γραμμή KADTAXIS (βλ. σχόλιο αρχείου). */
export function resolveKad(a: AadeActivity, idx: KadIndex): KadMapping {
  const want = kadStems(a.descr);
  const code = normalizeKadCode(a.code);

  // 1) Ίδιος κωδικός με περιγραφή που συμφωνεί («61.9» και «61.90.00.00» είναι ο ίδιος: νικά το
  //    καλύτερο σκορ, μετά ο πιο ειδικός κωδικός).
  let same: { i: number; score: number } | null = null;
  for (const i of idx.byCode.get(code) ?? []) {
    const score = kadNameScore(want, idx.stems[i]);
    if (score < CODE_MIN) continue;
    if (!same || score > same.score || (score === same.score && idx.rows[i].code.length > idx.rows[same.i].code.length)) same = { i, score };
  }
  if (same) return { status: 'matched', row: idx.rows[same.i], aade: a, note: null };

  // 2) Κατά περιγραφή: υποψήφιες όσες μοιράζονται έστω μία ρίζα· νικά το μεγαλύτερο σκορ, μετά η
  //    πιο ΣΥΓΚΕΚΡΙΜΕΝΗ γραμμή (λιγότερες άσχετες λέξεις), μετά ο πιο κοντινός κωδικός.
  const cand = new Set<number>();
  for (const s of want) for (const i of idx.byStem.get(s) ?? []) cand.add(i);
  let best: { i: number; score: number; hits: number; extra: number; prefix: number } | null = null;
  for (const i of cand) {
    const score = kadNameScore(want, idx.stems[i]);
    const size = scoredSize(want);
    const hits = Math.round(score * size);
    if (score < NAME_MIN || hits < Math.min(NAME_MIN_HITS, size)) continue;
    const extra = scoredSize(idx.stems[i]) - hits;
    const c = normalizeKadCode(idx.rows[i].code);
    let prefix = 0;
    while (prefix < c.length && c[prefix] === code[prefix]) prefix += 1;
    const better = !best
      || score > best.score
      || (score === best.score && extra < best.extra)
      || (score === best.score && extra === best.extra && prefix > best.prefix);
    if (better) best = { i, score, hits, extra, prefix };
  }
  if (best) {
    const row = idx.rows[best.i];
    return {
      status: 'suggested', row, aade: a,
      note: `Ο ΚΑΔ ${formatAadeKad(a.code)} της ΑΑΔΕ δεν υπάρχει ίδιος στο μητρώο ΚΑΔ του SoftOne — προτείνεται ο ${row.code} κατά περιγραφή. Έλεγξέ τον.`,
    };
  }
  return { status: 'missing', row: null, aade: a, note: `Ο ΚΑΔ ${label(a)} δεν βρέθηκε στο μητρώο ΚΑΔ του SoftOne.` };
}

/** Κύρια + μία δευτερεύουσα (η πρώτη που αντιστοιχίζεται) — όσα χωρούν στην καρτέλα (KAD, KAD1). */
export function resolveTraderKads(acts: AadeActivity[], idx: KadIndex): { primary: KadMapping | null; secondary: KadMapping | null } {
  const primaryAct = acts.find((a) => a.kind === '1') ?? null;
  const primary = primaryAct ? resolveKad(primaryAct, idx) : null;
  let secondary: KadMapping | null = null;
  for (const a of acts) {
    if (a === primaryAct || a.kind === '1') continue;
    const m = resolveKad(a, idx);
    if (m.row && m.row.id !== primary?.row?.id) { secondary = m; break; }
    secondary ??= m;
  }
  return { primary, secondary };
}

export const KAD_UNAVAILABLE_NOTE = 'Το μητρώο ΚΑΔ του SoftOne δεν διαβάστηκε τώρα — ο ΚΑΔ θα μείνει κενός.';
