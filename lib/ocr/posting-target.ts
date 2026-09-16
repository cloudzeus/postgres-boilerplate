// lib/ocr/posting-target.ts — ΚΑΘΑΡΟ (χωρίς prisma / δίκτυο / server-only).
//
// «Πού καταχωρείται μια σειρά»: σε ΠΟΙΟ SoftOne object και σε ΠΟΙΟΝ πίνακα γραμμών.
// Δεν είναι το ίδιο για όλα τα παραστατικά — ο χρήστης το έθεσε ρητά: «ανάλογα με τον τύπο του
// παραστατικού είναι mtrllines, srvlines, linlines».
//
// Τι λέει το schema του SoftOne (επαληθευμένο στο cached softone-full-schema):
//   • PURDOC    «Παραστατικά αγορών»            → ITELINES · SRVLINES (DB MTRLINES) + EXPANAL
//   • LINSUPDOC «Ειδικές συναλλαγές προμηθευτών»→ LINLINES (DB MTRLINES)
//   • LINCREDOC «Ειδικές συναλλαγές πιστωτών»   → LINLINES (DB MTRLINES)
//   • LINDEBDOC «Ειδικές συναλλαγές χρεωστών»   → LINLINES (DB MTRLINES)
// Και τα τέσσερα μοιράζονται την ίδια κεφαλίδα (DB FINDOC): SERIES, TRNDATE, TRDR, FINCODE,
// COMMENTS, MYDATAMARK, MYDATAUID. Το SODTYPE των LIN*DOC είναι read-only με default
// (12 προμηθευτές / 16 πιστωτές / 15 χρεώστες), άρα ΔΕΝ το στέλνουμε.
//
// ΠΟΙΑ σειρά πάει πού είναι ρύθμιση ΕΓΚΑΤΑΣΤΑΣΗΣ, όχι κανόνας του SoftOne: εδώ ζουν μόνο οι
// προεπιλογές ανά ενότητα (SOSOURCE) και ο χρήστης τις παρακάμπτει ανά σειρά από το
// /admin/doc-series.

/** Το SoftOne object (EditMaster) που δέχεται το setData. */
export const POST_OBJECTS = ['PURDOC', 'LINSUPDOC', 'LINCREDOC', 'LINDEBDOC'] as const;
export type PostObject = (typeof POST_OBJECTS)[number];

/**
 * Ο πίνακας γραμμών. `AUTO` = «ανά γραμμή» (μόνο για PURDOC): κάθε γραμμή πάει στον πίνακα που
 * της αναλογεί ανάλογα με το τι ταίριαξε — είδος → ITELINES, υπηρεσία → SRVLINES, έξοδο → EXPANAL.
 */
/** Σύντομο ελληνικό όνομα του object, χωρίς τον κωδικό — για chips και τίτλους. */
export const POST_OBJECT_SHORT: Record<PostObject, string> = {
  PURDOC: 'Παραστατικό αγορών',
  LINSUPDOC: 'Ειδικές συναλλαγές προμηθευτών',
  LINCREDOC: 'Ειδικές συναλλαγές πιστωτών',
  LINDEBDOC: 'Ειδικές συναλλαγές χρεωστών',
};

/**
 * Ο πίνακας γραμμών. `AUTO` = «ανά γραμμή» (μόνο για PURDOC): κάθε γραμμή πάει στον πίνακα που
 * της αναλογεί ανάλογα με το τι ταίριαξε — είδος → ITELINES, υπηρεσία → SRVLINES, έξοδο → EXPANAL.
 *
 * ΓΙΑΤΙ ΛΕΙΠΕΙ ΤΟ `ASSLINES`: οι γραμμές παγίων απαιτούν `MTRL` που είναι ΠΑΓΙΟ (editor ASSET,
 * MTRL με SODTYPE 54), καθώς και `WHOUSE` και `ASSDEPR` — και τα τρία required χωρίς default.
 * Η εφαρμογή δεν καθρεφτίζει μητρώο παγίων (`SoftoneItem` = SODTYPE 51/52 μόνο) και δεν ξέρει
 * ούτε αποθήκη ούτε εγγραφή απόσβεσης, οπότε κάθε τέτοιο payload θα απορριπτόταν από το SoftOne.
 * Ο στόχος θα ξαναμπεί όταν υπάρχει μητρώο παγίων· μέχρι τότε δεν προσφέρεται καν.
 */
export const POST_LINE_TABLES = ['AUTO', 'ITELINES', 'SRVLINES', 'EXPANAL', 'LINLINES'] as const;
export type PostLineTable = (typeof POST_LINE_TABLES)[number];

