// lib/ocr/lineitem-create.ts — ΚΑΘΑΡΟ (χωρίς prisma / δίκτυο / server-only).
//
// Οι κανόνες για τη **δημιουργία χρεοπίστωσης** (object `LINEITEM` → `MTRL` SODTYPE 53), χώρια από
// την εκτέλεση, ώστε να δοκιμάζονται χωρίς να αγγίζει τίποτα το ERP.
//
// Η δημιουργία χρεοπίστωσης ΔΕΝ είναι «όνομα + ΦΠΑ». Τρία πεδία της καρτέλας αποφασίζουν αν η
// εγγραφή που θα φτιάξουμε θα είναι **χρησιμοποιήσιμη** — και τα τρία είναι αόρατα αν δεν τα
// κοιτάξεις επίτηδες:
//
//  1. **`LISOURCETYPE` («Κατηγορία τιμολόγησης», editor `$SODTYPE`)** — λίστα SODTYPE χωρισμένη με
//     κόμματα, που λέει σε ποιων τύπων συναλλασσομένων τα παραστατικά επιτρέπεται να μπει η
//     χρεοπίστωση. Ζωντανά, στις 207 ενεργές χρεοπιστώσεις του πελάτη: `12,13,14,15,16` ×161,
//     `12,14` ×24, `12,16` ×11, `14` ×8, `12,14,16` ×2, `12` ×1. Δηλαδή **33 από τις 207** ΔΕΝ
//     περιέχουν το `16`: αν αντιγράψουμε μία από αυτές ως πρότυπο για παραστατικό **πιστωτή**, η
//     νέα χρεοπίστωση δεν μπαίνει στη γραμμή — ακριβώς το παραστατικό για το οποίο υπάρχει αυτή η
//     ροή. Είναι required πεδίο χωρίς default, άρα ούτε να το παραλείψουμε μπορούμε.
//  2. **`ACNMSK`** — ο λογαριασμός **γενικής λογιστικής**. Αντιγραμμένος στα τυφλά από γείτονα,
//     γράφει τη δαπάνη σε λάθος λογαριασμό· αντιγραμμένος από πρότυπο που τον έχει **κενό**
//     (7 στις 207) γεννά χρεοπίστωση που ο ΔΙΚΟΣ μας έλεγχος μπλοκάρει με `account_missing`,
//     χωρίς κανέναν τρόπο διόρθωσης μέσα από την εφαρμογή.
//  3. **`MTRTYPE1`** — required με default 0, αλλά ζωντανά είναι **1 σε 175 από τις 207**.
//
// ⚠️ **Ο ΧΑΡΑΚΤΗΡΙΣΜΟΣ myDATA ΔΕΝ ΑΝΤΙΓΡΑΦΕΤΑΙ ΠΟΤΕ.** Ήταν λάθος να αντιγράφεται: μια νέα
// χρεοπίστωση ρεύματος φτιαγμένη από πρότυπο «Έξοδα εκθέσεων» κληρονομούσε τον χαρακτηρισμό
// εκείνου — και επειδή το `postingWarnings` βγάζει `no_mydata_classification` **μόνο** όταν η
// καρτέλα δεν έχει κανέναν, η αντιγραφή **έσβηνε την προειδοποίηση** που θα έλεγε στον χρήστη να
// τον ορίσει. Δηλαδή αντί για «λείπει χαρακτηρισμός» έφευγε σιωπηλά **λάθος** χαρακτηρισμός στο
// myDATA. Κενά πεδία ⇒ η προειδοποίηση χτυπά ⇒ ο άνθρωπος αποφασίζει. Το ίδιο ισχύει για
// `CLASSTYPE`, `CLASSCATEGORY`, `MYDATAVPRC`.

/** Τα πεδία του προτύπου που αντιγράφονται αυτούσια. Ο χαρακτηρισμός myDATA λείπει ΕΠΙΤΗΔΕΣ. */
export const LINEITEM_COPY_FIELDS = ['MTRTYPE', 'MTRTYPE1', 'KEPYO', 'LISOURCETYPE', 'MTRUNIT1'] as const;

/** Τα πεδία που **διαβάζουμε** από το πρότυπο: όσα αντιγράφουμε, συν όσα κρίνουμε ή δείχνουμε. */
export const LINEITEM_TEMPLATE_READ_FIELDS = [...LINEITEM_COPY_FIELDS, 'VAT', 'MTRCATEGORY', 'ACNMSK'] as const;

/** Ελληνικό όνομα του τύπου συναλλασσομένου, από το SODTYPE — για τα μηνύματα. */
const SODTYPE_NAME: Record<number, string> = {
  12: 'προμηθευτής', 13: 'πελάτης', 14: 'χρηματικός λογαριασμός', 15: 'χρεώστης', 16: 'πιστωτής',
};

