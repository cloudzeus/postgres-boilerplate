// lib/templates/training.ts — PURE. Scores a template against the samples a human confirmed (spec §11).
//
// «Βεβαιότητα» is a measured thing here, not a feeling: for every VERIFIED sample the reader's own
// answer is compared with what the user said the value is, and the fraction that agree is the score
// of that field. A template only becomes ACTIVE once enough samples agree often enough
// (`trainingGate`) — the whole point of the training tab is that nobody activates a template that
// reads three fields out of five.
import { normalizeDate, parseNumber } from '@/lib/ocr/canonical';
import type { TemplateValueType } from './schema';

/** What the scorer needs to know about a field — a `FieldDef` satisfies it. */
export type TrainingField = { key: string; valueType: TemplateValueType; required: boolean };
/** What it needs from a `TemplateSample` row. */
export type TrainingSample = { status: string; expected: unknown; lastResult: unknown };

export type FieldScore = { ok: number; total: number; score: number };
export type TrainingScores = { perField: Record<string, FieldScore>; overall: number; verified: number };

/**
 * Fold text the way a human comparing two printed values would: case, accents, punctuation and
 * spacing are not disagreements. (Deliberately NOT `normalizeLineText`, which also throws away
 * numeric tokens — «ΤΙΜ-451» and «ΤΙΜ-452» must not compare equal.)
 */
function foldText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * One comparable string per value, by the field's type — `null` means «nothing there», which is
 * itself comparable: a field the user left blank matches a field the reader left blank.
 */
export function normalizeForCompare(value: unknown, valueType: TemplateValueType): string | null {
  if (value == null) return null;
  if (Array.isArray(value)) {
    const cells = value.map((row) => {
      if (row && typeof row === 'object' && !Array.isArray(row)) {
        const o = row as Record<string, unknown>;
        return Object.keys(o).sort().map((k) => `${k}=${normalizeForCompare(o[k], 'TEXT') ?? ''}`).join('|');
      }
      return normalizeForCompare(row, 'TEXT') ?? '';
    });
    return cells.length ? JSON.stringify(cells) : null;
  }
  if (valueType === 'NUMBER' || valueType === 'CURRENCY') {
    const n = parseNumber(value);
    return n == null ? null : String(r2(n));
  }
  if (valueType === 'DATE') {
    const d = normalizeDate(value);
    return d ? String(d) : null;
  }
  const t = foldText(String(value));
  return t === '' ? null : t;
}

/** The value the reader produced for `key`, out of a `lastResult` row (FieldValue-shaped or bare). */
function readValue(lastResult: unknown, key: string): unknown {
  if (!lastResult || typeof lastResult !== 'object') return null;
  const cell = (lastResult as Record<string, unknown>)[key];
  if (cell && typeof cell === 'object' && !Array.isArray(cell) && 'value' in (cell as object)) {
    return (cell as { value: unknown }).value;
  }
  return cell ?? null;
}

/**
 * «Το δείγμα δηλώνει τιμή για αυτό το κλειδί;» — με `hasOwnProperty`, όχι με `in`: ένα πεδίο με
 * κλειδί `constructor`/`toString` θα μετρούσε ΠΑΝΤΑ ως δηλωμένο (κληρονομείται από το prototype) και
 * θα σκόραρε πάντα λάθος, βυθίζοντας τον βαθμό του προτύπου χωρίς να φταίει τίποτα.
 */
const declares = (expected: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(expected, key);

const expectedOf = (s: TrainingSample): Record<string, unknown> | null =>
  s.expected && typeof s.expected === 'object' && !Array.isArray(s.expected) ? (s.expected as Record<string, unknown>) : null;

/**
 * How much of what the user confirmed on ONE sample the reader got right — `null` when the sample
 * confirms nothing, so «not scored yet» never masquerades as zero.
 */
export function sampleScore(fields: TrainingField[], sample: TrainingSample): number | null {
  const expected = expectedOf(sample);
  if (!expected) return null;
  let ok = 0;
  let total = 0;
  for (const f of fields) {
    if (!declares(expected, f.key)) continue;
    total += 1;
    if (normalizeForCompare(expected[f.key], f.valueType) === normalizeForCompare(readValue(sample.lastResult, f.key), f.valueType)) ok += 1;
  }
  return total === 0 ? null : ok / total;
}

/**
 * Per-field and overall agreement over the VERIFIED samples. A sample that was merely READ carries
 * no human verdict, so it says nothing about whether the template is right.
 *
 * A field nobody ever confirmed scores 0, not 1: it is unproven, and a gate that let an unproven
 * field through would be a gate that lets everything through.
 */
export function scoreSamples(fields: TrainingField[], samples: TrainingSample[]): TrainingScores {
  const verifiedSamples = samples.filter((s) => s.status === 'VERIFIED');
  const perField: Record<string, FieldScore> = {};
  for (const f of fields) {
    let ok = 0;
    let total = 0;
    for (const s of verifiedSamples) {
      const expected = expectedOf(s);
      if (!expected || !declares(expected, f.key)) continue;
      total += 1;
      if (normalizeForCompare(expected[f.key], f.valueType) === normalizeForCompare(readValue(s.lastResult, f.key), f.valueType)) ok += 1;
    }
    perField[f.key] = { ok, total, score: total === 0 ? 0 : ok / total };
  }
  const required = fields.filter((f) => f.required);
  const considered = required.length ? required : fields;
  const overall = considered.length
    ? considered.reduce((sum, f) => sum + perField[f.key].score, 0) / considered.length
    : 0;
  return { perField, overall, verified: verifiedSamples.length };
}

export type GateInput = {
  minTrainingScore: number;
  minTrainingSamples: number;
  trainingScore: number | null;
  verifiedSamples: number;
};
export type GateResult = { ok: true } | { ok: false; reason: 'need_samples' | 'low_score' };

/**
 * May this template be activated? `minTrainingSamples = 0` switches the whole gate off — the
 * templates that existed before training did stay activatable without anyone re-confirming them.
 */
export function trainingGate(t: GateInput): GateResult {
  if (t.minTrainingSamples <= 0) return { ok: true };
  if (t.verifiedSamples < t.minTrainingSamples) return { ok: false, reason: 'need_samples' };
  if ((t.trainingScore ?? 0) < t.minTrainingScore) return { ok: false, reason: 'low_score' };
  return { ok: true };
}
