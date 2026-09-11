// lib/templates/readiness.ts — the single ACTIVE-readiness predicate (spec §14.1-4).
// PATCH uses it to refuse an activation; the fields/mappings writers use it to demote a
// template that ACTIVE no longer describes. One function so the two can never disagree.
import { trainingGate, type GateInput } from './training';

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
 * Kept apart from `isReady` on purpose: the fields/mappings writers use `isReady` to DEMOTE a
 * template that no longer describes what ACTIVE claims, and a training score that dipped is not
 * that — it is a measurement, and silently switching a working template off over it would be a
 * surprise nobody asked for. Only an explicit activation is refused here.
 */
export type ActivationCheck = { ok: true } | { ok: false; error: 'not_ready' } | { ok: false; error: 'training_gate'; reason: 'need_samples' | 'low_score' };

export function canActivate(t: ReadinessInput & GateInput): ActivationCheck {
  if (!isReady(t)) return { ok: false, error: 'not_ready' };
  const gate = trainingGate(t);
  return gate.ok ? { ok: true } : { ok: false, error: 'training_gate', reason: gate.reason };
}

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
