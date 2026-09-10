// lib/templates/run-dto.ts — SERVER. One TemplateRun row → the shape the document page and the API return.
import 'server-only';
import type { ExtractionTemplate, TemplateCondition, TemplateField, TemplateMapping, TemplateRun } from '@prisma/client';
import { toConditionDto, toFieldDef, toMappingDto } from './serialize';
import type { StoredFlags } from './run-flags';
import type { FieldValue } from './schema';

/**
 * Everything `toRunDto` needs: the run's template with fields, mappings and conditions (the flow diagram uses all three).
 * `TemplateMapping` has no `createdAt` column, so mappings are ordered by `id` — a cuid, which is
 * time-prefixed, so this is insertion order in practice and, above all, stable between requests.
 */
export const RUN_INCLUDE = {
  template: { include: { fields: true, mappings: { orderBy: { id: 'asc' } }, conditions: true } },
} as const;

export type RunWithTemplate = TemplateRun & {
  template: ExtractionTemplate & { fields: TemplateField[]; mappings: TemplateMapping[]; conditions: TemplateCondition[] };
};

export function toRunDto(r: RunWithTemplate) {
  // Same shape the recomputation reads the column back as — one definition, so the DTO and the
  // rewrite can never disagree about what a stored `flags` object holds.
  const flags = (r.flags as StoredFlags | null) ?? null;
  return {
    id: r.id,
    status: r.status,
    trigger: r.trigger,
    error: r.error,
    createdAt: r.createdAt,
    templateVersion: r.templateVersion,
    values: (r.values as unknown as Record<string, FieldValue>) ?? {},
    matched: (r.matched as unknown as { id: string; name: string }[]) ?? [],
    // Non-optional: every consumer (badges, the flow panel, the review list, the row borders) can read
    // without a guard — including runs written before `fields`/`baseOcr` existed and FAILED runs that
    // stored none. `baseOcr` is what the base OCR read before this run projected over it. This is a
    // VIEW: the recomputation reads the raw column, where "no snapshot at all" (an older run, which
    // may not be re-checked) still differs from "a snapshot that happened to be empty".
    flags: {
      review: flags?.review ?? [],
      blocked: flags?.blocked ?? [],
      notified: flags?.notified ?? [],
      fields: flags?.fields ?? {},
      baseOcr: flags?.baseOcr ?? {},
    },
    mappingName: r.mappingName,
    model: r.model,
    tokensUsed: r.tokensUsed,
    durationMs: r.durationMs,
    // Shaped to satisfy `FlowTemplateSource` (lib/templates/flow.ts) as-is, so the run view can feed
    // `toFlowTemplate` without a cast.
    template: {
      id: r.template.id,
      name: r.template.name,
      slug: r.template.slug,
      department: r.template.department,
      supplierName: r.template.supplierName,
      mode: r.template.mode,
      status: r.template.status,
      version: r.template.version,
      sample: r.template.samplePageCount ? { pageCount: r.template.samplePageCount } : null,
      fields: [...r.template.fields].sort((a, b) => a.order - b.order).map(toFieldDef),
      mappings: r.template.mappings.map(toMappingDto),
      conditions: [...r.template.conditions].sort((a, b) => a.order - b.order).map(toConditionDto),
    },
  };
}

export type RunDto = ReturnType<typeof toRunDto>;
