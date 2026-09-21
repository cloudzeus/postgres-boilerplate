// lib/ocr/chart-grounding.ts — ΚΑΘΑΡΟ (χωρίς prisma / δίκτυο).
// Το λογιστικό σχέδιο του πελάτη ως ΣΥΜΦΡΑΖΟΜΕΝΟ για το μοντέλο που διαλέγει χρεοπίστωση.
//
// ── ΤΙ ΚΑΝΕΙ ─────────────────────────────────────────────────────────────────────────────────
// Μια χρεοπίστωση λέγεται «ΧΡ01 Ενοίκια» — λίγα λόγια. Ο λογαριασμός της στο ΕΓΛΣ του πελάτη
// λέει τι ΕΙΝΑΙ, με τα λόγια του λογιστή: «62.04.00.0024 Ενοίκια κτιρίων με ΦΠΑ 24%», κλάδος
// «62.04 Ενοίκια». Αυτό βλέπει το μοντέλο δίπλα στη χρεοπίστωση, και με τους ΚΛΑΔΟΥΣ στενεύει
// τη λίστα υποψηφίων αντί για ομοιότητα κειμένου.
//
// ── ΤΙ ΔΕΝ ΚΑΝΕΙ, ΣΚΟΠΙΜΑ ────────────────────────────────────────────────────────────────────
// ΜΟΝΟ για χρεοπίστωση που ο λογαριασμός της (`acnmsk`) ΥΠΑΡΧΕΙ στο σχέδιο και ΚΙΝΕΙΤΑΙ
// (`ACNMOVING`). Στον ζωντανό tenant αυτές είναι 136 από 443. Οι άλλες 307 (κενός λογαριασμός,
// μάσκα, κωδικός που δεν υπάρχει, συγκεντρωτικός) φορτώθηκαν με κωδικούς ΕΛΠ Ν.4308, και ο ΙΔΙΟΣ
// αριθμός σημαίνει άλλο πράγμα στα δύο σχέδια: «61.02» είναι «Λοιπές προμήθειες τρίτων» στο ΕΓΛΣ
// του πελάτη και «Απομείωση βιολογικών περιουσιακών στοιχείων» στον κωδικό ΕΛΠ της χρεοπίστωσης.
// Αν δανειζόμασταν τον κλάδο ΕΓΛΣ από τα ψηφία ΕΛΠ, θα δίναμε στο μοντέλο ΛΑΘΟΣ περιγραφή με
// πλήρες κύρος — χειρότερο από καμία. Αυτές πάνε στο μοντέλο ΜΟΝΟ με το δικό τους όνομα, και
// φτάνουν στη λίστα μόνο από τον παλιό δρόμο της ομοιότητας κειμένου.
//
// Το μοντέλο επιστρέφει ΠΑΝΤΑ κωδικό χρεοπίστωσης από τη λευκή λίστα, ΠΟΤΕ λογαριασμό. Ο κλάδος
// είναι ετικέτα κατηγορίας (λογαριασμός 2ης βαθμίδας, συγκεντρωτικός) — δεν προτείνεται ποτέ ως
// προορισμός εγγραφής· ο μόνος λογαριασμός που τυπώνεται ως «λογαριασμός» είναι κινούμενος.

import { isPattern, type ChartAccount } from './account-check';

/**
 * Η βαθμίδα του ΚΛΑΔΟΥ. Επιλεγμένη από τα δεδομένα του ζωντανού tenant (136 χρεοπιστώσεις με
 * έγκυρο λογαριασμό):
 *  • 1η βαθμίδα (`62`): 11 κλάδοι, ο μεγαλύτερος 38 — «60 Αμοιβές προσωπικού» και «64 Διάφορα
 *    έξοδα» είναι σακιά, δεν στενεύουν τίποτα.
 *  • **2η βαθμίδα (`62.04`): 44 κλάδοι, μέγιστο 18, διάμεσος 3** — όλοι υπάρχουν στο σχέδιο με
 *    όνομα, και μαζεύουν τις παραλλαγές ΦΠΑ της 4ης βαθμίδας (…0009, …0013, …0024) κάτω από
 *    ένα όνομα που λέει τι είναι («Ενοίκια», «Τηλεπικοινωνίες»).
 *  • 3η βαθμίδα (`62.04.00`): 102 κλάδοι, 85 με ΜΙΑ χρεοπίστωση — ο κατάλογος γίνεται η λίστα
 *    χρεοπιστώσεων με άλλο όνομα.
 */
