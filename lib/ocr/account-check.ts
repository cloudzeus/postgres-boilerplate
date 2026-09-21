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
// με οποιαδήποτε ακολουθία χαρακτήρων (και τελείες), όλα τα άλλα κατά γράμμα. Μοτίβο που ταιριάζει
// με τουλάχιστον έναν λογαριασμό του σχεδίου ΔΕΝ εμποδίζει — αλλά δεν είναι λογαριασμός: φαίνεται
// ως παρατήρηση, με τους λογαριασμούς που καλύπτει.
//
// ── ΤΙ ΔΕΝ ΚΑΝΕΙ, ΣΚΟΠΙΜΑ ──────────────────────────────────────────────────────────────────────
// Δεν συγκρίνει την περιγραφή της χρεοπίστωσης με την περιγραφή του λογαριασμού. Ο πελάτης έχει δύο
// λογιστικά σχέδια (ΕΓΛΣ στο ACNT, ΕΛΠ στις χρεοπιστώσεις): «61.02» είναι «Λοιπές προμήθειες τρίτων»
// στο ένα και «Απομείωση βιολογικών» στο άλλο. Κανένας αλγόριθμος ομοιότητας δεν ξεχωρίζει τα 5
// πραγματικά λάθη από τις 11 αθώες αναδιατυπώσεις — ένα λογιστής ναι. Γι' αυτό ο έλεγχος ΔΕΙΧΝΕΙ
// πάντα το όνομα του λογαριασμού δίπλα στη χρεοπίστωση και αφήνει την κρίση στον άνθρωπο.

/** Ένας λογαριασμός του λογιστικού σχεδίου (ACNT). */
export type ChartAccount = { code: string; name: string; isActive?: boolean };

/**
 * Ο καθρέφτης του λογιστικού σχεδίου όπως τον βλέπει ο έλεγχος.
 * `synced: false` = άδειος ή ποτέ συγχρονισμένος — ΤΟΤΕ Ο ΕΛΕΓΧΟΣ ΔΕΝ ΚΡΙΝΕΙ ΤΙΠΟΤΑ.
 * `accounts` μπορεί να είναι υποσύνολο του σχεδίου, αρκεί να περιέχει όσους αφορούν τις γραμμές
 * (τους ίδιους, τους γονείς τους, τα αδέλφια τους και ό,τι ταιριάζει στα μοτίβα) — βλ. `chartNeeds`.
 */
export type AccountChart = { synced: boolean; accounts: readonly ChartAccount[] };

/** Ο πίνακας γραμμών όπου πάει μια γραμμή — από τον στόχο της σειράς. */
export type AccountPath = 'LINLINES' | 'ITELINES' | 'SRVLINES' | 'EXPANAL';

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
};

