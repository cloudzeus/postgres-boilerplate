// lib/templates/output.ts — ISOMORPHIC. The one JSON shape every extraction produces (spec §14.1-5).
import { INVOICE_SCHEMA, type FieldValue } from './schema';

export type OutputJson = { template: string; version: number; extractedAt: string; values: Record<string, FieldValue['value']> };

export function toOutputJson(template: { slug: string; version: number }, values: Record<string, FieldValue>, at: Date = new Date()): OutputJson {
  const out: OutputJson['values'] = {};
  for (const [key, v] of Object.entries(values)) out[key] = v.value;
  return { template: template.slug, version: template.version, extractedAt: at.toISOString(), values: out };
}

export type RunOutputJson = OutputJson & { file: string; documentId: string };

/**
 * JSON for one run: classic invoice keys present in the base OCR result, then the template's values
 * (template wins). Spec §14.8.
 *
 * The two halves treat null differently on purpose: a classic key that is null/empty is OMITTED (the
 * base OCR simply did not read it), while a template value that is null is KEPT — the template
 * declares that field, so «read and empty» is itself the answer. Classic values that are plain
 * objects are skipped: only scalars, arrays and `null` fit `FieldValue['value']`.
 */
export function toRunOutput(input: { slug: string; version: number; file: string; documentId: string; createdAt: Date; extractedData: Record<string, unknown> | null; values: Record<string, FieldValue> }): RunOutputJson {
  const values: OutputJson['values'] = {};
  const data = input.extractedData ?? {};
  for (const k of INVOICE_SCHEMA) {
    if (k.isLine) continue;
    const v = data[k.key];
    if (v == null || v === '') continue;
    if (typeof v === 'object' && !Array.isArray(v)) continue;
    values[k.key] = v as FieldValue['value'];
  }
  for (const [key, v] of Object.entries(input.values)) values[key] = v.value;
  return { template: input.slug, version: input.version, extractedAt: input.createdAt.toISOString(), file: input.file, documentId: input.documentId, values };
}
