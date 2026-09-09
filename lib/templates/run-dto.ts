// lib/templates/run-dto.ts — SERVER. One TemplateRun row → the shape the document page and the API return.
import 'server-only';
import type { ExtractionTemplate, TemplateCondition, TemplateField, TemplateMapping, TemplateRun } from '@prisma/client';
import { toConditionDto, toFieldDef, toMappingDto } from './serialize';
import type { FieldValue } from './schema';

/** Everything `toRunDto` needs: the run's template with fields, mappings and conditions (the flow diagram uses all three). */
export const RUN_INCLUDE = { template: { include: { fields: true, mappings: true, conditions: true } } } as const;

export type RunWithTemplate = TemplateRun & {
  template: ExtractionTemplate & { fields: TemplateField[]; mappings: TemplateMapping[]; conditions: TemplateCondition[] };
};

export function toRunDto(r: RunWithTemplate) {
  return {
    id: r.id,
    status: r.status,
    trigger: r.trigger,
    error: r.error,
    createdAt: r.createdAt,
    templateVersion: r.templateVersion,
    values: (r.values as unknown as Record<string, FieldValue>) ?? {},
    matched: (r.matched as unknown as { id: string; name: string }[]) ?? [],
    flags: (r.flags as { review?: string[]; blocked?: string[]; notified?: string[] } | null) ?? { review: [], blocked: [] },
    mappingName: r.mappingName,
    model: r.model,
    tokensUsed: r.tokensUsed,
    durationMs: r.durationMs,
    template: {
      id: r.template.id,
      name: r.template.name,
      slug: r.template.slug,
      mode: r.template.mode,
      status: r.template.status,
      version: r.template.version,
      fields: [...r.template.fields].sort((a, b) => a.order - b.order).map(toFieldDef),
      mappings: r.template.mappings.map(toMappingDto),
      conditions: [...r.template.conditions].sort((a, b) => a.order - b.order).map(toConditionDto),
    },
  };
}

export type RunDto = ReturnType<typeof toRunDto>;
