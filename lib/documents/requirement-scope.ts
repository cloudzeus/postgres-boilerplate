export interface ScopedRequirement {
  id: string;
  appliesToAll: boolean;
  businessTypeIds: string[];
}

/** A requirement is requested for a company iff it applies to all forms, or the
 *  company's resolved business type is explicitly listed. Empty list + not-all
 *  means it is requested from nobody. */
export function requirementApplies<T extends ScopedRequirement>(req: T, companyBusinessTypeId: string | null): boolean {
  if (req.appliesToAll) return true;
  if (!companyBusinessTypeId) return false;
  return req.businessTypeIds.includes(companyBusinessTypeId);
}

export function filterRequirements<T extends ScopedRequirement>(reqs: T[], companyBusinessTypeId: string | null): T[] {
  return reqs.filter((r) => requirementApplies(r, companyBusinessTypeId));
}
