import { describe, it, expect } from 'vitest';
import { evaluateClause, evaluateRule, applyRules, type RuleDef, type EvalContext } from '../conditions';
import type { FieldValue } from '../schema';

const fv = (value: FieldValue['value'], color = '#0078D4'): FieldValue =>
  ({ raw: value == null ? null : String(value), value, confidence: null, source: 'vision', page: 0, bbox: null, color });

const values = {
  total: fv(1240),
  kind: fv('Τιμολόγιο Παροχής'),
  serials: fv(['A1', 'B2']),
  empty: fv(null),
};
const types = { total: 'CURRENCY', kind: 'TEXT', serials: 'LIST', empty: 'TEXT' } as const;
const ctx = { values, valueTypes: types, extras: { $total: 1240, $itemsCount: 3, $pageCount: 1 } };

describe('evaluateClause', () => {
  it('compares numbers numerically', () => {
    expect(evaluateClause({ fieldKey: 'total', op: 'gt', value: '1000' }, ctx)).toBe(true);
    expect(evaluateClause({ fieldKey: 'total', op: 'lte', value: '1000' }, ctx)).toBe(false);
    expect(evaluateClause({ fieldKey: 'total', op: 'eq', value: '1.240,00' }, ctx)).toBe(true);
  });
  it('compares text case-insensitively', () => {
    expect(evaluateClause({ fieldKey: 'kind', op: 'contains', value: 'παροχής' }, ctx)).toBe(true);
    expect(evaluateClause({ fieldKey: 'kind', op: 'eq', value: 'τιμολόγιο παροχής' }, ctx)).toBe(true);
    expect(evaluateClause({ fieldKey: 'kind', op: 'notContains', value: 'πιστωτικό' }, ctx)).toBe(true);
  });
  it('supports in / regex', () => {
    expect(evaluateClause({ fieldKey: 'kind', op: 'in', value: 'Απόδειξη; Τιμολόγιο Παροχής' }, ctx)).toBe(true);
    expect(evaluateClause({ fieldKey: 'kind', op: 'regex', value: '^Τιμ' }, ctx)).toBe(true);
    expect(evaluateClause({ fieldKey: 'kind', op: 'regex', value: '[' }, ctx)).toBe(false);
  });
  it('LIST contains checks membership', () => {
    expect(evaluateClause({ fieldKey: 'serials', op: 'contains', value: 'b2' }, ctx)).toBe(true);
  });
  it('empty semantics: missing value → empty true, every other op false', () => {
    expect(evaluateClause({ fieldKey: 'empty', op: 'empty' }, ctx)).toBe(true);
    expect(evaluateClause({ fieldKey: 'empty', op: 'notEmpty' }, ctx)).toBe(false);
    expect(evaluateClause({ fieldKey: 'empty', op: 'eq', value: '' }, ctx)).toBe(false);
    expect(evaluateClause({ fieldKey: 'unknown', op: 'empty' }, ctx)).toBe(true);
  });
  it('DATE ordering coerces both sides', () => {
    const c: EvalContext = { values: { d: fv('05/03/2026') }, valueTypes: { d: 'DATE' } };
    expect(evaluateClause({ fieldKey: 'd', op: 'gt', value: '01/03/2026' }, c)).toBe(true);
    expect(evaluateClause({ fieldKey: 'd', op: 'eq', value: '2026-03-05' }, c)).toBe(true);
  });
  it('numeric eq tolerates float noise', () => {
    const c: EvalContext = { values: { t: fv(0.1 + 0.2) }, valueTypes: { t: 'NUMBER' } };
    expect(evaluateClause({ fieldKey: 't', op: 'eq', value: '0,3' }, c)).toBe(true);
    expect(evaluateClause({ fieldKey: 't', op: 'neq', value: '0,3' }, c)).toBe(false);
  });
  it('TABLE fields: empty/notEmpty and numeric ops on row count', () => {
    const c: EvalContext = { values: { rows: fv([{ a: 1 }, { a: 2 }, { a: 3 }]), none: fv([]) }, valueTypes: { rows: 'TEXT', none: 'TEXT' } };
    expect(evaluateClause({ fieldKey: 'rows', op: 'notEmpty' }, c)).toBe(true);
    expect(evaluateClause({ fieldKey: 'rows', op: 'gte', value: '3' }, c)).toBe(true);
    expect(evaluateClause({ fieldKey: 'none', op: 'empty' }, c)).toBe(true);
  });
  it('$extras use the declared types even when given as strings', () => {
    const c: EvalContext = { values: {}, valueTypes: {}, extras: { $total: '1.240,00' } };
    expect(evaluateClause({ fieldKey: '$total', op: 'gt', value: '1000' }, c)).toBe(true);
  });
  it('reads $ extras', () => {
    expect(evaluateClause({ fieldKey: '$itemsCount', op: 'gte', value: '3' }, ctx)).toBe(true);
  });
});

const rule = (over: Partial<RuleDef>): RuleDef => ({
  id: 'r1', name: 'R', order: 0, isActive: true, logic: 'AND',
  clauses: [{ fieldKey: 'total', op: 'gt', value: '1000' }],
  actions: [{ type: 'FLAG_REVIEW', params: { reason: 'Μεγάλο ποσό' } }],
  ...over,
});

describe('evaluateRule', () => {
  it('AND requires all clauses, OR any', () => {
    const both = [{ fieldKey: 'total', op: 'gt', value: '1000' }, { fieldKey: 'kind', op: 'contains', value: 'πιστωτικό' }] as const;
    expect(evaluateRule(rule({ logic: 'AND', clauses: [...both] }), ctx)).toBe(false);
    expect(evaluateRule(rule({ logic: 'OR', clauses: [...both] }), ctx)).toBe(true);
  });
  it('inactive rules never match; a rule with no clauses never matches', () => {
    expect(evaluateRule(rule({ isActive: false }), ctx)).toBe(false);
    expect(evaluateRule(rule({ clauses: [] }), ctx)).toBe(false);
  });
});

describe('applyRules', () => {
  it('accumulates actions from every matching rule, in order; SWITCH_MAPPING last wins', () => {
    const rules: RuleDef[] = [
      rule({ id: 'a', order: 0, actions: [{ type: 'SWITCH_MAPPING', params: { mappingName: 'credit' } }, { type: 'SET_FIELD', params: { fieldKey: 'kind', value: 'X' } }] }),
      rule({ id: 'b', order: 1, actions: [{ type: 'SWITCH_MAPPING', params: { mappingName: 'special' } }, { type: 'BLOCK_POSTING', params: { reason: 'Έλεγχος' } }, { type: 'NOTIFY', params: { subject: 'Hi' } }] }),
      rule({ id: 'c', order: 2, clauses: [{ fieldKey: 'kind', op: 'contains', value: 'πιστωτικό' }] }),
    ];
    const out = applyRules(rules, ctx);
    expect(out.matched.map((m) => m.id)).toEqual(['a', 'b']);
    expect(out.mappingName).toBe('special');
    expect(out.setFields).toEqual([{ fieldKey: 'kind', value: 'X' }]);
    expect(out.flags).toEqual({ review: [], blocked: ['Έλεγχος'] });
    expect(out.notifications).toEqual([{ conditionId: 'b', subject: 'Hi', emails: undefined }]);
  });
  it('FLAG_REVIEW collects reasons', () => {
    const out = applyRules([rule({})], ctx);
    expect(out.flags).toEqual({ review: ['Μεγάλο ποσό'], blocked: [] });
    expect(out.mappingName).toBeNull();
  });
});