export const BRANCH_LEVEL = 2;

/** «62.04.00.0024» → «62.04» (για `level` 2). Κωδικός με λιγότερα τμήματα → `null`. */
export function branchCodeOf(code: string, level: number = BRANCH_LEVEL): string | null {
  const parts = String(code ?? '').trim().split('.').filter(Boolean);
  if (parts.length < level) return null;
  return parts.slice(0, level).join('.');
}

/** Μια χρεοπίστωση όπως τη χρειάζεται ο εμπλουτισμός. */
export type ArticleRow = {
  mtrl: number;
  code: string;
  name: string;
  /** `MTRL.ACNMSK` — πλήρης κωδικός, μάσκα με `*`, ή κενό. */
  acnmsk: string | null;
  /** `false` = ο συγχρονισμός δεν έχει διαβάσει ακόμη το `acnmsk` (άγνωστο, όχι κενό). */
  acnmskKnown: boolean;
  /** Η κατηγορία δαπάνης (όνομα), όπως τη δείχνει ήδη η λίστα υποψηφίων. */
  category?: string | null;
};

/** Γιατί ΔΕΝ εμπλουτίζεται μια χρεοπίστωση — για tests και διάγνωση, ποτέ για το prompt. */
export type UnsoundReason =
  | 'unsynced' | 'blank' | 'mask' | 'not_in_chart' | 'not_postable' | 'postability_unknown' | 'inactive';

export type ArticleLink =
  | { sound: true; account: { code: string; name: string }; branch: { code: string; name: string } | null }
  | { sound: false; reason: UnsoundReason };

/**
 * Είναι ο σύνδεσμος χρεοπίστωσης → λογαριασμού ΑΞΙΟΠΙΣΤΟΣ; Ναι μόνο όταν ο λογαριασμός υπάρχει
 * στο σχέδιο, κινείται (`postable === true` — το άγνωστο ΔΕΝ είναι κινούμενο) και είναι ενεργός.
 * Ο κλάδος παίρνει όνομα ΜΟΝΟ από τον λογαριασμό κλάδου που υπάρχει στο σχέδιο — ποτέ από τα
 * ψηφία της ίδιας της χρεοπίστωσης.
 */
export function articleLink(a: ArticleRow, chart: ReadonlyMap<string, ChartAccount>): ArticleLink {
  if (!a.acnmskKnown) return { sound: false, reason: 'unsynced' };
  const mask = (a.acnmsk ?? '').trim();
  if (!mask) return { sound: false, reason: 'blank' };
  if (isPattern(mask)) return { sound: false, reason: 'mask' };
  const acc = chart.get(mask);
  if (!acc) return { sound: false, reason: 'not_in_chart' };
  if (acc.postable === false) return { sound: false, reason: 'not_postable' };
  if (acc.postable !== true) return { sound: false, reason: 'postability_unknown' };
  if (acc.isActive === false) return { sound: false, reason: 'inactive' };
  const bc = branchCodeOf(acc.code);
  const b = bc ? chart.get(bc) : undefined;
  return {
    sound: true,
    account: { code: acc.code, name: acc.name },
    branch: b ? { code: b.code, name: b.name } : null,
  };
}

/** Χρεοπίστωση + ό,τι ξέρουμε με ασφάλεια για τον λογαριασμό της. */
export type GroundedArticle = ArticleRow & { link: ArticleLink };

export function groundArticles(rows: readonly ArticleRow[], chart: ReadonlyMap<string, ChartAccount>): GroundedArticle[] {
  return rows.map((r) => ({ ...r, link: articleLink(r, chart) }));
}

