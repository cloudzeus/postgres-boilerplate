// lib/ocr/posting-target.ts — ΚΑΘΑΡΟ (χωρίς prisma / δίκτυο / server-only).
//
// «Πού καταχωρείται μια σειρά»: σε ΠΟΙΟ SoftOne object και σε ΠΟΙΟΝ πίνακα γραμμών.
// Δεν είναι το ίδιο για όλα τα παραστατικά — ο χρήστης το έθεσε ρητά: «ανάλογα με τον τύπο του
// παραστατικού είναι mtrllines, srvlines, linlines».
//
// Τι λέει το schema του SoftOne (επαληθευμένο στο cached softone-full-schema):
//   • PURDOC    «Παραστατικά αγορών»            → ITELINES · SRVLINES · ASSLINES (DB MTRLINES) + EXPANAL
//   • LINSUPDOC «Ειδικές συναλλαγές προμηθευτών»→ LINLINES (DB MTRLINES)
//   • LINCREDOC «Ειδικές συναλλαγές πιστωτών»   → LINLINES (DB MTRLINES)
// Και τα τρία μοιράζονται την ίδια κεφαλίδα (DB FINDOC): SERIES, TRNDATE, TRDR, FINCODE,
// COMMENTS, MYDATAMARK, MYDATAUID. Το SODTYPE των LIN*DOC είναι read-only με default (12 / 16),
// άρα ΔΕΝ το στέλνουμε.
//
// ΠΟΙΑ σειρά πάει πού είναι ρύθμιση ΕΓΚΑΤΑΣΤΑΣΗΣ, όχι κανόνας του SoftOne: εδώ ζουν μόνο οι
// προεπιλογές ανά ενότητα (SOSOURCE) και ο χρήστης τις παρακάμπτει ανά σειρά από το
// /admin/doc-series.

/** Το SoftOne object (EditMaster) που δέχεται το setData. */
export const POST_OBJECTS = ['PURDOC', 'LINSUPDOC', 'LINCREDOC'] as const;
export type PostObject = (typeof POST_OBJECTS)[number];

/**
 * Ο πίνακας γραμμών. `AUTO` = «ανά γραμμή» (μόνο για PURDOC): κάθε γραμμή πάει στον πίνακα που
 * της αναλογεί ανάλογα με το τι ταίριαξε — είδος → ITELINES, υπηρεσία → SRVLINES, έξοδο → EXPANAL.
 */
/** Σύντομο ελληνικό όνομα του object, χωρίς τον κωδικό — για chips και τίτλους. */
export const POST_OBJECT_SHORT: Record<'PURDOC' | 'LINSUPDOC' | 'LINCREDOC', string> = {
  PURDOC: 'Παραστατικό αγορών',
  LINSUPDOC: 'Ειδικές συναλλαγές προμηθευτών',
  LINCREDOC: 'Ειδικές συναλλαγές πιστωτών',
};

export const POST_LINE_TABLES =['AUTO', 'ITELINES', 'SRVLINES', 'ASSLINES', 'EXPANAL', 'LINLINES'] as const;
export type PostLineTable = (typeof POST_LINE_TABLES)[number];

export const POST_OBJECT_LABEL: Record<PostObject, string> = {
  PURDOC: 'Παραστατικά αγορών (PURDOC)',
  LINSUPDOC: 'Ειδικές συναλλαγές προμηθευτών (LINSUPDOC)',
  LINCREDOC: 'Ειδικές συναλλαγές πιστωτών (LINCREDOC)',
};

export const POST_LINES_LABEL: Record<PostLineTable, string> = {
  AUTO: 'Αυτόματα ανά γραμμή (Είδη / Υπηρεσίες / Έξοδα)',
  ITELINES: 'Είδη',
  SRVLINES: 'Υπηρεσίες',
  ASSLINES: 'Πάγια',
  EXPANAL: 'Έξοδα',
  LINLINES: 'Ειδικές συναλλαγές',
};

/** Ποιοι πίνακες γραμμών υπάρχουν πραγματικά σε κάθε object (από το schema του SoftOne). */
export const LINES_FOR_OBJECT: Record<PostObject, PostLineTable[]> = {
  PURDOC: ['AUTO', 'ITELINES', 'SRVLINES', 'ASSLINES', 'EXPANAL'],
  LINSUPDOC: ['LINLINES'],
  LINCREDOC: ['LINLINES'],
};

