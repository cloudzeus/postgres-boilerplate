import { coerceFinancialValue, type FinancialValueTypeStr } from '@/lib/greek-format';

export type ReviewedField = { raw: unknown; edited: boolean };

export type BuildUpsertsInput = {
  companyId: string;
  templateId: string;
  templateCode: string;
  year: number;
  sourceDocumentId: string | null;
  fields: { fieldKey: string; valueType: FinancialValueTypeStr }[];
  reviewed: Record<string, ReviewedField>;
};

export type FinancialUpsertRow = {
  companyId: string;
  fieldKey: string;
  templateId: string;
  year: number;
  value: number;
  valueType: FinancialValueTypeStr;
  source: 'OCR' | 'MANUAL';
  sourceDocumentId: string | null;
  verified: boolean;
};

/** Pure: turns reviewed field values into upsert rows keyed `{code}.{fieldKey}`. */
export function buildFinancialUpserts(input: BuildUpsertsInput): FinancialUpsertRow[] {
  const rows: FinancialUpsertRow[] = [];
  for (const f of input.fields) {
    const r = input.reviewed[f.fieldKey];
    if (!r) continue;
    const value = coerceFinancialValue(r.raw, f.valueType);
    if (value == null) continue;
    rows.push({
      companyId: input.companyId,
      fieldKey: `${input.templateCode}.${f.fieldKey}`,
      templateId: input.templateId,
      year: input.year,
      value,
      valueType: f.valueType,
      source: r.edited ? 'MANUAL' : 'OCR',
      sourceDocumentId: input.sourceDocumentId,
      verified: true,
    });
  }
  return rows;
}
