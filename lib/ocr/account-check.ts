// lib/ocr/account-check.ts — ΚΑΘΑΡΟ (χωρίς prisma / δίκτυο).
// Ο έλεγχος λογαριασμού γενικής λογιστικής πριν την καταχώριση: για κάθε γραμμή, ΣΕ ΠΟΙΟΝ
// λογαριασμό θα τη γράψει το SoftOne, πώς λέγεται αυτός στο λογιστικό σχέδιο, και αν υπάρχει.
//
// ── ΠΩΣ ΦΤΑΝΕΙ ΜΙΑ ΓΡΑΜΜΗ ΣΤΗ ΓΕΝΙΚΗ ΛΟΓΙΣΤΙΚΗ (επαληθευμένο read-only στον `dgsoftdev`) ────────
//
// Τη λογιστική εγγραφή τη φτιάχνει η «γέφυρα λογιστικής» της σειράς (πίνακας GLTEMPLATES, πεδίο
// SODATA). Τα υποδείγματα των ειδικών συναλλαγών (1253 «Ειδικές Προμηθευτών - Πιστώσεις», 1653
// «Ειδικών Πιστωτών», κ.ά.) χρεώνουν τη γραμμή σε `[LMTL8]` — τον λογαριασμό ΤΗΣ ΓΡΑΜΜΗΣ LINLINES,
// αυτούσιο, χωρίς καμία σύνθεση. Εμείς δεν στέλνουμε λογαριασμό στη γραμμή, οπότε αυτός έρχεται
// από την καρτέλα της χρεοπίστωσης: `MTRL.ACNMSK` («Γενικής»). Ο πίνακας ανά εταιρεία (MTRLCMP)
// και η λογιστική κατηγορία (MTRACN) είναι κενά για ΟΛΕΣ τις χρεοπιστώσεις, άρα δεν τον αλλάζουν.
// ΑΥΤΗ είναι η μόνη διαδρομή όπου ο έλεγχος ΕΜΠΟΔΙΖΕΙ.
//
// Είδη / υπηρεσίες (ITELINES / SRVLINES) και έξοδα (EXPANAL) ΔΕΝ ελέγχονται ακόμη:
//  • Τα είδη ΣΥΝΘΕΤΟΥΝ λογαριασμό: `[MTL1MAT2,1,2].[FTR1FPUR1,1,2].[MTL1MAT2,4,5].[MTL3VTI3]` —
//    κομμάτια της λογιστικής κατηγορίας του είδους (π.χ. «20.00»), του τύπου παραστατικού και της
//    κατάληξης ΦΠΑ. Δεν υπάρχει ένα πεδίο να κοιτάξουμε.
//  • Τα έξοδα διαβάζουν `[EXP1EXN5]` / `[EXP1EXN6]` — πεδία της καρτέλας EXPN που δεν έχουμε
//    αντιστοιχίσει με βεβαιότητα (το ACNMSKX «Εξόδων» είναι βιβλίο Εσόδων-Εξόδων, όχι γενική).
// Εκεί ο έλεγχος λέει ρητά «δεν καλύπτεται», αντί να σιωπά σαν να πέρασε.
//
// ── Η ΛΕΞΗ «ΜΑΣΚΑ» ─────────────────────────────────────────────────────────────────────────────
// Το SoftOne λέει το πεδίο ACNMSK — mask. Από τις 362 γεμάτες χρεοπιστώσεις του πελάτη, οι 355 είναι
// πλήρεις κωδικοί και οι 7 ΜΟΤΙΒΑ: «32.*» (×5), «32*» (×1), «65.90*» (×1). Σύνταξη: το `*` ταιριάζει
// με οποιαδήποτε ακολουθία χαρακτήρων (και τελείες), όλα τα άλλα κατά γράμμα.
// Μια μάσκα ΕΜΠΟΔΙΖΕΙ (`account_is_mask`): η γέφυρα χρεώνει `[LMTL8]` αυτούσιο και εμείς δεν στέλνουμε
// λογαριασμό στη γραμμή, άρα η γραμμή θα κουβαλούσε το κείμενο «32.*» στην ενημέρωση λογιστικής — που
// δεν είναι λογαριασμός. Στο SoftOne μάσκα στο άρθρο σημαίνει «διάλεξε συγκεκριμένο λογαριασμό μέσα στο
// μοτίβο σε κάθε γραμμή»· η εφαρμογή δεν κάνει ακόμη αυτή την επιλογή, οπότε αρνείται και δείχνει τους
// υποψήφιους λογαριασμούς (προτάσεις, όχι επιλογή).
//
// ── ΚΙΝΟΥΜΕΝΟΣ Ή ΣΥΓΚΕΝΤΡΩΤΙΚΟΣ ─────────────────────────────────────────────────────────────
// Εγγραφή δέχεται μόνο λογαριασμός με `ACNMOVING=1` («Κινείται»). Στον πελάτη το λογιστικό σχέδιο
// είναι ο πίνακας `ACNT` και η σημαία είναι `ACNMOVING` — ΔΕΝ υπάρχουν `GLMASTER`, `ISFINAL`, `ACCNUM`,
// `GLTRNLINES`. Δεν την αντικαθιστά ούτε η βαθμίδα ούτε το «δεν έχει παιδιά»: ζωντανά, 913 λογαριασμοί
// χωρίς παιδιά ΔΕΝ κινούνται και 166 λογαριασμοί 2ης/3ης βαθμίδας κινούνται. Συγκεντρωτικός ⇒
// εμπόδιο `account_not_postable`· άγνωστη σημαία (NULL) ⇒ «άγνωστο», ΠΟΤΕ «κινείται». Και οι δύο
// λίστες προτάσεων (αδέλφια, υποψήφιοι μάσκας) περιέχουν ΜΟΝΟ κινούμενους λογαριασμούς.
//
// ── ΣΥΝΤΕΛΕΣΤΗΣ ΦΠΑ: ΠΑΡΑΤΗΡΗΣΗ, ΠΟΤΕ ΕΜΠΟΔΙΟ ───────────────────────────────────────────────────
// Στο ΕΓΛΣ του πελάτη η 4η βαθμίδα των λογαριασμών εξόδων κωδικοποιεί ΣΥΧΝΑ τον ΦΠΑ: `62.00.00.0024`
// «… με Φ.Π.Α. 24%», `…0013` «… 13%». ΣΥΧΝΑ, όχι πάντα — επαληθευμένο στα 3.024 φύλλα του σχεδίου:
//  • `0219` «ΦΙΧ 19%», `0224` «ΦΙΧ 24%», `0199` «ΕΙΧ ΧΔΕ», `8700`, `7700`, `0100` — κατάληξη που ΔΕΝ
//    είναι σκέτος συντελεστής. Εκεί δεν λέμε τίποτα.
//  • Ακόμη και η «καθαρή» μορφή `00NN` ΔΕΝ είναι μονοσήμαντη: `54.00.99.0001…0012` είναι ΜΗΝΕΣ
//    («Απόδοση εκκαθάριση Φ.Π.Α. Ιουνίου» = `0006`), `0053` σημαίνει 6%, `0065` 6,5%, `0087`/`0096`/
//    `0099` δεν είναι συντελεστές, και μόνο 103 από τους 391 `0000` λένε «άνευ Φ.Π.Α.».
// Γι' αυτό ο κανόνας θέλει ΔΥΟ συμφωνούσες ενδείξεις από το ΙΔΙΟ το σχέδιο: κατάληξη `00NN` ΚΑΙ
// όνομα λογαριασμού που λέει ρητά ΦΠΑ με τον ίδιο συντελεστή («… Φ.Π.Α. NN%», ή «άνευ Φ.Π.Α.» για το
// `0000`). Ένα σκέτο «NN%» δεν αρκεί: «Ποσοστά … 9%», «Φόρος προμηθευτών 5%» δεν είναι ΦΠΑ. Μόνο τότε,
// και μόνο όταν ο ΦΠΑ της γραμμής είναι γνωστός και διαφέρει, βγαίνει παρατήρηση
// `account_vat_mismatch`. Είναι ΣΥΜΠΕΡΑΣΜΑ από το σχήμα του σχεδίου, όχι κανόνας του SoftOne — γι'
// αυτό προειδοποιεί και δεν αποφασίζει.
//
// ── ΤΙ ΔΕΝ ΚΑΝΕΙ, ΣΚΟΠΙΜΑ ──────────────────────────────────────────────────────────────────────
// Δεν συγκρίνει την περιγραφή της χρεοπίστωσης με την περιγραφή του λογαριασμού. Ο πελάτης έχει δύο
// λογιστικά σχέδια (ΕΓΛΣ στο ACNT, ΕΛΠ στις χρεοπιστώσεις): «61.02» είναι «Λοιπές προμήθειες τρίτων»
// στο ένα και «Απομείωση βιολογικών» στο άλλο. Κανένας αλγόριθμος ομοιότητας δεν ξεχωρίζει τα 5
// πραγματικά λάθη από τις 11 αθώες αναδιατυπώσεις — ένα λογιστής ναι. Γι' αυτό ο έλεγχος ΔΕΙΧΝΕΙ
// πάντα το όνομα του λογαριασμού δίπλα στη χρεοπίστωση και αφήνει την κρίση στον άνθρωπο.