/** Η λίστα `LISOURCETYPE` σε αριθμούς. Ανεκτική σε κενά, διπλά κόμματα και σκουπίδια. */
export function parseLisourceType(raw: unknown): number[] {
  return String(raw ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/** Περιέχει η «Κατηγορία τιμολόγησης» τον τύπο που χρειάζεται το παραστατικό; */
export function lisourceAllows(raw: unknown, sodtype: number): boolean {
  return parseLisourceType(raw).includes(sodtype);
}

export interface LineItemTemplateIssue {
  code: 'lisource_missing' | 'lisource_excludes_target' | 'account_blocked';
  message: string;
}

/**
 * Κρίνει ένα πρότυπο **πριν** χρησιμοποιηθεί. Επιστρέφει `null` όταν είναι κατάλληλο.
 *
 * `requiredSodtype = null` σημαίνει «δεν ξέρουμε πού καταχωρείται αυτό το παραστατικό» — τότε ΔΕΝ
 * κρίνουμε την κατηγορία τιμολόγησης, με την ίδια λογική που δεν κρίνουμε τον τύπο καρτέλας.
 */
export function checkLineItemTemplate(input: {
  templateLabel: string;
  lisourceType: unknown;
  requiredSodtype: number | null;
  /** Η ετυμηγορία του `checkAccounts` για τον λογαριασμό του προτύπου. */
  accountStatus?: 'ok' | 'mask' | 'missing' | 'not_in_chart' | 'not_postable' | 'inactive' | 'unknown' | 'not_covered' | null;
  accountMessage?: string | null;
  /** `true` όταν τον λογαριασμό τον διάλεξε ΡΗΤΑ ο χρήστης — αλλάζει μόνο τη διατύπωση. */
  accountChosen?: boolean;
}): LineItemTemplateIssue | null {
  const list = parseLisourceType(input.lisourceType);
  if (list.length === 0) {
    return {
      code: 'lisource_missing',
      message:
        `Το πρότυπο «${input.templateLabel}» δεν έχει «Κατηγορία τιμολόγησης» (LISOURCETYPE). Το πεδίο `
        + 'είναι υποχρεωτικό στο SoftOne και δεν το εφευρίσκουμε — διάλεξε άλλο πρότυπο.',
    };
  }
  if (input.requiredSodtype != null && !list.includes(input.requiredSodtype)) {
    const want = SODTYPE_NAME[input.requiredSodtype] ?? `τύπος ${input.requiredSodtype}`;
    const have = list.map((n) => `${n}${SODTYPE_NAME[n] ? ` ${SODTYPE_NAME[n]}` : ''}`).join(', ');
    return {
      code: 'lisource_excludes_target',
      message:
        `Το πρότυπο «${input.templateLabel}» έχει «Κατηγορία τιμολόγησης» ${have} — δεν περιλαμβάνει τον `
        + `τύπο ${input.requiredSodtype} (${want}) που απαιτεί η σειρά αυτού του παραστατικού. Μια `
        + 'χρεοπίστωση φτιαγμένη από αυτό δεν θα μπορούσε να μπει στη γραμμή. Διάλεξε άλλο πρότυπο.',
    };
  }
  // Ο λογαριασμός του προτύπου: ό,τι μπλοκάρει την ΚΑΤΑΧΩΡΙΣΗ δεν επιτρέπεται να γεννηθεί εδώ.
  // Το `unknown` (ασυγχρόνιστο σχέδιο) ΔΕΝ είναι εμπόδιο — ίδια στάση με το `postingBlockers`.
  const bad = ['mask', 'missing', 'not_in_chart', 'not_postable'];
  if (input.accountStatus && bad.includes(input.accountStatus)) {
    // Η διατύπωση ακολουθεί την ΠΗΓΗ του λογαριασμού: το να πούμε «του προτύπου» για λογαριασμό
    // που μόλις διάλεξε ο χρήστης στέλνει το βλέμμα του σε λάθος πεδίο.
    const whose = input.accountChosen
      ? 'Ο λογαριασμός γενικής που διάλεξες'
      : `Ο λογαριασμός γενικής του προτύπου «${input.templateLabel}»`;
    const fix = input.accountChosen ? 'Διάλεξε άλλον λογαριασμό.' : 'Διάλεξε λογαριασμό ρητά πιο κάτω ή άλλο πρότυπο.';
    return {
      code: 'account_blocked',
      message: `${whose} δεν είναι χρησιμοποιήσιμος: ${input.accountMessage ?? input.accountStatus}. ${fix}`,
    };
  }
  return null;
}

/**
 * Ακολουθεί η εγκατάσταση τη σύμβαση «**ένας κωδικός χρεοπίστωσης ανά λογαριασμό γενικής**»;
 *
 * Στον πελάτη ισχύει σε **190 από τις 207** ενεργές (92 %): `CODE` ίδιο με `ACNMSK`, π.χ.
 * `62.01.00.0000` «Φωταέριο παραγωγικής διαδικασίας άνευ Φ.Π.Α.». Μια αριθμητική σειρά τύπου
 * `90000000103` θα έσπαγε τη σύμβαση σε **κάθε** δημιουργία — κι ας μην το έλεγε κανείς.
 *
 * Δεν το επιβάλλουμε: το **μετράμε** στο ίδιο το μητρώο και προτείνουμε τον κωδικό του
 * λογαριασμού μόνο όταν η σύμβαση όντως κρατά. Εγκατάσταση που δεν την ακολουθεί δεν αλλάζει.
 */
export const CODE_FOLLOWS_ACCOUNT_RATIO = 0.6;
/** Κάτω από αυτό το πλήθος το ποσοστό δεν σημαίνει τίποτα — δεν βγάζουμε σύμβαση από 3 γραμμές. */
export const CODE_FOLLOWS_ACCOUNT_MIN = 20;

export interface CodeConvention {
  follows: boolean;
  matched: number;
  total: number;
}

export function codeFollowsAccount(
  rows: readonly { code: string | null; acnmsk: string | null }[],
): CodeConvention {
  const withAccount = rows.filter((r) => (r.acnmsk ?? '').trim() !== '');
  const matched = withAccount.filter(
    (r) => (r.code ?? '').trim().toUpperCase() === (r.acnmsk ?? '').trim().toUpperCase(),
  ).length;
  const total = withAccount.length;
  return {
    follows: total >= CODE_FOLLOWS_ACCOUNT_MIN && matched / total >= CODE_FOLLOWS_ACCOUNT_RATIO,
    matched,
    total,
  };
}
