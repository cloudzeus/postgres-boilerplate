import { resolveYear, type FinancialYearModeStr } from '@/lib/tax/year-resolve';
import type { Criterion } from './score';

/** Stored company financials, indexed by fieldKey then year. e.g. financials["E3.526"][2024] = 27604.25 */
export type FinancialsMap = Record<string, Record<number, number>>;

/**
 * Resolves a criterion's FINANCIAL/PARAM/MANUAL variables into numeric inputs.
 * DERIVED variables are left out — evaluateCriterion computes them from these.
 */
export function resolveCriterionInputs(
  c: Criterion,
  financials: FinancialsMap,
  referenceYear: number,
  manual: Record<string, number | null | undefined> = {},
): Record<string, number | null> {
  const inputs: Record<string, number | null> = {};
  for (const v of c.variables) {
    if (v.source === 'FINANCIAL') {
      if (!v.fieldKey) { inputs[v.key] = null; continue; }
      const year = resolveYear(referenceYear, (v.yearMode ?? 'REFERENCE') as FinancialYearModeStr);
      const byYear = financials[v.fieldKey];
      inputs[v.key] = byYear && byYear[year] != null ? byYear[year] : null;
    } else if (v.source === 'PARAM') {
      inputs[v.key] = v.constant ?? null;
    } else if (v.source === 'MANUAL') {
      const m = manual[v.key];
      inputs[v.key] = m == null ? null : m;
    }
    // DERIVED: computed downstream
  }
  return inputs;
}

/** Which financial fieldKeys a set of criteria need (for fetching). */
export function neededFieldKeys(criteria: Criterion[]): string[] {
  const keys = new Set<string>();
  for (const c of criteria) for (const v of c.variables) if (v.source === 'FINANCIAL' && v.fieldKey) keys.add(v.fieldKey);
  return [...keys];
}