/** Ένας λογαριασμός του λογιστικού σχεδίου (ACNT). */
export type ChartAccount = {
  code: string;
  name: string;
  isActive?: boolean;
  /** ACNMOVING: `true` δέχεται εγγραφές · `false` συγκεντρωτικός · `null`/απών = άγνωστο. */
  postable?: boolean | null;
};

/** Μόνο ό,τι το SoftOne λέει ρητά ότι κινείται. Το άγνωστο ΔΕΝ είναι κινούμενο. */
export const isPostable = (a: ChartAccount): boolean => a.postable === true;

/**
 * Ο καθρέφτης του λογιστικού σχεδίου όπως τον βλέπει ο έλεγχος.
 * `synced: false` = άδειος ή ποτέ συγχρονισμένος — ΤΟΤΕ Ο ΕΛΕΓΧΟΣ ΔΕΝ ΚΡΙΝΕΙ ΤΙΠΟΤΑ.
 * `accounts` μπορεί να είναι υποσύνολο του σχεδίου, αρκεί να περιέχει όσους αφορούν τις γραμμές
 * (τους ίδιους, τους γονείς τους, τα αδέλφια τους και ό,τι ταιριάζει στα μοτίβα) — βλ. `chartNeeds`.
 */
export type AccountChart = { synced: boolean; accounts: readonly ChartAccount[] };