export type AccountStatus =
  /** Ο λογαριασμός υπάρχει στο σχέδιο — φαίνεται με το όνομά του. */
  | 'ok'
  /** Μοτίβο (με `*`) που καλύπτει τουλάχιστον έναν λογαριασμό. Δεν εμποδίζει. */
  | 'pattern'
  /** Κενός λογαριασμός — ΕΜΠΟΔΙΟ. */
  | 'missing'
  /** Λογαριασμός (ή μοτίβο) που δεν υπάρχει στο σχέδιο — ΕΜΠΟΔΙΟ. */
  | 'not_in_chart'
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
  unknownReason: 'chart_not_synced' | 'line_item_not_synced' | null;
  /** `not_in_chart`: ο γονικός λογαριασμός, αν υπάρχει στο σχέδιο. */
  parent: ChartAccount | null;
  /** `not_in_chart` με γονικό: οι λογαριασμοί κάτω από αυτόν — ΠΡΟΤΑΣΕΙΣ, όχι επιλογή. */
  siblings: ChartAccount[];
  /** `pattern`: οι λογαριασμοί που καλύπτει (το πολύ `MAX_LISTED`) και πόσοι είναι συνολικά. */
  matches: ChartAccount[];
  matchCount: number;
  article: string | null;
  /** Μία ελληνική πρόταση για τη γραμμή. */
  message: string;
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
      article, message: '',
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
      const matches = all.filter((a) => re.test(a.code)).sort(byCode);
      if (matches.length === 0) {
        out.push({
          ...base, status: 'not_in_chart', account: mask,
          message: `${who}: η μάσκα λογαριασμού ${mask} δεν ταιριάζει με κανέναν λογαριασμό του λογιστικού σχεδίου`,
        });
      } else {
        out.push({
          ...base, status: 'pattern', account: mask,
          matches: matches.slice(0, MAX_LISTED), matchCount: matches.length,
          message: `${who}: η χρεοπίστωση έχει ΜΑΣΚΑ λογαριασμού ${mask}, όχι λογαριασμό — καλύπτει `
            + `${matches.length === 1 ? 'τον' : `${matches.length} λογαριασμούς:`} ${listed(matches)}. `
            + 'Βεβαιώσου στο SoftOne σε ποιον θα καταλήξει η γραμμή',
        });
      }
      continue;
    }

    const hit = index.get(mask);
    if (hit) {
      const inactive = hit.isActive === false;
      out.push({
        ...base, status: 'ok', account: mask, accountName: hit.name, inactive,
        message: `${who}: λογαριασμός ${label(hit)}${inactive ? ' (ανενεργός στο SoftOne)' : ''}`,
      });
      continue;
    }

    const parentCode = parentOf(mask);
    const parent = parentCode ? index.get(parentCode) ?? null : null;
    if (parent) {
      const siblings = all.filter((a) => parentOf(a.code) === parent.code).sort(byCode);
      out.push({
        ...base, status: 'not_in_chart', account: mask, parent, siblings: siblings.slice(0, MAX_LISTED),
        message: `${who}: ο λογαριασμός ${mask} δεν υπάρχει στο λογιστικό σχέδιο. Υπάρχει ο ${label(parent)}`
          + (siblings.length
            ? ` με τους λογαριασμούς ${listed(siblings)} — στο ΕΓΛΣ η τελευταία βαθμίδα είναι συνήθως ο `
              + 'συντελεστής ΦΠΑ· ο λογιστής να διορθώσει την καρτέλα της χρεοπίστωσης στο SoftOne'
            : ', χωρίς λογαριασμούς κάτω του — ο λογιστής να διορθώσει την καρτέλα της χρεοπίστωσης στο SoftOne'),
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
export type AccountBlockerCode = 'account_missing' | 'account_not_in_chart';
/** Οι παρατηρήσεις του ελέγχου — ίδια ονόματα με το `WarningCode`. */
export type AccountWarningCode = 'account_unknown' | 'account_pattern' | 'account_not_covered';

export function accountBlockers(check: AccountCheck | null | undefined): AccountBlockerCode[] {
  if (!check) return [];
  const out: AccountBlockerCode[] = [];
  if (check.lines.some((l) => l.status === 'missing')) out.push('account_missing');
  if (check.lines.some((l) => l.status === 'not_in_chart')) out.push('account_not_in_chart');
  return out;
}

export function accountWarnings(check: AccountCheck | null | undefined): AccountWarningCode[] {
  if (!check) return [];
  const out: AccountWarningCode[] = [];
  if (check.lines.some((l) => l.status === 'unknown')) out.push('account_unknown');
  if (check.lines.some((l) => l.status === 'pattern')) out.push('account_pattern');
  if (check.lines.some((l) => l.status === 'not_covered')) out.push('account_not_covered');
  return out;
}

const STATUSES_FOR: Record<AccountBlockerCode | AccountWarningCode, AccountStatus[]> = {
  account_missing: ['missing'],
  account_not_in_chart: ['not_in_chart'],
  account_unknown: ['unknown'],
  account_pattern: ['pattern'],
  account_not_covered: ['not_covered'],
};

/** Οι ανά γραμμή προτάσεις πίσω από ένα εμπόδιο/παρατήρηση του ελέγχου. */
export function accountDetails(code: AccountBlockerCode | AccountWarningCode, check: AccountCheck | null | undefined): string[] {
  if (!check) return [];
  const want = STATUSES_FOR[code];
  return check.lines.filter((l) => want.includes(l.status)).map((l) => l.message);
}
