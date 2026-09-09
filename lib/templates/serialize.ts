// lib/templates/serialize.ts — SERVER. Prisma rows → API/UI shapes (FieldDef etc.) in one place.
import 'server-only';
import type { ExtractionTemplate, TemplateField, TemplateMapping, TemplateCondition } from '@prisma/client';
import type { Action, Clause, ColumnDef, FieldDef, MappingRowExcel, MappingRowInvoice, Region } from './schema';
import { isValidBbox } from './schema';

export function toFieldDef(f: TemplateField): FieldDef {
  const region = f.region as { page?: unknown; bbox?: unknown } | null;
  const ok = region && typeof region.page === 'number' && isValidBbox(region.bbox);
  return {
    key: f.key, label: f.label, kind: f.kind, valueType: f.valueType, color: f.color,
    region: ok ? ({ page: region!.page as number, bbox: region!.bbox } as Region) : null,
    columns: Array.isArray(f.columns) ? (f.columns as unknown as ColumnDef[]) : null,
    aiHint: f.aiHint, required: f.required, order: f.order,
  };
}

export function toMappingDto(m: TemplateMapping) {
  return { id: m.id, name: m.name, target: m.target, isDefault: m.isDefault, rows: (m.rows as unknown as (MappingRowInvoice | MappingRowExcel)[]) ?? [] };
}

export function toConditionDto(c: TemplateCondition) {
  return { id: c.id, name: c.name, order: c.order, isActive: c.isActive, logic: (c.logic === 'OR' ? 'OR' : 'AND') as 'AND' | 'OR', clauses: (c.clauses as unknown as Clause[]) ?? [], actions: (c.actions as unknown as Action[]) ?? [] };
}

export function toTemplateDto(t: ExtractionTemplate & { fields: TemplateField[]; mappings: TemplateMapping[]; conditions: TemplateCondition[]; _count: { runs: number } }) {
  return {
    id: t.id, name: t.name, slug: t.slug, department: t.department, vatNumber: t.vatNumber, traderTrdr: t.traderTrdr,
    supplierName: t.supplierName, runsCount: t._count.runs,
    mode: t.mode, status: t.status, version: t.version,
    sample: t.sampleStorageKey ? { mimeType: t.sampleMimeType, pageCount: t.samplePageCount ?? 1, thumbUrl: t.sampleThumbUrl } : null,
    notifyEmails: t.notifyEmails, timesUsed: t.timesUsed, createdAt: t.createdAt, updatedAt: t.updatedAt,
    fields: [...t.fields].sort((a, b) => a.order - b.order).map(toFieldDef),
    mappings: t.mappings.map(toMappingDto),
    conditions: [...t.conditions].sort((a, b) => a.order - b.order).map(toConditionDto),
  };
}
export type TemplateDto = ReturnType<typeof toTemplateDto>;

export const TEMPLATE_INCLUDE = { fields: true, mappings: true, conditions: true, _count: { select: { runs: true } } } as const;