export const isPostObject = (v: unknown): v is PostObject =>
  typeof v === 'string' && (POST_OBJECTS as readonly string[]).includes(v);
export const isPostLineTable = (v: unknown): v is PostLineTable =>
  typeof v === 'string' && (POST_LINE_TABLES as readonly string[]).includes(v);

export interface PostingTarget {
  object: PostObject;
  lines: PostLineTable;
  /** `configured` = το διάλεξε ο χρήστης στη σειρά· `default` = προέκυψε από την ενότητα. */
  source: 'configured' | 'default';
  /** Ελληνική εξήγηση για το UI («γιατί αυτό»). */
  reason: string;
}

/** Η σειρά όπως τη βλέπει ο resolver — ό,τι κρατά το μητρώο, τίποτα παραπάνω. */
export interface SeriesTargetInput {
  /** SoftOne SOSOURCE (1251 αγορές, 1653 πιστωτές, 1253 λοιπές συναλλαγές προμηθευτών…). */
  sosource: number | null | undefined;
  /** FPRMS / «Τύπος» της σειράς. */
  section?: string | null;
  /** Περιγραφή της σειράς — χρήσιμη μόνο για το «μυρίζει πάγιο». */
  name?: string | null;
  postObject?: string | null;
  postLines?: string | null;
}

/** Ελληνικά χωρίς τόνους και κεφαλαία, για να πιάνουν τα μοτίβα ό,τι κι αν έγραψε ο χρήστης. */
const flat = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/** «Πάγια» στην περιγραφή/τύπο μιας σειράς αγορών — αδιαμφισβήτητο. */
const ASSET_HINT = /ΠΑΓΙ/;
/**
 * Σειρά «δαπάνης / υπηρεσίας» μέσα στην ενότητα αγορών. Οι λέξεις προέρχονται από την ίδια την
 * οθόνη του πελάτη (§14.8 του spec: «Τιμολόγιο Δαπανών ΚΕ.Π.Υ.Ο», «Υπηρεσίες Ε.Ε.», «Υπηρεσίες
 * Τρίτες Χώρες») — ένα τέτοιο παραστατικό ΔΕΝ είναι αγορά εμπορευμάτων.
 */
const EXPENSE_HINT = /ΔΑΠΑΝ|ΕΞΟΔ|ΥΠΗΡΕΣΙ|ΠΑΡΟΧΗΣ|ΚΕ\.?Π\.?Υ\.?Ο|ΤΠΥ|ΑΠΥ/;

/**
 * Η προεπιλογή ανά ενότητα, με τον κανόνα γραμμένο ρητά:
 *
 *  • 1653 «Παραστατικά πιστωτών» → LINCREDOC / LINLINES. Εκεί ζουν οι ΕΝΕΡΓΟΠΟΙΗΜΕΝΕΣ σειρές του
 *    πελάτη («Τιμολόγιο Δαπανών (Λήψη)» κ.λπ.) και εκεί δείχνει το §14.8 του spec, δηλαδή η οθόνη
 *    «Ειδικές συναλλαγές → Δαπάνες Προμηθευτών (Int)».
 *  • 1253 «Λοιπές συναλλαγές προμηθευτών» → LINSUPDOC / LINLINES (ένας πίνακας γραμμών υπάρχει).
 *  • 1251 «Αγορές»:
 *      – σειρά που μυρίζει ΔΑΠΑΝΗ/ΥΠΗΡΕΣΙΑ → LINSUPDOC / LINLINES (ίδια λογική με το §14.8),
 *      – σειρά ΠΑΓΙΩΝ                       → PURDOC / ASSLINES,
 *      – αλλιώς (καθαρή αγορά εμπορευμάτων) → PURDOC με πίνακα ΑΝΑ ΓΡΑΜΜΗ (`AUTO`): για γραμμή
 *        αντιστοιχισμένη σε είδος αυτό ΕΙΝΑΙ το ITELINES — απλώς δεν αρνείται μια μεμονωμένη
 *        γραμμή υπηρεσίας ή εξόδου μέσα στο ίδιο τιμολόγιο αγοράς.
 *  • Οτιδήποτε άλλο → PURDOC / AUTO (η γενική), για να μην αλλάξει σιωπηλά καμία υπάρχουσα σειρά.
 *
 * ΚΑΘΕ προεπιλογή παρακάμπτεται ανά σειρά από το /admin/doc-series — ποια σειρά πάει πού είναι
 * ρύθμιση της εγκατάστασης, όχι κανόνας που μπορούμε να συμπεράνουμε από το schema.
 */
