import type { FinancialValueTypeStr } from '@/lib/greek-format';

export type TemplateFieldLite = {
  fieldKey: string;
  label: string;
  aiHint?: string | null;
  regionHint?: unknown;
  valueType: FinancialValueTypeStr;
};

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
