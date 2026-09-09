// lib/templates/readiness.ts — the single ACTIVE-readiness predicate (spec §14.1-4).
// PATCH uses it to refuse an activation; the fields/mappings writers use it to demote a
// template that ACTIVE no longer describes. One function so the two can never disagree.

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
