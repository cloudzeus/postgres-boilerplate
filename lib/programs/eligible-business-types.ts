import { canonicalLegalForm } from '@/lib/programs/eligibility';
import type { BusinessTypeRef } from '@/lib/companies/business-type';

/**
 * Given a program's scanned eligible legal-form names (free text from
 * ProgramEligibleLegalForm) and the BusinessType catalog, return the set of
 * BusinessType ids that participate in the program. Used to constrain the
 * legal-form options offered when scoping a requirement.
 */
export function eligibleBusinessTypeIds(formNames: string[], catalog: BusinessTypeRef[]): Set<string> {
  const byCode = new Map(catalog.map((b) => [b.code, b.id]));
  const out = new Set<string>();
  for (const name of formNames) {
    const id = byCode.get(canonicalLegalForm(name));
    if (id) out.add(id);
  }
  return out;
}