export const POST_OBJECT_LABEL: Record<PostObject, string> = {
  PURDOC: 'Παραστατικά αγορών (PURDOC)',
  LINSUPDOC: 'Ειδικές συναλλαγές προμηθευτών (LINSUPDOC)',
  LINCREDOC: 'Ειδικές συναλλαγές πιστωτών (LINCREDOC)',
  LINDEBDOC: 'Ειδικές συναλλαγές χρεωστών (LINDEBDOC)',
};

export const POST_LINES_LABEL: Record<PostLineTable, string> = {
  AUTO: 'Αυτόματα ανά γραμμή (Είδη / Υπηρεσίες / Έξοδα)',
  ITELINES: 'Είδη',
  SRVLINES: 'Υπηρεσίες',
  EXPANAL: 'Έξοδα',
  LINLINES: 'Ειδικές συναλλαγές',
};

/** Ποιοι πίνακες γραμμών προσφέρονται σε κάθε object (βλ. σημείωση για τα πάγια πιο πάνω). */
export const LINES_FOR_OBJECT: Record<PostObject, PostLineTable[]> = {
  PURDOC: ['AUTO', 'ITELINES', 'SRVLINES', 'EXPANAL'],
  LINSUPDOC: ['LINLINES'],
  LINCREDOC: ['LINLINES'],
  LINDEBDOC: ['LINLINES'],
};

/**
 * Η ΕΝΟΤΗΤΑ (SOSOURCE) ορίζει το object, όχι εμείς: το `SERIES` μιας κεφαλίδας FINDOC ανήκει σε
 * ΜΙΑ ενότητα, οπότε μια σειρά αγορών (1251) δεν μπορεί να καταχωρηθεί ως ειδική συναλλαγή (1253)
 * — θα έστελνε αριθμό σειράς που δεν υπάρχει εκεί. Γι' αυτό το UI προσφέρει μόνο το object της
 * ενότητας και κάθε ρύθμιση εκτός ενότητας αγνοείται.
 */
export const OBJECTS_FOR_SOSOURCE: Record<number, PostObject> = {
  1251: 'PURDOC',     // Παραστατικά αγορών
  1253: 'LINSUPDOC',  // Λοιπές / ειδικές συναλλαγές προμηθευτών
  1553: 'LINDEBDOC',  // Λοιπές / ειδικές συναλλαγές ΧΡΕΩΣΤΩΝ
  1653: 'LINCREDOC',  // Παραστατικά (ειδικές συναλλαγές) πιστωτών
};

/** Ποιο object επιτρέπεται για μια ενότητα — κενό όταν η ενότητα δεν υποστηρίζεται καθόλου. */
export const objectsForSosource = (sosource: number | null | undefined): PostObject[] => {
  const o = OBJECTS_FOR_SOSOURCE[Number(sosource)];
  return o ? [o] : [];
};

/**
 * Ποιον ΤΥΠΟ συναλλασσομένου δέχεται η κεφαλίδα του κάθε object (TRDR.SODTYPE):
 * `LINCREDOC.TRDR` έχει editor CREDITOR (16), `LINDEBDOC.TRDR` έχει DEBTOR (15), και
 * `PURDOC`/`LINSUPDOC` έχουν SUPPLIER (12). Ένας προμηθευτής σε πεδίο πιστωτή ή χρεώστη ΔΕΝ είναι
 * τυπογραφικό — είναι λάθος εγγραφή στο ERP.
 */
export const SODTYPE_FOR_OBJECT: Record<PostObject, number> = {
  PURDOC: 12,
  LINSUPDOC: 12,
  LINCREDOC: 16,
  LINDEBDOC: 15,
};

export const SODTYPE_LABEL_FOR_OBJECT: Record<PostObject, string> = {
  PURDOC: 'προμηθευτής',
  LINSUPDOC: 'προμηθευτής',
  LINCREDOC: 'πιστωτής',
  LINDEBDOC: 'χρεώστης',
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
  /**
   * `false` όταν η ενότητα της σειράς ΔΕΝ αντιστοιχεί σε object που ξέρουμε να γράψουμε.
   * Το `object`/`lines` τότε είναι απλώς placeholder — η καταχώριση μπλοκάρεται.
   */
  supported: boolean;
  /** Ελληνική εξήγηση για το UI («γιατί αυτό»). */
  reason: string;
}

/** Η σειρά όπως τη βλέπει ο resolver — ό,τι κρατά το μητρώο, τίποτα παραπάνω. */
export interface SeriesTargetInput {
  /** SoftOne SOSOURCE (1251 αγορές, 1653 πιστωτές, 1253 λοιπές συναλλαγές προμηθευτών…). */
  sosource: number | null | undefined;
  /** FPRMS / «Τύπος» της σειράς. */
  section?: string | null;
  /** Περιγραφή της σειράς. */
  name?: string | null;
  postObject?: string | null;
  postLines?: string | null;
}

