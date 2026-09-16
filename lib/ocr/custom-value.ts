/**
 * Παρουσίαση των ΕΙΔΙΚΩΝ ΠΕΔΙΩΝ (`customFields` / canonical `custom`) σε κείμενο.
 *
 * Η εξαγωγή γράφει εκεί ό,τι ζήτησε το πρότυπο, και αυτό ΔΕΝ είναι πάντα σκαλάρ: μια
 * «Ενδείξεις μετρητή» είναι λίστα εγγραφών, μια «Περίοδος αυτομέτρησης» έχει από/έως. Τα
 * τρία σημεία που τα δείχνουν (σελίδα παραστατικού, καρτέλα γραμμής της λίστας, modal
 * αποτελέσματος) τα περνούσαν από template interpolation, οπότε ο χρήστης έβλεπε
 * `[object Object]` — μια οθόνη που δεν λέει τίποτα και δείχνει χαλασμένη.
 *
 * Καθαρή λογική, χωρίς React: μία συνάρτηση, τρία UI.
 */

/** `poso_pliromis` → «Poso Pliromis». Η ίδια ανθρωποποίηση κλειδιού και στα τρία σημεία. */
export function humanizeKey(k: string): string {
  return String(k ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Πόσα επίπεδα ένθεσης δείχνουμε inline πριν πέσουμε στο πραγματικό JSON. */
const MAX_INLINE_DEPTH = 2;
/** Πάνω από τόσους χαρακτήρες το inline κείμενο παύει να διαβάζεται. */
const MAX_INLINE_CHARS = 300;

/**
 * Τι να δείξει το UI για μια τιμή ειδικού πεδίου:
 *  • `empty` — κενό/άγνωστο, δείχνεται ως «—».
 *  • `text`  — μία σειρά που διαβάζεται (σκαλάρ, λίστα, ή ρηχό αντικείμενο).
 *  • `json`  — πολύ βαθύ/μεγάλο: σύντομη περίληψη + ΠΡΑΓΜΑΤΙΚΟ JSON σε πτυσσόμενο.
 */
export type CustomValueView =
  | { kind: 'empty' }
  | { kind: 'text'; text: string }
  | { kind: 'json'; text: string; json: string };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Βάθος ένθεσης: 0 για σκαλάρ, 1 για λίστα/αντικείμενο σκαλάρ, κ.ο.κ. */
function depthOf(v: unknown, seen: Set<object> = new Set()): number {
  if (Array.isArray(v) || isObj(v)) {
    if (seen.has(v as object)) return Infinity;   // κυκλικό: ποτέ inline
    const next = new Set(seen).add(v as object);
    const children = Array.isArray(v) ? v : Object.values(v);
    let max = 0;
    for (const c of children) max = Math.max(max, depthOf(c, next));
    return 1 + max;
  }
  return 0;
}

/** Ένα σκαλάρ σε κείμενο. `null`/`undefined`/`''` → κενό string. */
function scalarText(v: unknown): string {
  if (v == null || v === '') return '';
  if (typeof v === 'boolean') return v ? 'Ναι' : 'Όχι';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  return String(v);
}

/** Αναδρομική μετατροπή σε μία αναγνώσιμη σειρά — ποτέ `[object Object]`. */
function inlineText(v: unknown): string {
  if (Array.isArray(v)) {
    // Λίστα σκαλάρ → «α, β, γ»· λίστα εγγραφών → οι εγγραφές χωρισμένες με «·».
    const parts = v.map(inlineText).filter((s) => s !== '');
    if (parts.length === 0) return '';
    const nested = v.some((x) => Array.isArray(x) || isObj(x));
    return parts.join(nested ? ' · ' : ', ');
  }
  if (isObj(v)) {
    const parts = Object.entries(v)
      .map(([k, val]) => ({ k, text: inlineText(val) }))
      .filter((e) => e.text !== '')
      .map((e) => `${humanizeKey(e.k)}: ${e.text}`);
    return parts.join(', ');
  }
  return scalarText(v);
}

/**
 * Η τιμή ενός ειδικού πεδίου, έτοιμη για οθόνη. ΠΟΤΕ δεν επιστρέφει `[object Object]`:
 * σκαλάρ όπως είναι, λίστα ως λίστα, αντικείμενο ως ζεύγη κλειδί/τιμή, και μόνο για τα
 * πραγματικά βαθιά πέφτουμε σε πτυσσόμενο με το αληθινό JSON.
 */
export function formatCustomValue(v: unknown): CustomValueView {
  if (v == null || v === '') return { kind: 'empty' };
  if (Array.isArray(v) && v.length === 0) return { kind: 'empty' };
  if (isObj(v) && Object.keys(v).length === 0) return { kind: 'empty' };

  // Το βάθος ΠΡΩΤΑ: μια κυκλική δομή δίνει `Infinity` και δεν φτάνει ποτέ στο
  // `inlineText`, που θα έτρωγε τη στοίβα.
  if (depthOf(v) <= MAX_INLINE_DEPTH) {
    const text = inlineText(v);
    if (text === '') return { kind: 'empty' };
    if (text.length <= MAX_INLINE_CHARS) return { kind: 'text', text };
  }

  // Περίληψη που λέει ΤΙ είναι, και από κάτω το πραγματικό περιεχόμενο.
  const summary = Array.isArray(v)
    ? `${v.length} ${v.length === 1 ? 'εγγραφή' : 'εγγραφές'}`
    : `${Object.keys(v as Record<string, unknown>).length} πεδία`;
  let json: string;
  try {
    json = JSON.stringify(v, null, 2) ?? summary;
  } catch {
    json = summary;   // κυκλική δομή: δεν σειριοποιείται
  }
  return { kind: 'json', text: summary, json };
}

/** Μία εγγραφή ειδικού πεδίου έτοιμη για οθόνη. */
export interface CustomFieldEntry {
  key: string;
  label: string;
  value: CustomValueView;
}

/**
 * Όλα τα ειδικά πεδία ενός εγγράφου/γραμμής, ανθρωποποιημένα. Με `skipEmpty` (η ανά
 * γραμμή περίληψη) τα κενά πετιούνται· χωρίς αυτό (ο πίνακας «Ειδικά πεδία») μένουν και
 * δείχνονται ως «—», γιατί εκεί το «ζητήθηκε αλλά δεν βρέθηκε» είναι πληροφορία.
 */
export function formatCustomFields(
  cf: Record<string, unknown> | null | undefined,
  opts: { skipEmpty?: boolean } = {},
): CustomFieldEntry[] {
  if (!cf || typeof cf !== 'object') return [];
  const out = Object.entries(cf).map(([key, v]) => ({
    key,
    label: humanizeKey(key),
    value: formatCustomValue(v),
  }));
  return opts.skipEmpty ? out.filter((e) => e.value.kind !== 'empty') : out;
}

/**
 * Η ίδια τιμή ως ΣΚΕΤΟ string, για σημεία που δεν έχουν πτυσσόμενο (π.χ. το modal
 * αποτελέσματος, που τυπώνει μία γραμμή ανά πεδίο). Κενό → `''`· βαθιά δομή → το
 * πραγματικό JSON. Ποτέ `[object Object]`.
 */
export function customValueText(v: unknown): string {
  const view = formatCustomValue(v);
  if (view.kind === 'empty') return '';
  if (view.kind === 'text') return view.text;
  return view.json;
}
