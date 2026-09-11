// lib/templates/readiness.ts — the single ACTIVE-readiness predicate (spec §14.1-4).
// PATCH uses it to refuse an activation; the fields/mappings writers use it to demote a
// template that ACTIVE no longer describes. One function so the two can never disagree.
import type { GateInput } from './training';

/** The shape both callers already have loaded — a template row plus its fields and mappings. */
export type ReadinessInput = {
  mode: string;
  sampleStorageKey: string | null;
  fields: { region: unknown }[];
  mappings: unknown[];
};

/**
 * A template may be ACTIVE when it has a sample, at least one field with a region, and —
 * unless it is MANUAL (JSON only, nothing posted to SoftOne) — at least one mapping.
 */
export function isReady(t: ReadinessInput): boolean {
  if (!t.sampleStorageKey) return false;
  if (!t.fields.some((f) => f.region != null)) return false;
  return t.mode === 'MANUAL' || t.mappings.length > 0;
}

/**
 * The SECOND half of «may this be activated»: the template must also have been trained (spec §11) —
 * enough samples a human confirmed, agreeing often enough with what the template read.
 *
 * Kept apart from `isReady` on purpose, and asked by the PATCH route ONLY on a real DRAFT → ACTIVE
 * transition: the fields/mappings writers use `isReady` to DEMOTE a template that no longer describes
 * what ACTIVE claims, and a training score that dipped is not that — it is a measurement. Refusing an
 * edit of an already-ACTIVE template over it (every existing row starts at 0 confirmed samples) would
 * lock up templates that work. Only an explicit activation pays the threshold.
 */
export type ActivationCheck = { ok: true } | { ok: false; error: 'not_ready' } | { ok: false; error: 'training_gate'; reason: 'need_samples' | 'low_score' };

/** Greek explanation of a refused activation, for the API message and the designer's banner. */
export function activationMessage(c: Exclude<ActivationCheck, { ok: true }>, t: GateInput): string {
  if (c.error === 'not_ready') {
    return 'Για ενεργοποίηση χρειάζονται δείγμα και ένα πεδίο με περιοχή — και mapping για ημιαυτόματη/αυτόματη λειτουργία';
  }
  const pct = Math.round(t.minTrainingScore * 100);
  return c.reason === 'need_samples'
    ? `Χρειάζονται τουλάχιστον ${t.minTrainingSamples} επιβεβαιωμένα δείγματα εκπαίδευσης (υπάρχουν ${t.verifiedSamples})`
    : `Ο βαθμός εκπαίδευσης είναι ${Math.round((t.trainingScore ?? 0) * 100)} % — χρειάζεται τουλάχιστον ${pct} %`;
}
