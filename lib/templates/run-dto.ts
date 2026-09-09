// lib/templates/run-dto.ts — SERVER. One TemplateRun row → the shape the document page and the API return.
import 'server-only';
import type { ExtractionTemplate, TemplateCondition, TemplateField, TemplateMapping, TemplateRun } from '@prisma/client';
import { toConditionDto, toFieldDef, toMappingDto } from './serialize';
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
  const flags = (r.flags as { review?: string[]; blocked?: string[]; notified?: string[] } | null) ?? null;
  return {
    id: r.id,
    status: r.status,
    trigger: r.trigger,
    error: r.error,
    createdAt: r.createdAt,
    templateVersion: r.templateVersion,
    values: (r.values as unknown as Record<string, FieldValue>) ?? {},
    matched: (r.matched as unknown as { id: string; name: string }[]) ?? [],
    // Non-optional arrays: every consumer (badges, the flow panel, the review list) can map without a guard.
    flags: { review: [] as string[], blocked: [] as string[], notified: [] as string[], ...(flags ?? {}) },
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