/**
 * Η προεπιλογή ανά ενότητα. Ο κανόνας είναι σκόπιμα ΣΤΕΝΟΣ: η ενότητα ορίζει το object, και ο
 * πίνακας γραμμών είναι ο μόνος που έχει νόημα για αυτό το object.
 *
 *  • 1653 «Παραστατικά πιστωτών»          → LINCREDOC / LINLINES. Εκεί ζουν οι ενεργοποιημένες
 *    σειρές δαπανών του πελάτη και εκεί δείχνει το §14.8 του spec («Ειδικές συναλλαγές →
 *    Δαπάνες Προμηθευτών»).
 *  • 1253 «Λοιπές συναλλαγές προμηθευτών» → LINSUPDOC / LINLINES.
 *  • 1553 «Λοιπές συναλλαγές χρεωστών»    → LINDEBDOC / LINLINES. Η αρίθμηση των ενοτήτων είναι
 *    `1<οντότητα><είδος>` (καταγεγραμμένη στο `SOSOURCE_LABELS` του `lib/softone.ts`, επαληθευμένη
 *    στον πίνακα SERIES του πελάτη): οντότητα 2=προμηθευτές 3=πελάτες 4=τράπεζες 5=ΧΡΕΩΣΤΕΣ
 *    6=πιστωτές, είδος 53=λοιπές (ειδικές) συναλλαγές. Το 1553 είναι ΑΚΡΙΒΩΣ ο ίδιος συνδυασμός
 *    με το 1253, μόνο για χρεώστες — και οι σειρές του το επιβεβαιώνουν μία προς μία («Τιμολόγιο
 *    Δαπανών», «Τιμολόγιο παροχής υπηρεσιών», «Πιστωτικό …», «Χρέωση/Πίστωση Έναρξης»).
 *  • 1251 «Αγορές»                        → PURDOC με πίνακα ΑΝΑ ΓΡΑΜΜΗ (`AUTO`): για γραμμή
 *    αντιστοιχισμένη σε είδος αυτό ΕΙΝΑΙ το ITELINES· απλώς δεν αρνείται μια μεμονωμένη γραμμή
 *    υπηρεσίας ή εξόδου μέσα στο ίδιο τιμολόγιο αγοράς.
 *  • Οποιαδήποτε άλλη ενότητα             → ΔΕΝ υποστηρίζεται (`supported: false`).
 *
 * ΔΕΝ υπάρχει πια κανόνας «σειρά αγορών που μοιάζει με δαπάνη → LINSUPDOC»: το `SERIES` μιας
 * κεφαλίδας ανήκει σε μία ενότητα, οπότε ένας τέτοιος κανόνας θα έστελνε αριθμό σειράς 1251 σε
 * παραστατικό 1253. Αν μια σειρά αγορών πρέπει να καταχωρείται αλλού, αυτό είναι αλλαγή σειράς
 * στο ERP, όχι ρύθμιση εδώ.
 */
export function defaultPostingTarget(input: SeriesTargetInput): PostingTarget {
  const sosource = Number(input.sosource);
  const object = OBJECTS_FOR_SOSOURCE[sosource];
  if (!object) {
    return {
      object: 'PURDOC', lines: 'AUTO', source: 'default', supported: false,
      reason: `Η ενότητα ${Number.isFinite(sosource) ? sosource : '—'} δεν υποστηρίζεται για καταχώριση`,
    };
  }
  if (object === 'PURDOC') {
    return {
      object, lines: 'AUTO', source: 'default', supported: true,
      reason: 'Ενότητα 1251 «Αγορές» → Παραστατικό αγορών, πίνακας ανά γραμμή',
    };
  }
  // Το «γιατί» ανά object: ΔΕΝ είναι δυαδικό. Ένα ternary «LINCREDOC ; αλλιώς 1253» θα έλεγε σε
  // μια σειρά χρεωστών ότι ανήκει στην ενότητα 1253 των προμηθευτών — λάθος αιτιολογία στην κάρτα
  // προεπισκόπησης και στα toasts.
  const REASON: Record<Exclude<PostObject, 'PURDOC'>, string> = {
    LINSUPDOC: 'Ενότητα 1253 «Λοιπές συναλλαγές προμηθευτών» → Ειδικές συναλλαγές προμηθευτών',
    LINCREDOC: 'Ενότητα 1653 «Παραστατικά πιστωτών» → Ειδικές συναλλαγές πιστωτών',
    LINDEBDOC: 'Ενότητα 1553 «Λοιπές συναλλαγές χρεωστών» → Ειδικές συναλλαγές χρεωστών',
  };
  return { object, lines: 'LINLINES', source: 'default', supported: true, reason: REASON[object] };
}

