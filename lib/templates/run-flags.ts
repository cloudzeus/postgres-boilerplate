// lib/templates/run-flags.ts — PURE. Rebuilds the flags of a run whose values a human just changed:
// a manual correction (`PATCH /template-runs/[runId]`, spec §15.5) or a per-field re-read (spec §16).
// No I/O — the caller hands in everything and persists the result.
//
// Two of the runner's verdicts are OWNED by this recomputation, because both are functions of the
// values alone and so go stale the moment a value changes: «Λείπει υποχρεωτικό πεδίο …» and
// «Ασυμφωνία …». Everything else on the run — a rule's FLAG_REVIEW/BLOCK_POSTING prose, a read
// error, the ids already notified — is left exactly as the run recorded it: a correction of one
// field says nothing about a verdict nobody re-examined.
import { crossCheckKeys, crossCheckOcr, requiredMissing, type FieldFlag } from './run-logic';
import type { FieldDef, FieldValue, TemplateMode } from './schema';

/** Prefix of the review/blocked entry the runner writes for an empty required field. */
export const MISSING_PREFIX = 'Λείπει υποχρεωτικό πεδίο «';
/** Prefix of the review entry the runner writes when the template and the base OCR disagree. */
export const MISMATCH_PREFIX = 'Ασυμφωνία «';

/** `TemplateRun.flags` as it comes out of the database — every list optional, older runs have none. */
export type StoredFlags = { review?: string[]; blocked?: string[]; notified?: string[]; fields?: Record<string, FieldFlag> };
export type RecomputedFlags = StoredFlags & { review: string[]; blocked: string[]; fields: Record<string, FieldFlag> };

export function recomputeFieldFlags(input: {
  flags: StoredFlags | null;
  fields: FieldDef[];
  values: Record<string, FieldValue>;
  extracted: Record<string, unknown>;
  mode: TemplateMode;
  /** Rows of the INVOICE mapping this run projects through; omitted/empty when it projects nothing. */
  rows?: { fieldKey: string; invoiceKey: string }[];
}): RecomputedFlags {
  const { fields, values, extracted, mode } = input;
  const prev = input.flags ?? {};
  const rows = input.rows ?? [];
  // Only a run WITH a projection can produce a cross-check reason, so only such a run may drop one:
  // recomputing a MANUAL run against no rows would silently erase a verdict nobody re-examined.
  const checking = rows.length > 0;

  const labelOf = (key: string) => fields.find((f) => f.key === key)?.label ?? key;
  const missing = requiredMissing(fields, values);
  const missingLabels = missing.map((f) => `${MISSING_PREFIX}${f.label}»`);
  const mismatches = checking ? crossCheckOcr(rows, values, extracted, labelOf) : [];

  const stale = (s: string) => s.startsWith(MISSING_PREFIX) || (checking && s.startsWith(MISMATCH_PREFIX));
  const keep = (list: string[] | undefined) => (list ?? []).filter((s) => !stale(s));

  const review = [...new Set([...keep(prev.review), ...missingLabels, ...mismatches.map((m) => m.reason)])];
  // Same rule as the runner: only AUTO lets a missing required field block the posting, and a
  // disagreement with the OCR never blocks — it only asks for eyes.
  const blocked = [...new Set([...keep(prev.blocked), ...(mode === 'AUTO' ? missingLabels : [])])];

  // The per-field verdict is rebuilt for exactly the keys those two rules can speak about; a verdict
  // on any other key stands.
  const owned = new Set<string>([...fields.filter((f) => f.required).map((f) => f.key), ...(checking ? crossCheckKeys(rows) : [])]);
  const fieldFlags: Record<string, FieldFlag> = {};
  for (const [key, flag] of Object.entries(prev.fields ?? {})) if (!owned.has(key)) fieldFlags[key] = flag;
  for (const f of missing) fieldFlags[f.key] = mode === 'AUTO' ? 'blocked' : 'review';
  for (const m of mismatches) if (!fieldFlags[m.fieldKey]) fieldFlags[m.fieldKey] = 'review';

  return { ...prev, review, blocked, fields: fieldFlags };
}
