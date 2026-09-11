// lib/templates/training-view.ts — ISOMORPHIC, PURE. Ό,τι αριθμητική κάνει ο πίνακας «δείγμα ×
// πεδίο» πριν ζωγραφίσει (spec §11). Ζει εδώ, όχι μέσα στο component, ώστε να δοκιμάζεται χωρίς DOM
// — και ώστε το «συμφωνούν;» του κελιού να είναι ΤΟ ΙΔΙΟ με αυτό που βαθμολογεί ο server
// (`scoreSamples`): ένα κελί που δείχνει πράσινο και σκοράρει λάθος θα ήταν ψέμα.
import { normalizeForCompare } from './training';
import type { TemplateFieldKind, TemplateValueType } from './schema';

/** Ό,τι χρειάζεται ο πίνακας από ένα πεδίο — ένα `FieldDef` το ικανοποιεί. */
export type TrainingViewField = { key: string; valueType: TemplateValueType; kind: TemplateFieldKind };

/** Τα δύο κατώφλια χρώματος του βαθμού: πράσινο από 90 %, πορτοκαλί από 70 %, αλλιώς κόκκινο. */
export const SCORE_GOOD = 0.9;
export const SCORE_WARN = 0.7;

export type ScoreTone = 'good' | 'warn' | 'bad';

export function scoreTone(score: number): ScoreTone {
  if (score >= SCORE_GOOD) return 'good';
  if (score >= SCORE_WARN) return 'warn';
  return 'bad';
}

/** Inline hex (παλέτα DG): ο JIT του Tailwind καθαρίζει ό,τι χτίζεται δυναμικά. */
export const SCORE_STYLE: Record<ScoreTone, { bg: string; fg: string }> = {
  good: { bg: '#E8F7F0', fg: '#047857' },
  warn: { bg: '#FDF3E3', fg: '#B45309' },
  bad: { bg: '#FDECEA', fg: '#B91C1C' },
};

/** «92 %» — και «—» όταν δεν έχει μετρηθεί τίποτα, γιατί το 0 % θα ήταν ισχυρισμός. */
export function pctText(score: number | null | undefined): string {
  return score == null ? '—' : `${Math.round(score * 100)} %`;
}

const own = (o: unknown, key: string): boolean =>
  !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, key);

/**
 * Η τιμή που διάβασε ΤΟ ΠΡΟΤΥΠΟ για αυτό το κλειδί. `undefined` σημαίνει «δεν κοιτάχτηκε καν»
 * (πεδίο χωρίς περιοχή)· `null` σημαίνει «κοιτάχτηκε και δεν βρέθηκε τίποτα» — δύο διαφορετικά
 * πράγματα, και μόνο το δεύτερο αξίζει να μπει στην επιβεβαίωση.
 */
export function autoValue(lastResult: unknown, key: string): unknown {
  if (!own(lastResult, key)) return undefined;
  const cell = (lastResult as Record<string, unknown>)[key];
  if (cell && typeof cell === 'object' && !Array.isArray(cell) && own(cell, 'value')) {
    return (cell as { value: unknown }).value;
  }
  return cell ?? null;
}

const isScalar = (v: unknown): v is string | number | boolean | null =>
  v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

/**
 * Κόβει μια τιμή στο σχήμα που δέχεται το PATCH των δειγμάτων (σκαλάρια, ή πίνακας από σκαλάρια /
 * επίπεδες γραμμές). Ό,τι δεν χωράει απλώς ΛΕΙΠΕΙ αντί να ρίξει ολόκληρη την επιβεβαίωση με 400:
 * ο χρήστης πάτησε «Επιβεβαίωση», δεν του χρωστάμε μάθημα για το σχήμα του JSON.
 */
export function sanitizeExpected(value: unknown): unknown | undefined {
  if (value === undefined) return undefined;
  if (isScalar(value)) return value;
  if (Array.isArray(value)) {
    const rows: unknown[] = [];
    for (const row of value) {
      if (isScalar(row)) { rows.push(row); continue; }
      if (row && typeof row === 'object' && !Array.isArray(row)) {
        const cells: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(row as Record<string, unknown>)) if (isScalar(v)) cells[k] = v;
        rows.push(cells);
        continue;
      }
      // Μια γραμμή που δεν είναι ούτε σκαλάρι ούτε επίπεδο αντικείμενο κάνει ΟΛΟ τον πίνακα άκυρο:
      // μισός πίνακας ως «αναμενόμενο» θα βαθμολογούσε λάθος για πάντα.
      return undefined;
    }
    return rows;
  }
  return undefined;
}

/**
 * Τι στέλνει το «Επιβεβαίωση» ενός δείγματος: ΚΑΘΕ πεδίο που το πρότυπο κοίταξε, με την τιμή που
 * ισχύει — πρώτα η διόρθωση που πληκτρολογεί τώρα ο χρήστης, μετά ό,τι είχε ήδη επιβεβαιώσει, και
 * τέλος αυτό που διάβασε το πρότυπο. Έτσι μια σωστή ανάγνωση επιβεβαιώνεται με ΕΝΑ κλικ.
 *
 * Πεδίο που ο εξαγωγέας ΔΕΝ κοίταξε (χωρίς περιοχή) μένει απ' έξω: θα έμπαινε ως «κενό == κενό»,
 * δηλαδή ως 100 % για κάτι που δεν δοκιμάστηκε ποτέ.
 */
export function expectedSeed(
  fields: TrainingViewField[],
  sample: { expected: unknown; lastResult: unknown },
  drafts: Record<string, string> = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    let value: unknown;
    if (own(drafts, f.key)) {
      const typed = drafts[f.key];
      // Ένα κελί που ο χρήστης άδειασε είναι δήλωση («εδώ δεν γράφει τίποτα»), όχι απουσία.
      value = typed.trim() === '' ? null : typed;
    } else if (own(sample.expected, f.key)) {
      value = (sample.expected as Record<string, unknown>)[f.key];
    } else {
      value = autoValue(sample.lastResult, f.key);
      if (value === undefined) continue;
    }
    const safe = sanitizeExpected(value);
    if (safe !== undefined) out[f.key] = safe;
  }
  return out;
}

/** Συμφωνεί η τιμή του χρήστη με αυτή του προτύπου; Ίδιος κανόνας με τη βαθμολόγηση του server. */
export function agrees(expected: unknown, auto: unknown, valueType: TemplateValueType): boolean {
  return normalizeForCompare(expected, valueType) === normalizeForCompare(auto, valueType);
}