export function defaultPostingTarget(input: SeriesTargetInput): PostingTarget {
  const sosource = Number(input.sosource);
  const text = flat(`${input.section ?? ''} ${input.name ?? ''}`);

  if (sosource === 1653) {
    return { object: 'LINCREDOC', lines: 'LINLINES', source: 'default', reason: 'Ενότητα 1653 «Παραστατικά πιστωτών» → Ειδικές συναλλαγές πιστωτών' };
  }
  if (sosource === 1253) {
    return { object: 'LINSUPDOC', lines: 'LINLINES', source: 'default', reason: 'Ενότητα 1253 «Λοιπές συναλλαγές προμηθευτών» → Ειδικές συναλλαγές προμηθευτών' };
  }
  if (sosource === 1251) {
    if (ASSET_HINT.test(text)) {
      return { object: 'PURDOC', lines: 'ASSLINES', source: 'default', reason: 'Σειρά αγορών παγίων → Παραστατικό αγορών, γραμμές παγίων' };
    }
    if (EXPENSE_HINT.test(text)) {
      return { object: 'LINSUPDOC', lines: 'LINLINES', source: 'default', reason: 'Σειρά δαπανών/υπηρεσιών → Ειδικές συναλλαγές προμηθευτών' };
    }
    return { object: 'PURDOC', lines: 'AUTO', source: 'default', reason: 'Σειρά αγοράς εμπορευμάτων → Παραστατικό αγορών, πίνακας ανά γραμμή' };
  }
  return { object: 'PURDOC', lines: 'AUTO', source: 'default', reason: 'Χωρίς προεπιλογή για την ενότητα — ισχύει η γενική (Παραστατικό αγορών)' };
}

/**
 * Ο τελικός στόχος: ό,τι έθεσε ο χρήστης στη σειρά, αλλιώς η προεπιλογή της ενότητας.
 * Ασυνεπής ρύθμιση (π.χ. object LINSUPDOC με πίνακα EXPANAL) ΔΕΝ γίνεται δεκτή σιωπηλά —
 * πέφτει στον μοναδικό/πρώτο έγκυρο πίνακα του object, ώστε το payload να μένει πάντα χτίσιμο.
 */
export function resolvePostingTarget(input: SeriesTargetInput): PostingTarget {
  const fallback = defaultPostingTarget(input);
  const object = isPostObject(input.postObject) ? input.postObject : null;
  const lines = isPostLineTable(input.postLines) ? input.postLines : null;
  if (!object && !lines) return fallback;

  const obj = object ?? fallback.object;
  const allowed = LINES_FOR_OBJECT[obj];
  const picked = lines && allowed.includes(lines)
    ? lines
    : (allowed.includes(fallback.lines) ? fallback.lines : allowed[0]);

  return {
    object: obj,
    lines: picked,
    source: 'configured',
    reason: `Ρύθμιση σειράς: ${POST_OBJECT_LABEL[obj]} · ${POST_LINES_LABEL[picked]}`,
  };
}

/** «Παραστατικά αγορών (PURDOC) · Είδη» — μία γραμμή για κάρτες και toasts. */
export const describeTarget = (t: PostingTarget): string =>
  `${POST_OBJECT_LABEL[t.object]} · ${POST_LINES_LABEL[t.lines]}`;

/** «Ειδικές συναλλαγές προμηθευτών · γραμμές LINLINES» — η μορφή που ζητήθηκε για την κάρτα. */
export const describeTargetShort = (t: PostingTarget): string =>
  `${POST_OBJECT_SHORT[t.object]} · ${t.lines === 'AUTO' ? 'γραμμές ανά είδος αντιστοίχισης' : `γραμμές ${t.lines}`}`;
