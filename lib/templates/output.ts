// lib/templates/output.ts — ISOMORPHIC. The one JSON shape every extraction produces (spec §14.1-5).
import type { FieldValue } from './schema';

export type OutputJson = { template: string; version: number; extractedAt: string; values: Record<string, FieldValue['value']> };

export function toOutputJson(t: { slug: string; version: number }, values: Record<string, FieldValue>, at: Date = new Date()): OutputJson {
  const out: OutputJson['values'] = {};
  for (const [key, v] of Object.entries(values)) out[key] = v.value;
  return { template: t.slug, version: t.version, extractedAt: at.toISOString(), values: out };
}
