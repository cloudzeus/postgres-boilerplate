// lib/templates/conditions.ts — PURE rule evaluation. No I/O.
import type { Action, Clause, FieldValue, TemplateValueType } from './schema';
import { coerceValue } from './coerce';

export type RuleDef = {
  id: string;
  name: string;
  order: number;
  isActive: boolean;
  logic: 'AND' | 'OR';
  clauses: Clause[];
  actions: Action[];
};

export type EvalContext = {
  values: Record<string, FieldValue>;
  valueTypes: Record<string, TemplateValueType>;
  /** $total, $itemsCount, $pageCount … from the base OCR result. */
  extras?: Record<string, number | string | null>;
};

export type ApplyResult = {
  matched: { id: string; name: string; actions: Action[] }[];
  setFields: { fieldKey?: string; invoiceKey?: string; value: string }[];
  flags: { review: string[]; blocked: string[] };
  mappingName: string | null;
  notifications: { conditionId: string; subject: string; emails?: string }[];
};

type Resolved = { value: string | number | string[] | null; type: TemplateValueType };

/** Declared types for the base-OCR extras, so a string-formatted `$total` still compares numerically. */
const EXTRA_TYPES: Record<string, TemplateValueType> = { $total: 'CURRENCY', $itemsCount: 'NUMBER', $pageCount: 'NUMBER' };

function resolve(fieldKey: string, ctx: EvalContext): Resolved {
  if (fieldKey.startsWith('$')) {
    const v = ctx.extras?.[fieldKey];
    const type = EXTRA_TYPES[fieldKey] ?? (typeof v === 'number' ? 'NUMBER' : 'TEXT');
    return { value: v == null ? null : v, type };
  }
  const fv = ctx.values[fieldKey];
  const type = ctx.valueTypes[fieldKey] ?? 'TEXT';
  if (!fv || fv.value == null) return { value: null, type };
  // TABLE rows are not comparable as a whole; collapse to the row count. That count is only
  // meaningful for empty/notEmpty and the numeric ops (e.g. "more than 10 lines") — text ops
  // (contains/in/regex) would match against the digits of the count, which is never useful.
  if (Array.isArray(fv.value) && fv.value.length && typeof fv.value[0] === 'object') {
    return { value: `${fv.value.length}`, type: 'NUMBER' };
  }
  return { value: fv.value as string | number | string[], type };
}

const isEmpty = (v: Resolved['value']) =>
  v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

function asNumber(v: Resolved['value'], type: TemplateValueType): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const c = coerceValue(v, type === 'TEXT' ? 'NUMBER' : type);
    return typeof c === 'number' ? c : null;
  }
  return null;
}

export function evaluateClause(clause: Clause, ctx: EvalContext): boolean {
  const r = resolve(clause.fieldKey, ctx);
  const empty = isEmpty(r.value);
  if (clause.op === 'empty') return empty;
  if (clause.op === 'notEmpty') return !empty;
  if (empty) return false;

  const expected = clause.value ?? '';
  const numeric = r.type === 'NUMBER' || r.type === 'CURRENCY';

  switch (clause.op) {
    case 'eq': case 'neq': case 'gt': case 'gte': case 'lt': case 'lte': {
      if (numeric || r.type === 'DATE') {
        // Both sides go through the same coercion so "05/03/2026" and "2026-03-05" compare equal
        // (ISO strings order lexicographically, which is why dates stay strings here).
        const a = r.type === 'DATE' ? (coerceValue(r.value, 'DATE') as string | null) : asNumber(r.value, r.type);
        const b = r.type === 'DATE' ? (coerceValue(expected, 'DATE') as string | null) : asNumber(expected, r.type);
        // Deliberate: if either side fails to coerce, ALL six ops are false — `neq` included. An
        // unparsable value is "unknown", not "different", so a rule never fires on garbage input.
        if (a == null || b == null) return false;
        if (typeof a === 'number' && typeof b === 'number') {
          // Float noise: 0.1 + 0.2 must still equal a parsed "0,3".
          if (clause.op === 'eq') return Math.abs(a - b) < 1e-9;
          if (clause.op === 'neq') return !(Math.abs(a - b) < 1e-9);
        }
        switch (clause.op) {
          case 'eq': return a === b; case 'neq': return a !== b;
          case 'gt': return a > b; case 'gte': return a >= b;
          case 'lt': return a < b; case 'lte': return a <= b;
        }
      }
      const a = norm(Array.isArray(r.value) ? r.value.join(', ') : r.value);
      const b = norm(expected);
      if (clause.op === 'eq') return a === b;
      if (clause.op === 'neq') return a !== b;
      return false; // ordering ops are meaningless for text
    }
    case 'contains': case 'notContains': {
      const hit = Array.isArray(r.value)
        ? r.value.some((x) => norm(x) === norm(expected))
        : norm(r.value).includes(norm(expected));
      return clause.op === 'contains' ? hit : !hit;
    }
    case 'in': {
      const set = expected.split(/[;,\n]/).map(norm).filter(Boolean);
      const a = Array.isArray(r.value) ? r.value.map(norm) : [norm(r.value)];
      return a.some((x) => set.includes(x));
    }
    case 'regex': {
      try {
        const re = new RegExp(expected, 'iu');
        const a = Array.isArray(r.value) ? r.value.join('\n') : String(r.value);
        return re.test(a);
      } catch { return false; }
    }
    default:
      return false;
  }
}

export function evaluateRule(rule: RuleDef, ctx: EvalContext): boolean {
  if (!rule.isActive || rule.clauses.length === 0) return false;
  const results = rule.clauses.map((c) => evaluateClause(c, ctx));
  return rule.logic === 'OR' ? results.some(Boolean) : results.every(Boolean);
}

/** Evaluates rules in `order`; every matching rule contributes its actions. SWITCH_MAPPING: last wins. */
export function applyRules(rules: RuleDef[], ctx: EvalContext): ApplyResult {
  const out: ApplyResult = { matched: [], setFields: [], flags: { review: [], blocked: [] }, mappingName: null, notifications: [] };
  const ordered = [...rules].sort((a, b) => a.order - b.order);
  for (const rule of ordered) {
    if (!evaluateRule(rule, ctx)) continue;
    out.matched.push({ id: rule.id, name: rule.name, actions: rule.actions });
    for (const a of rule.actions) {
      switch (a.type) {
        case 'SET_FIELD': out.setFields.push({ fieldKey: a.params.fieldKey, invoiceKey: a.params.invoiceKey, value: a.params.value }); break;
        case 'FLAG_REVIEW': out.flags.review.push(a.params.reason); break;
        case 'BLOCK_POSTING': out.flags.blocked.push(a.params.reason); break;
        case 'SWITCH_MAPPING': out.mappingName = a.params.mappingName; break;
        case 'NOTIFY': out.notifications.push({ conditionId: rule.id, subject: a.params.subject, emails: a.params.emails }); break;
      }
    }
  }
  return out;
}