/** Ο πίνακας γραμμών όπου πάει μια γραμμή — από τον στόχο της σειράς. */
export type AccountPath = 'LINLINES' | 'ITELINES' | 'SRVLINES' | 'EXPANAL' | 'SXDOCLINES';

export type AccountCheckInput = {
  rowIndex: number;
  /** `null` = η γραμμή δεν θα σταλεί (άλλο εμπόδιο το λέει ήδη) — δεν ελέγχεται. */
  path: AccountPath | null;
  /** Η χρεοπίστωση, «κωδικός — περιγραφή», για τα μηνύματα. */
  article?: string | null;
  /** `MTRL.ACNMSK` της χρεοπίστωσης (μόνο για LINLINES). */
  acnmsk?: string | null;
  /**
   * `false` = ο συγχρονισμός δεν έχει διαβάσει ΑΚΟΜΗ τον λογαριασμό της χρεοπίστωσης. Τότε ένα
   * κενό `acnmsk` σημαίνει «δεν ξέρω», όχι «λείπει».
   */
  acnmskKnown?: boolean;
  /** Ο συντελεστής ΦΠΑ της γραμμής (π.χ. 24). `null`/απών = άγνωστος ⇒ κανένας έλεγχος ΦΠΑ. */
  vatRate?: number | null;
};

