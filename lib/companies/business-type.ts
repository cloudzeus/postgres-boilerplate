import { canonicalLegalForm } from '@/lib/programs/eligibility';

export interface BusinessTypeRef { id: string; code: string }

export interface CompanyTypeInput {
  legalForm: string | null;
  legalTypeDescr: string | null;
  businessTypeId: string | null;
  businessTypeOverride: boolean;
}

/**
 * Resolve a company's BusinessType id. Honors a manual override; otherwise
 * canonicalises the company's legal form (free-text, fallback to ΓΕΜΗ descr)
 * and matches it against the BusinessType catalog by `code`.
 */
export function resolveBusinessTypeId(input: CompanyTypeInput, catalog: BusinessTypeRef[]): string | null {
  if (input.businessTypeOverride) return input.businessTypeId;
  const raw = (input.legalForm ?? '').trim() || (input.legalTypeDescr ?? '').trim();
  if (!raw) return null;
  const key = canonicalLegalForm(raw);
  return catalog.find((b) => b.code === key)?.id ?? null;
}