/**
 * Ο τελικός στόχος: το object το ορίζει ΠΑΝΤΑ η ενότητα (μια ρύθμιση που δείχνει αλλού αγνοείται),
 * ενώ ο πίνακας γραμμών είναι η πραγματική ρύθμιση της εγκατάστασης. Ασυνεπής πίνακας πέφτει στην
 * προεπιλογή, ώστε το payload να μένει πάντα χτίσιμο.
 */
export function resolvePostingTarget(input: SeriesTargetInput): PostingTarget {
  const fallback = defaultPostingTarget(input);
  if (!fallback.supported) return fallback;

  const allowed = LINES_FOR_OBJECT[fallback.object];
  const lines = isPostLineTable(input.postLines) && allowed.includes(input.postLines)
    ? input.postLines
    : null;
  // Ρύθμιση object εκτός ενότητας: την αγνοούμε σιωπηλά — δεν υπάρχει έγκυρη περίπτωση.
  const objectOverridden = isPostObject(input.postObject) && input.postObject !== fallback.object;

  if (!lines) {
    return objectOverridden
      ? { ...fallback, reason: `${fallback.reason} (η ρύθμιση «${input.postObject}» δεν ανήκει στην ενότητα και αγνοήθηκε)` }
      : fallback;
  }
  return {
    object: fallback.object,
    lines,
    source: 'configured',
    supported: true,
    reason: `Ρύθμιση σειράς: ${POST_OBJECT_LABEL[fallback.object]} · ${POST_LINES_LABEL[lines]}`,
  };
}

/** «Παραστατικά αγορών (PURDOC) · Είδη» — μία γραμμή για κάρτες και toasts. */
export const describeTarget = (t: PostingTarget): string =>
  `${POST_OBJECT_LABEL[t.object]} · ${POST_LINES_LABEL[t.lines]}`;

/** «Ειδικές συναλλαγές προμηθευτών · γραμμές LINLINES» — η μορφή που ζητήθηκε για την κάρτα. */
export const describeTargetShort = (t: PostingTarget): string =>
  t.supported
    ? `${POST_OBJECT_SHORT[t.object]} · ${t.lines === 'AUTO' ? 'γραμμές ανά είδος αντιστοίχισης' : `γραμμές ${t.lines}`}`
    : 'Χωρίς υποστηριζόμενο προορισμό';

/* ------------------------------------------------------------------ */
/* Πλευρά συναλλασσομένου μιας ενότητας                                */
/* ------------------------------------------------------------------ */

/**
 * Σε ποια ΠΛΕΥΡΑ συναλλασσομένου ανήκει μια σειρά: προμηθευτή («purchase» — αγορές και ειδικές
 * συναλλαγές προμηθευτών), πιστωτή ή χρεώστη. Είναι η ίδια διάκριση με το SODTYPE του TRDR
 * (12 / 16 / 15), απλώς ιδωμένη από τη μεριά της σειράς.
 */
export type SeriesTraderKind = 'purchase' | 'creditor' | 'debtor';

/** Ποιο object «ανήκει» σε ποια πλευρά — ό,τι δεν είναι εδώ είναι πλευρά προμηθευτή. */
const SIDE_BY_OBJECT: Partial<Record<PostObject, SeriesTraderKind>> = {
  LINCREDOC: 'creditor',
  LINDEBDOC: 'debtor',
};

/**
 * Η πλευρά μιας ενότητας (SOSOURCE), από ΤΗΝ ΙΔΙΑ πηγή αλήθειας με την καταχώριση
 * (`OBJECTS_FOR_SOSOURCE`) — όχι από δεύτερη λίστα μαγικών αριθμών: αν η ενότητα καταχωρεί σε
 * «Ειδικές συναλλαγές πιστωτών/χρεωστών», ο συναλλασσόμενός της είναι πιστωτής/χρεώστης.
 *
 * Διαβάζουμε τον χάρτη ΑΠΕΥΘΕΙΑΣ και όχι το `defaultPostingTarget`, γιατί εκείνο επιστρέφει
 * `PURDOC` ως placeholder για ενότητα που δεν υποστηρίζεται: θα ήταν σιωπηρή απάντηση «αγορών»
 * για κάτι άγνωστο. Εδώ η άγνωστη ενότητα πέφτει ρητά στη γενική πλευρά προμηθευτή, που είναι
 * ΜΟΝΟ πρόταση για την ουρά — δεν καταχωρεί τίποτα.
 */
export const seriesTraderKind = (sosource: number): SeriesTraderKind => {
  const object = OBJECTS_FOR_SOSOURCE[Number(sosource)];
  return (object && SIDE_BY_OBJECT[object]) ?? 'purchase';
};

/** Ελληνική ετικέτα πλευράς — για αιτιολογίες και chips («Πιστωτών», «Χρεωστών»). */
export const SERIES_SIDE_LABEL: Record<SeriesTraderKind, string> = {
  purchase: 'Αγορών',
  creditor: 'Πιστωτών',
  debtor: 'Χρεωστών',
};
