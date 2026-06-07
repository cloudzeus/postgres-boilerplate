import { evaluateExpression, type Scope } from './expression';
import { lookupBand, clamp, type Band } from './bands';

export type YearMode = 'REFERENCE' | 'PRIOR_1' | 'PRIOR_2' | 'PRIOR_3';
export type VarSource = 'FINANCIAL' | 'MANUAL' | 'PARAM' | 'DERIVED';

/** A criterion input variable and HOW it is sourced — the ② → ① mapping lives here. */
export type CritVariable = {
  key: string;                 // identifier used in formulas, e.g. "ebit"
  label?: string;
  source: VarSource;
  fieldKey?: string | null;    // FINANCIAL: financial-value key, e.g. "E3.526"
  yearMode?: YearMode;         // FINANCIAL: which year relative to the reference year
  constant?: number | null;    // PARAM: a fixed/default value (e.g. budget)
  formula?: string | null;     // DERIVED: expression over earlier variable keys
};

export type BandMode = 'LOOKUP' | 'PASSTHROUGH';

export type Criterion = {
  code: string;                // e.g. "B1"
  label: string;
  weight: number;              // e.g. 20 (percent / relative weight)
  variables: CritVariable[];   // ordered; DERIVED may reference earlier keys
  indexKey?: string | null;    // the variable that feeds the bands
  indexExpression?: string | null; // …or an inline expression for the index
  bandMode: BandMode;
  bands: Band[];               // LOOKUP: index → score; ignored for PASSTHROUGH
};

export type CriterionResult = { code: string; weight: number; index: number | null; score: number; error?: string };

/**
 * Evaluates one criterion. `inputs` holds the already-resolved values for
 * FINANCIAL / MANUAL / PARAM variables (keyed by variable.key). DERIVED variables
 * are computed here in order via the expression engine.
 */
export function evaluateCriterion(c: Criterion, inputs: Record<string, number | null | undefined>): CriterionResult {
  try {
    const scope: Scope = { ...inputs };
    for (const v of c.variables) {
      if (v.source === 'DERIVED') {
        if (!v.formula) throw new Error(`Λείπει formula στη μεταβλητή ${v.key}`);
        scope[v.key] = evaluateExpression(v.formula, scope);
      } else if (scope[v.key] == null && v.source === 'PARAM' && v.constant != null) {
        scope[v.key] = v.constant;
      }
    }

    let index: number;
    if (c.indexExpression && c.indexExpression.trim()) index = evaluateExpression(c.indexExpression, scope);
    else if (c.indexKey) {
      const v = scope[c.indexKey];
      if (v == null || !Number.isFinite(v)) throw new Error(`Λείπει τιμή δείκτη: ${c.indexKey}`);
      index = v;
    } else throw new Error('Δεν ορίστηκε δείκτης (indexKey/indexExpression)');

    const score = c.bandMode === 'PASSTHROUGH' ? clamp(index, 0, 100) : (lookupBand(c.bands, index) ?? 0);
    return { code: c.code, weight: c.weight, index, score };
  } catch (e) {
    return { code: c.code, weight: c.weight, index: null, score: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

export type AssessmentResult = {
  criteria: CriterionResult[];
  total: number;                 // 0–100 weighted score
  passed: boolean;
  verdict: 'ELIGIBLE' | 'NOT_ELIGIBLE';
};

/** Weighted total = Σ(score × weight) / Σ(weight); verdict vs threshold. */
export function computeAssessment(results: CriterionResult[], threshold: number): AssessmentResult {
  const totalWeight = results.reduce((s, r) => s + r.weight, 0);
  const weighted = results.reduce((s, r) => s + r.score * r.weight, 0);
  const total = totalWeight > 0 ? weighted / totalWeight : 0;
  const rounded = Math.round(total * 100) / 100;
  const passed = rounded >= threshold;
  return { criteria: results, total: rounded, passed, verdict: passed ? 'ELIGIBLE' : 'NOT_ELIGIBLE' };
}
