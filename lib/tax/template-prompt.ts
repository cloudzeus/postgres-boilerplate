import type { FinancialValueTypeStr } from '@/lib/greek-format';

export type TemplateFieldLite = {
  fieldKey: string;
  label: string;
  aiHint?: string | null;
  regionHint?: unknown;
  valueType: FinancialValueTypeStr;
  kind?: 'SINGLE' | 'SERIES';
};

/** Human-readable description of a region hint, for the vision prompt. */
export function regionHintText(regionHint: unknown): string | null {
  const r = regionHint as { page?: number; bbox?: [number, number, number, number] } | null | undefined;
  if (!r || !Array.isArray(r.bbox)) return null;
  const [x, y, w, h] = r.bbox;
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return `page ${(r.page ?? 0) + 1}, area at left ${pct(x)}, top ${pct(y)}, width ${pct(w)}, height ${pct(h)} (top-left origin)`;
}

export type FieldRuleLite = {
  key: string;
  label: string;
  description: string | null;
  regionHint: unknown;
  scope: 'document';
  valueType: 'text';
};

/** Adapts tax template fields to the existing buildCustomFieldsPrompt() rule shape. */
export function templateFieldsToRules(fields: TemplateFieldLite[]): FieldRuleLite[] {
  return fields.map((f) => ({
    key: f.fieldKey,
    label: f.label,
    description: f.aiHint ?? null,
    regionHint: f.regionHint ?? null,
    scope: 'document' as const,
    valueType: 'text' as const,
  }));
}