export type AccountStatus =
  /** Ο λογαριασμός υπάρχει στο σχέδιο — φαίνεται με το όνομά του. */
  | 'ok'
  /** Μάσκα (με `*`) αντί για λογαριασμό — ΕΜΠΟΔΙΟ, με τους υποψήφιους λογαριασμούς. */
  | 'mask'
  /** Κενός λογαριασμός — ΕΜΠΟΔΙΟ. */
  | 'missing'
  /** Λογαριασμός (ή μοτίβο) που δεν υπάρχει στο σχέδιο — ΕΜΠΟΔΙΟ. */
  | 'not_in_chart'
  /** Ο λογαριασμός υπάρχει αλλά είναι συγκεντρωτικός (ACNMOVING=0) — ΕΜΠΟΔΙΟ. */
  | 'not_postable'
  /** Δεν ξέρουμε: ασυγχρόνιστο σχέδιο ή ασυγχρόνιστη χρεοπίστωση. Ούτε περνά ούτε εμποδίζει. */
  | 'unknown'
  /** Διαδρομή (είδη / υπηρεσίες / έξοδα) που ο έλεγχος δεν καλύπτει ακόμη. */
  | 'not_covered';

export type AccountCheckLine = {
  rowIndex: number;
  path: AccountPath;
  status: AccountStatus;
  /** Ό,τι θα χρησιμοποιήσει το ERP — ο κωδικός ή το μοτίβο, όπως είναι στην καρτέλα. */
  account: string | null;
  /** Η περιγραφή του λογαριασμού στο σχέδιο (μόνο `ok`). */
  accountName: string | null;
  /** `true` όταν ο λογαριασμός υπάρχει αλλά είναι ανενεργός στο SoftOne. */
  inactive: boolean;
  /** `unknown`: γιατί δεν ξέρουμε. */
  unknownReason: 'chart_not_synced' | 'line_item_not_synced' | 'postability_unknown' | null;
  /** `not_in_chart`: ο γονικός λογαριασμός, αν υπάρχει στο σχέδιο. */
  parent: ChartAccount | null;
  /** `not_in_chart` με γονικό: οι λογαριασμοί κάτω από αυτόν — ΠΡΟΤΑΣΕΙΣ, όχι επιλογή. */
  siblings: ChartAccount[];
  /**
   * `mask`: οι ΚΙΝΟΥΜΕΝΟΙ λογαριασμοί που καλύπτει (το πολύ `MAX_LISTED`) και πόσοι είναι συνολικά.
   * Οι συγκεντρωτικοί δεν είναι υποψήφιοι — δεν δέχονται εγγραφές.
   */
  matches: ChartAccount[];
  matchCount: number;
  article: string | null;
  /** Μία ελληνική πρόταση για τη γραμμή. */
  message: string;
  /**
   * `ok` λογαριασμός για ΑΛΛΟΝ συντελεστή ΦΠΑ από αυτόν της γραμμής (βλ. {@link accountVatRate}).
   * ΠΑΡΑΤΗΡΗΣΗ, ποτέ εμπόδιο.
   */
  vatMismatch: { accountRate: number; lineRate: number; message: string } | null;
};

export type AccountCheck = {
  /** Όπως το `AccountChart.synced`: χωρίς σχέδιο, ΚΑΜΙΑ γραμμή LINLINES δεν κρίνεται. */
  chartSynced: boolean;
  lines: AccountCheckLine[];
};

/** Πόσους λογαριασμούς απαριθμούμε σε ένα μήνυμα πριν γράψουμε «και άλλοι Ν». */
export const MAX_LISTED = 12;

export const isPattern = (mask: string): boolean => mask.includes('*');

