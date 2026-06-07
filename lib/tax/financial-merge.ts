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

// ── Full company-side (SINGLE / SERIES / TABLE) ──────────────────────────────

export type ReviewedSingle = { fieldKey: string; kind: 'SINGLE'; valueType: FinancialValueTypeStr; raw: string | null; edited: boolean };
export type ReviewedSeries = { fieldKey: string; kind: 'SERIES'; valueType: FinancialValueTypeStr; series: { year: number | null; raw: string | null }[]; edited: boolean };
export type ReviewedTable = { fieldKey: string; kind: 'TABLE'; records: Record<string, string>[]; edited: boolean };
export type ReviewedAny = ReviewedSingle | ReviewedSeries | ReviewedTable;

export type FinancialWriteRow = {
  companyId: string; fieldKey: string; templateId: string; year: number;
  kind: 'SINGLE' | 'SERIES' | 'TABLE'; valueType: FinancialValueTypeStr;
  value: number | null; valueText: string | null; valueJson: Record<string, string>[] | null;
  source: 'OCR' | 'MANUAL';
};

export type BuildWritesInput = {
  companyId: string; templateId: string; templateCode: string; fiscalYear: number; fields: ReviewedAny[];
};

/** Pure: turns reviewed company values (all kinds) into DB write rows keyed `{code}.{fieldKey}`. */
export function buildFinancialWrites(input: BuildWritesInput): FinancialWriteRow[] {
  const rows: FinancialWriteRow[] = [];
  const base = (fieldKey: string, year: number, edited: boolean) => ({
    companyId: input.companyId, fieldKey: `${input.templateCode}.${fieldKey}`, templateId: input.templateId, year,
    source: (edited ? 'MANUAL' : 'OCR') as 'OCR' | 'MANUAL',
  });
  for (const f of input.fields) {
    if (f.kind === 'SINGLE') {
      if (f.valueType === 'DATE') {
        if (!f.raw) continue;
        rows.push({ ...base(f.fieldKey, input.fiscalYear, f.edited), kind: 'SINGLE', valueType: f.valueType, value: null, valueText: String(f.raw), valueJson: null });
      } else {
        const v = coerceFinancialValue(f.raw, f.valueType);
        if (v == null) continue;
        rows.push({ ...base(f.fieldKey, input.fiscalYear, f.edited), kind: 'SINGLE', valueType: f.valueType, value: v, valueText: null, valueJson: null });
      }
    } else if (f.kind === 'SERIES') {
      for (const p of f.series) {
        if (p.year == null) continue;
        const v = coerceFinancialValue(p.raw, f.valueType);
        if (v == null) continue;
        rows.push({ ...base(f.fieldKey, p.year, f.edited), kind: 'SERIES', valueType: f.valueType, value: v, valueText: null, valueJson: null });
      }
    } else {
      const records = (f.records ?? []).filter((r) => Object.values(r).some((v) => String(v ?? '').trim()));
      if (records.length === 0) continue;
      rows.push({ ...base(f.fieldKey, input.fiscalYear, f.edited), kind: 'TABLE', valueType: 'NUMBER', value: null, valueText: null, valueJson: records });
    }
  }
  return rows;
}

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