/** Για σύγκριση ονομάτων: κεφαλαία, χωρίς τόνους, «Φ.Π.Α.» = «ΦΠΑ», χωρίς στίξη, ένα κενό. */
const sameText = (a: string, b: string): boolean => {
  const n = (s: string) => String(s ?? '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\./g, '').replace(/[^\p{L}\p{N}%]+/gu, ' ').trim();
  return n(a) === n(b);
};

/**
 * Η γραμμή υποψηφίου στο prompt. Χωρίς αξιόπιστο σύνδεσμο: ΑΚΡΙΒΩΣ όπως πριν — κωδικός, όνομα,
 * κατηγορία. Κανένα ψηφίο του κωδικού της δεν μεταφράζεται σε κλάδο.
 *
 * Με αξιόπιστο σύνδεσμο προστίθενται λογαριασμός και κλάδος. Στον tenant οι περισσότερες
 * χρεοπιστώσεις έχουν κωδικό ΙΔΙΟ με τον λογαριασμό τους (και συχνά ίδιο όνομα): τότε η γραμμή
 * το λέει με δύο λέξεις αντί να επαναλαμβάνει — λιγότερα tokens, καμία χαμένη πληροφορία.
 */
export function candidateLine(a: GroundedArticle): string {
  const base = `${a.code} — ${a.name}${a.category ? ` [${a.category}]` : ''}`;
  if (!a.link.sound) return base;
  const { account, branch } = a.link;
  const sameCode = account.code.trim() === a.code.trim();
  const sameName = sameText(account.name, a.name);
  const acc = sameCode && sameName
    ? 'λογαριασμός (ίδιος κωδικός και όνομα)'
    : `λογαριασμός ${sameCode ? '(ίδιος κωδικός)' : account.code}${sameName ? '' : ` «${account.name}»`}`;
  return `${base} → ${acc}${branch ? ` · κλάδος ${branch.code} «${branch.name}»` : ''}`;
}

/** Η υπογραφή ενός υποψηφίου για την κρυφή μνήμη — καλύπτει ΚΑΙ τον εμπλουτισμό. */
export function candidateSignaturePart(a: GroundedArticle): string {
  const l = a.link;
  return `${a.mtrl}:${a.code}:${a.name}:${l.sound ? `${l.account.code}:${l.account.name}:${l.branch?.code ?? ''}:${l.branch?.name ?? ''}` : '-'}`;
}

export type Branch = { code: string; name: string; articles: number };

/**
 * Ο κατάλογος κλάδων: ΜΟΝΟ κλάδοι που περιέχουν τουλάχιστον μία χρεοπίστωση με αξιόπιστο
 * σύνδεσμο, με το όνομά τους από το σχέδιο. Ένας κλάδος χωρίς τέτοια χρεοπίστωση δεν οδηγεί
 * πουθενά — θα ήταν επιλογή χωρίς αποτέλεσμα.
 */
export function branchCatalogue(articles: readonly GroundedArticle[]): Branch[] {
  const by = new Map<string, Branch>();
  for (const a of articles) {
    if (!a.link.sound || !a.link.branch) continue;
    const b = a.link.branch;
    const cur = by.get(b.code) ?? { code: b.code, name: b.name, articles: 0 };
    cur.articles++;
    by.set(b.code, cur);
  }
  return [...by.values()].sort((x, y) => x.code.localeCompare(y.code, 'el', { numeric: true }));
}

/** Οι χρεοπιστώσεις που ανήκουν στους δοσμένους κλάδους (μόνο αξιόπιστοι σύνδεσμοι). */
export function articlesInBranches(articles: readonly GroundedArticle[], branches: ReadonlySet<string>): GroundedArticle[] {
  return articles.filter((a) => a.link.sound && a.link.branch != null && branches.has(a.link.branch.code));
}

/**
 * Η τελική λευκή λίστα: οι πηγές στη σειρά που δίνονται, χωρίς διπλότυπα (κατά MTRL), φραγμένη
 * στο `cap`. Η πρώτη πηγή κρατά την προτεραιότητα όταν το πλαφόν κόβει.
 */
export function mergeWhitelist(sources: readonly (readonly GroundedArticle[])[], cap: number): GroundedArticle[] {
  const seen = new Set<number>();
  const out: GroundedArticle[] = [];
  for (const src of sources) {
    for (const a of src) {
      if (out.length >= cap) return out;
      if (seen.has(a.mtrl)) continue;
      seen.add(a.mtrl);
      out.push(a);
    }
  }
  return out;
}

/** Ένας κανόνας μνήμης όπως τον χρειάζεται το ιστορικό εκδότη. */
export type HistoryRule = {
  afm: string;
  lin: number | null;
  /** Ποιος τον έγραψε — κανόνας χωρίς άνθρωπο δεν μετράει. */
  createdById: string | null;
  /**
   * ΠΟΙΟΣ διάλεξε τον ΣΤΟΧΟ (`LineMatchRule.targetSource`). ΜΟΝΟ το `'manual'` μετράει· οι
   * παλιοί κανόνες χωρίς προέλευση (`null`) και κάθε άλλη τιμή ΔΕΝ είναι ανθρώπινη επιβεβαίωση.
   */
  targetSource: string | null;
};

/**
 * Το ιστορικό ενός εκδότη ως ΕΝΔΕΙΞΗ: σε ποιους κλάδους πήγαν γραμμές του που επιβεβαίωσε
 * ΑΝΘΡΩΠΟΣ. Πηγή είναι ΜΟΝΟ κανόνες `LineMatchRule` με `targetSource = 'manual'` — ο στόχος
 * διαλέχτηκε ρητά από χρήστη. Ποτέ αυτόματη αντιστοίχιση, ποτέ απάντηση μοντέλου, ποτέ κανόνας
 * άγνωστης προέλευσης. Κανόνες χωρίς χρεοπίστωση (είδη / έξοδα) δεν
 * έχουν λογαριασμό σε αυτόν τον tenant και δεν μετρούν· χρεοπίστωση χωρίς αξιόπιστο σύνδεσμο
 * μετρά με τον ΚΩΔΙΚΟ της, ποτέ με κλάδο δανεισμένο από τα ψηφία της.
 *
 * Χωρίς επιβεβαιωμένο ιστορικό → `null`: το prompt δεν λέει ΤΙΠΟΤΑ, αντί να εφεύρει προτίμηση.
 */
export function issuerHistory(
  afm: string,
  rules: readonly HistoryRule[],
  articles: ReadonlyMap<number, GroundedArticle>,
): { branches: string[]; line: string } | null {
  const key = String(afm ?? '').trim();
  if (!key) return null;
  const counts = new Map<string, { label: string; n: number; branch: string | null }>();
  for (const r of rules) {
    if (r.afm !== key || r.lin == null || !r.createdById || r.targetSource !== 'manual') continue;
    const a = articles.get(r.lin);
    if (!a) continue;
    const k = a.link.sound && a.link.branch ? `b:${a.link.branch.code}` : `a:${a.mtrl}`;
    const label = a.link.sound && a.link.branch
      ? `${a.link.branch.code} «${a.link.branch.name}»`
      : `χρεοπίστωση ${a.code}`;
    const cur = counts.get(k) ?? { label, n: 0, branch: a.link.sound && a.link.branch ? a.link.branch.code : null };
    cur.n++;
    counts.set(k, cur);
  }
  if (counts.size === 0) return null;
  const list = [...counts.values()].sort((x, y) => y.n - x.n || x.label.localeCompare(y.label, 'el'));
  return {
    branches: list.map((c) => c.branch).filter((b): b is string => b != null),
    line: `επιβεβαιωμένες από άνθρωπο γραμμές του εκδότη: ${list.map((c) => `${c.label} ×${c.n}`).join(', ')}`
      + ' — ΕΝΔΕΙΞΗ, όχι απόφαση· κρίνε από το κείμενο της γραμμής',
  };
}

/**
 * Διαβάζει την απάντηση του 1ου σταδίου (επιλογή κλάδων). Δεκτοί ΜΟΝΟ κλάδοι του καταλόγου που
 * στείλαμε — ό,τι άλλο πετιέται, όπως και στη λευκή λίστα χρεοπιστώσεων.
 */
export function parseBranchAnswer(raw: string, allowed: ReadonlySet<string>, maxPerGroup = 3): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const text = String(raw ?? '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  let parsed: unknown = null;
  try { parsed = JSON.parse(text); } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return out;
    try { parsed = JSON.parse(m[0]); } catch { return out; }
  }
  const list = (parsed as { branches?: unknown } | null)?.branches;
  if (!Array.isArray(list)) return out;
  for (const row of list as Record<string, unknown>[]) {
    if (!row || typeof row !== 'object') continue;
    const key = String(row.key ?? '').trim();
    const codes = Array.isArray(row.codes) ? row.codes.map((c) => String(c ?? '').trim()) : [];
    const ok = [...new Set(codes.filter((c) => allowed.has(c)))].slice(0, maxPerGroup);
    if (key && ok.length) out.set(key, ok);
  }
  return out;
}