/** Κείμενο → regex: το `*` ταιριάζει οτιδήποτε, όλα τα άλλα κατά γράμμα. */
export function patternRegex(mask: string): RegExp {
  const body = mask.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${body}$`);
}

/** Το κομμάτι πριν από το πρώτο `*` — με αυτό ο server στενεύει το ερώτημα στη βάση. */
export const patternPrefix = (mask: string): string => mask.split('*')[0];

/** «61.02.00.0024» → «61.02.00». Πρωτοβάθμιος → null. */
export const parentOf = (code: string): string | null => {
  const i = code.lastIndexOf('.');
  return i > 0 ? code.slice(0, i) : null;
};

/**
 * Ποιους λογαριασμούς χρειάζεται ο έλεγχος για αυτές τις μάσκες: τους ίδιους κωδικούς, τους
 * γονείς τους (και τα παιδιά των γονέων = αδέλφια), και τα προθέματα των μοτίβων. Ο server φορτώνει
 * μόνο αυτά αντί για 5.000+ γραμμές σε κάθε προεπισκόπηση.
 */
export function chartNeeds(masks: readonly (string | null | undefined)[]): {
  codes: string[]; parents: string[]; prefixes: string[];
} {
  const codes = new Set<string>();
  const parents = new Set<string>();
  const prefixes = new Set<string>();
  for (const raw of masks) {
    const m = (raw ?? '').trim();
    if (!m) continue;
    if (isPattern(m)) { prefixes.add(patternPrefix(m)); continue; }
    codes.add(m);
    const p = parentOf(m);
    if (p) { parents.add(p); codes.add(p); }
  }
  return { codes: [...codes], parents: [...parents], prefixes: [...prefixes] };
}

const label = (a: ChartAccount): string => `${a.code} «${a.name}»`;

/**
 * Κεφαλαία, χωρίς τόνους, λατινικό «A» → ελληνικό «Α» (homoglyph σε πληκτρολογημένα ονόματα),
 * και κάθε γραφή του ΦΠΑ («Φ.Π.Α.», «Φ.Π.Α», «Φ Π Α», «φπα») → «ΦΠΑ».
 */
const vatText = (s: string): string => String(s ?? '').toUpperCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/A/g, 'Α')
  // ΧΩΡΙΣ `\b`: στη JS το `\b` ξέρει μόνο λατινικούς χαρακτήρες και δεν πιάνει ποτέ πριν/μετά από «Α».
  .replace(/Φ\s*\.?\s*Π\s*\.?\s*Α(\s*\.)?/g, 'ΦΠΑ');

/**
 * Ο συντελεστής ΦΠΑ που κωδικοποιεί ένας λογαριασμός — ΜΟΝΟ όταν το λένε ΚΑΙ η κατάληξη ΚΑΙ το
 * όνομα (δες την κεφαλίδα: ούτε η καθαρή μορφή `00NN` είναι μονοσήμαντη σε αυτό το σχέδιο).
 *
 * ΘΕΤΙΚΗ απαίτηση, όχι λίστα εξαιρέσεων: το όνομα πρέπει να λέει «ΦΠΑ» ΚΑΙ τον συντελεστή. Ένα
 * σκέτο «NN%» ΔΕΝ είναι ΦΠΑ — στον ζωντανό tenant `60.01.09.00NN` «Ποσοστά για πωλήσεις και αγορές
 * NN%» (και τα 9 είναι χρεοπιστώσεις με αξιόπιστο λογαριασμό), `54.09.14.00NN` «Φόρος προμηθευτών
 * NN%», `61.91`/`61.98` «… φόρος NN%» (παρακρατήσεις). Μια λίστα «ΦΟΡΟΣ / ΠΟΣΟΣΤΑ» θα έχανε την
 * επόμενη οικογένεια· το «πρέπει να λέει ΦΠΑ» όχι. Μέτρηση στο ζωντανό σχέδιο: 1.584 → 1.475
 * λογαριασμοί· καμία από τις τρεις οικογένειες δεν μένει.
 *
 *  • `…0024` «… με Φ.Π.Α. 24%» → 24 · `…0000` «… άνευ Φ.Π.Α.» → 0
 *  • `…0219` «ΦΙΧ 19%», `…0199` «ΕΙΧ ΧΔΕ», `…8700` → `null` (όχι σκέτος συντελεστής)
 *  • `54.00.99.0006` «Απόδοση εκκαθάριση Φ.Π.Α. Ιουνίου» → `null` (μήνας — το όνομα δεν λέει 6%)
 *  • `…0053` «… 6%» → `null` (το όνομα λέει 6, η κατάληξη 53: διαφωνούν)
 */
export function accountVatRate(a: Pick<ChartAccount, 'code' | 'name'>): number | null {
  const parts = String(a.code ?? '').trim().split('.');
  if (parts.length !== 4) return null;
  const m = /^00(\d\d)$/.exec(parts[3]);
  if (!m) return null;
  const nn = Number(m[1]);
  const name = vatText(a.name);
  if (nn === 0) return /(ΑΝΕΥ|ΧΩΡΙΣ)\s+ΦΠΑ/.test(name) ? 0 : null;
  if (!name.includes('ΦΠΑ')) return null;
  // «24%» ως ΑΚΕΡΑΙΟΣ αριθμός: όχι «6,5%», όχι «124%».
  return new RegExp(`(^|[^0-9.,])${nn}\\s*%`).test(name) ? nn : null;
}

const fmtRate = (r: number): string => (r === 0 ? 'άνευ ΦΠΑ' : `ΦΠΑ ${String(r).replace('.', ',')}%`);

/** Παρατήρηση ΦΠΑ για λογαριασμό `ok` — `null` όταν δεν ξέρουμε ή όταν συμφωνούν. */
export function vatMismatchOf(
  account: Pick<ChartAccount, 'code' | 'name'>, lineRate: number | null | undefined, who: string,
): AccountCheckLine['vatMismatch'] {
  if (lineRate == null || !Number.isFinite(lineRate)) return null;
  const accountRate = accountVatRate(account);
  if (accountRate == null || Math.abs(accountRate - lineRate) < 0.001) return null;
  return {
    accountRate, lineRate,
    message: `${who}: ο λογαριασμός ${account.code} είναι για ${fmtRate(accountRate)} αλλά η γραμμή έχει `
      + `${lineRate === 0 ? 'ΦΠΑ 0%' : fmtRate(lineRate)} — έλεγξε τη χρεοπίστωση (παρατήρηση, δεν εμποδίζει)`,
  };
}

function listed(accounts: ChartAccount[], total = accounts.length): string {
  const shown = accounts.slice(0, MAX_LISTED).map(label).join(', ');
  return total > MAX_LISTED ? `${shown} και άλλοι ${total - MAX_LISTED}` : shown;
}

const byCode = (a: ChartAccount, b: ChartAccount): number => a.code.localeCompare(b.code, 'el');

const PATH_LABEL: Record<AccountPath, string> = {
  LINLINES: 'ειδικές συναλλαγές',
  ITELINES: 'είδη',
  SRVLINES: 'υπηρεσίες',
  EXPANAL: 'έξοδα',
  SXDOCLINES: 'λογαριασμοί εσόδων/εξόδων',
};

/**
 * Ο έλεγχος. ΚΑΘΑΡΗ συνάρτηση: ίδια είσοδος, ίδιο αποτέλεσμα — τρέχει ίδια στην προεπισκόπηση,
 * πριν από κάθε πραγματική καταχώριση και στη σελίδα του εγγράφου.
 */
export function checkAccounts(lines: readonly AccountCheckInput[], chart: AccountChart): AccountCheck {
  const index = new Map<string, ChartAccount>();
  if (chart.synced) for (const a of chart.accounts) index.set(a.code.trim(), a);
  const all = chart.synced ? [...index.values()] : [];

  const out: AccountCheckLine[] = [];
  for (const l of lines) {
    if (!l.path) continue;
    const article = l.article?.trim() || null;
    const who = `Γραμμή ${l.rowIndex + 1}${article ? ` («${article}»)` : ''}`;
    const base: AccountCheckLine = {
      rowIndex: l.rowIndex, path: l.path, status: 'not_covered', account: null, accountName: null,
      inactive: false, unknownReason: null, parent: null, siblings: [], matches: [], matchCount: 0,
      article, message: '', vatMismatch: null,
    };

    if (l.path !== 'LINLINES') {
      out.push({
        ...base,
        message: `${who}: ο έλεγχος λογαριασμού δεν καλύπτει ακόμη τις γραμμές «${PATH_LABEL[l.path]}» — `
          + 'ο λογαριασμός συντίθεται στο SoftOne από τη γέφυρα λογιστικής και δεν ελέγχεται εδώ',
      });
      continue;
    }

    const mask = (l.acnmsk ?? '').trim();
    if (l.acnmskKnown === false) {
      out.push({
        ...base, status: 'unknown', unknownReason: 'line_item_not_synced', account: mask || null,
        message: `${who}: ο λογαριασμός της χρεοπίστωσης δεν έχει διαβαστεί ακόμη — συγχρόνισε τις χρεοπιστώσεις`,
      });
      continue;
    }
    // Κενός λογαριασμός: το ξέρουμε από την ίδια τη χρεοπίστωση, δεν χρειάζεται σχέδιο για να το πούμε.
    if (!mask) {
      out.push({
        ...base, status: 'missing',
        message: `${who}: η χρεοπίστωση δεν έχει λογαριασμό γενικής λογιστικής («Γενικής») στο SoftOne — `
          + 'η εγγραφή δεν θα είχε πού να πάει',
      });
      continue;
    }
    if (!chart.synced) {
      out.push({
        ...base, status: 'unknown', unknownReason: 'chart_not_synced', account: mask,
        message: `${who}: λογαριασμός ${mask} — το λογιστικό σχέδιο δεν έχει συγχρονιστεί, δεν ξέρουμε αν υπάρχει`,
      });
      continue;
    }

    if (isPattern(mask)) {
      const re = patternRegex(mask);
      const covered = all.filter((a) => re.test(a.code));
      const matches = covered.filter(isPostable).sort(byCode);
      const summary = covered.length - matches.length;
      out.push({
        ...base, status: 'mask', account: mask,
        matches: matches.slice(0, MAX_LISTED), matchCount: matches.length,
        message: `${who}: η χρεοπίστωση έχει ΜΑΣΚΑ λογαριασμού ${mask}, όχι λογαριασμό — η γραμμή θα έφτανε `
          + 'στη λογιστική με αυτό το κείμενο αντί για λογαριασμό. '
          + (matches.length
            ? `Υποψήφιοι κινούμενοι λογαριασμοί (${matches.length}): ${listed(matches)}. `
            : covered.length
              ? `Η μάσκα δεν καλύπτει ΚΑΝΕΝΑΝ λογαριασμό που δέχεται εγγραφές (ταιριάζει μόνο με ${summary} συγκεντρωτικ${summary === 1 ? 'ό' : 'ούς'}). `
              : 'Η μάσκα δεν ταιριάζει με κανέναν λογαριασμό του σχεδίου. ')
          + 'Ο λογιστής να ορίσει συγκεκριμένο λογαριασμό στην καρτέλα της χρεοπίστωσης στο SoftOne',
      });
      continue;
    }

    const hit = index.get(mask);
    if (hit && hit.postable === false) {
      out.push({
        ...base, status: 'not_postable', account: mask, accountName: hit.name,
        message: `${who}: ο λογαριασμός ${label(hit)} είναι συγκεντρωτικός λογαριασμός — δεν δέχεται `
          + 'εγγραφές· ο λογιστής να ορίσει κινούμενο (αναλυτικό) λογαριασμό στην καρτέλα της χρεοπίστωσης',
      });
      continue;
    }
    if (hit && hit.postable !== true) {
      out.push({
        ...base, status: 'unknown', unknownReason: 'postability_unknown', account: mask, accountName: hit.name,
        message: `${who}: λογαριασμός ${label(hit)} — δεν ξέρουμε αν δέχεται εγγραφές (δεν έχει διαβαστεί η `
          + 'σημαία «Κινείται»)· συγχρόνισε το λογιστικό σχέδιο',
      });
      continue;
    }
    if (hit) {
      const inactive = hit.isActive === false;
      out.push({
        ...base, status: 'ok', account: mask, accountName: hit.name, inactive,
        message: `${who}: λογαριασμός ${label(hit)}${inactive ? ' (ανενεργός στο SoftOne)' : ''}`,
        vatMismatch: vatMismatchOf(hit, l.vatRate, who),
      });
      continue;
    }

    const parentCode = parentOf(mask);
    const parent = parentCode ? index.get(parentCode) ?? null : null;
    if (parent) {
      // Μόνο ΚΙΝΟΥΜΕΝΟΙ: ένας συγκεντρωτικός δεν είναι πρόταση, δεν δέχεται εγγραφές.
      const siblings = all.filter((a) => parentOf(a.code) === parent.code && isPostable(a)).sort(byCode);
      out.push({
        ...base, status: 'not_in_chart', account: mask, parent, siblings: siblings.slice(0, MAX_LISTED),
        message: `${who}: ο λογαριασμός ${mask} δεν υπάρχει στο λογιστικό σχέδιο. Υπάρχει ο ${label(parent)}`
          + (siblings.length
            ? ` με τους λογαριασμούς ${listed(siblings)} — στο ΕΓΛΣ η τελευταία βαθμίδα είναι συνήθως ο `
              + 'συντελεστής ΦΠΑ· ο λογιστής να διορθώσει την καρτέλα της χρεοπίστωσης στο SoftOne'
            : ', χωρίς κινούμενους λογαριασμούς κάτω του — ο λογιστής να διορθώσει την καρτέλα της χρεοπίστωσης στο SoftOne'),
      });
      continue;
    }
    out.push({
      ...base, status: 'not_in_chart', account: mask,
      message: `${who}: ο λογαριασμός ${mask} δεν υπάρχει στο λογιστικό σχέδιο`
        + (parentCode ? `, ούτε ο γονικός του ${parentCode}` : '')
        + ' — πιθανότατα κωδικός άλλου λογιστικού σχεδίου· ο λογιστής να διορθώσει την καρτέλα της χρεοπίστωσης',
    });
  }
  return { chartSynced: chart.synced, lines: out };
}

/** Οι κωδικοί εμποδίων που παράγει ο έλεγχος — ίδια ονόματα με το `BlockerCode`. */
export type AccountBlockerCode = 'account_missing' | 'account_not_in_chart' | 'account_is_mask' | 'account_not_postable';
/** Οι παρατηρήσεις του ελέγχου — ίδια ονόματα με το `WarningCode`. */
export type AccountWarningCode = 'account_unknown' | 'account_not_covered' | 'account_vat_mismatch';

export function accountBlockers(check: AccountCheck | null | undefined): AccountBlockerCode[] {
  if (!check) return [];
  const out: AccountBlockerCode[] = [];
  if (check.lines.some((l) => l.status === 'missing')) out.push('account_missing');
  if (check.lines.some((l) => l.status === 'not_in_chart')) out.push('account_not_in_chart');
  if (check.lines.some((l) => l.status === 'mask')) out.push('account_is_mask');
  if (check.lines.some((l) => l.status === 'not_postable')) out.push('account_not_postable');
  return out;
}

export function accountWarnings(check: AccountCheck | null | undefined): AccountWarningCode[] {
  if (!check) return [];
  const out: AccountWarningCode[] = [];
  if (check.lines.some((l) => l.status === 'unknown')) out.push('account_unknown');
  if (check.lines.some((l) => l.status === 'not_covered')) out.push('account_not_covered');
  if (check.lines.some((l) => l.vatMismatch != null)) out.push('account_vat_mismatch');
  return out;
}

const STATUSES_FOR: Record<Exclude<AccountBlockerCode | AccountWarningCode, 'account_vat_mismatch'>, AccountStatus[]> = {
  account_missing: ['missing'],
  account_not_in_chart: ['not_in_chart'],
  account_is_mask: ['mask'],
  account_not_postable: ['not_postable'],
  account_unknown: ['unknown'],
  account_not_covered: ['not_covered'],
};

/** Οι ανά γραμμή προτάσεις πίσω από ένα εμπόδιο/παρατήρηση του ελέγχου. */
export function accountDetails(code: AccountBlockerCode | AccountWarningCode, check: AccountCheck | null | undefined): string[] {
  if (!check) return [];
  if (code === 'account_vat_mismatch') {
    return check.lines.map((l) => l.vatMismatch?.message).filter((m): m is string => Boolean(m));
  }
  const want = STATUSES_FOR[code];
  return check.lines.filter((l) => want.includes(l.status)).map((l) => l.message);
}
