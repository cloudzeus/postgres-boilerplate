import { describe, it, expect } from 'vitest';
import {
  agrees, autoValue, expectedSeed, pctText, sanitizeExpected, scoreTone, SCORE_STYLE,
  type TrainingViewField,
} from '../training-view';

const f = (key: string, over: Partial<TrainingViewField> = {}): TrainingViewField =>
  ({ key, valueType: 'TEXT', kind: 'SINGLE', ...over });

/** `lastResult` as `readSample` stores it — a FieldValue-shaped record per key. */
const read = (v: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(v).map(([k, value]) => [k, { raw: value == null ? null : String(value), value }]));

describe('scoreTone', () => {
  it('is green at 90 %, amber at 70 %, red below', () => {
    expect(scoreTone(1)).toBe('good');
    expect(scoreTone(0.9)).toBe('good');
    expect(scoreTone(0.89)).toBe('warn');
    expect(scoreTone(0.7)).toBe('warn');
    expect(scoreTone(0.69)).toBe('bad');
    expect(scoreTone(0)).toBe('bad');
  });
  it('has a colour pair for every tone', () => {
    for (const t of ['good', 'warn', 'bad'] as const) {
      expect(SCORE_STYLE[t].bg).toMatch(/^#[0-9A-F]{6}$/i);
      expect(SCORE_STYLE[t].fg).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });
});

describe('pctText', () => {
  it('rounds to whole percent', () => {
    expect(pctText(0.925)).toBe('93 %');
    expect(pctText(1)).toBe('100 %');
    expect(pctText(0)).toBe('0 %');
  });
  it('says nothing when nothing has been measured', () => {
    expect(pctText(null)).toBe('—');
  });
});

describe('autoValue', () => {
  it('unwraps a FieldValue', () => {
    expect(autoValue(read({ a: '451' }), 'a')).toBe('451');
  });
  it('accepts a bare value too (older rows)', () => {
    expect(autoValue({ a: 12 }, 'a')).toBe(12);
  });
  it('is undefined when the reader never touched the key', () => {
    expect(autoValue(read({ a: '1' }), 'b')).toBeUndefined();
    expect(autoValue(null, 'a')).toBeUndefined();
  });
  it('is null — not undefined — when the reader looked and found nothing', () => {
    expect(autoValue(read({ a: null }), 'a')).toBeNull();
  });
  it('never reads through the prototype', () => {
    expect(autoValue({}, 'toString')).toBeUndefined();
  });
});

describe('sanitizeExpected', () => {
  it('keeps scalars and null', () => {
    expect(sanitizeExpected('451')).toBe('451');
    expect(sanitizeExpected(12.5)).toBe(12.5);
    expect(sanitizeExpected(null)).toBeNull();
  });
  it('keeps table rows of flat scalar cells', () => {
    expect(sanitizeExpected([{ code: 'A1', qty: 2 }])).toEqual([{ code: 'A1', qty: 2 }]);
    expect(sanitizeExpected(['α', 'β'])).toEqual(['α', 'β']);
  });
  it('drops cells the API would refuse instead of failing the whole confirmation', () => {
    expect(sanitizeExpected([{ code: 'A1', nested: { x: 1 } }])).toEqual([{ code: 'A1' }]);
    expect(sanitizeExpected([[1, 2]])).toBeUndefined();
  });
  it('is undefined for a value that cannot travel at all', () => {
    expect(sanitizeExpected(undefined)).toBeUndefined();
    expect(sanitizeExpected({ a: 1 })).toBeUndefined();
  });
});

describe('expectedSeed', () => {
  const fields = [f('num'), f('total', { valueType: 'CURRENCY' }), f('lines', { kind: 'TABLE', valueType: 'LIST' })];

  it('prefills every field the reader actually read, so a correct read is one click', () => {
    const s = { expected: null, lastResult: read({ num: '451', total: 1240, lines: [{ code: 'A1' }] }) };
    expect(expectedSeed(fields, s)).toEqual({ num: '451', total: 1240, lines: [{ code: 'A1' }] });
  });

  it('leaves out a field the reader never looked at — an unread field stays unproven', () => {
    const s = { expected: null, lastResult: read({ num: '451' }) };
    expect(expectedSeed(fields, s)).toEqual({ num: '451' });
  });

  it('keeps what the user already confirmed over what the reader says now', () => {
    const s = { expected: { num: '452' }, lastResult: read({ num: '451' }) };
    expect(expectedSeed(fields, s).num).toBe('452');
  });

  it('keeps a confirmed blank: an explicitly empty field is a statement, not a gap', () => {
    const s = { expected: { num: null }, lastResult: read({ num: '451' }) };
    const seed = expectedSeed(fields, s);
    expect(Object.prototype.hasOwnProperty.call(seed, 'num')).toBe(true);
    expect(seed.num).toBeNull();
  });

  it('lets an edit in progress win over both', () => {
    const s = { expected: { num: '452' }, lastResult: read({ num: '451' }) };
    expect(expectedSeed(fields, s, { num: '453' }).num).toBe('453');
  });

  it('records an emptied edit as an explicit blank', () => {
    const s = { expected: null, lastResult: read({ num: '451' }) };
    expect(expectedSeed(fields, s, { num: '' })).toEqual({ num: null });
  });

  it('ignores keys that are not fields of this template', () => {
    const s = { expected: { gone: 'x' }, lastResult: read({ num: '451' }) };
    expect(expectedSeed(fields, s)).toEqual({ num: '451' });
  });

  it('never reads expected/lastResult through the prototype', () => {
    const s = { expected: {}, lastResult: {} };
    expect(expectedSeed([f('constructor')], s)).toEqual({});
  });
});

describe('agrees', () => {
  it('compares by the field type, not by string identity', () => {
    expect(agrees('1.240,00', 1240, 'CURRENCY')).toBe(true);
    expect(agrees('12/09/2026', '2026-09-12', 'DATE')).toBe(true);
    expect(agrees('ΚΑΠΑΛΙΝΕ Α.Ε.', 'καπαλινε α ε', 'TEXT')).toBe(true);
    expect(agrees('451', '452', 'TEXT')).toBe(false);
  });
  it('counts two blanks as agreement', () => {
    expect(agrees(null, null, 'TEXT')).toBe(true);
    expect(agrees('', null, 'TEXT')).toBe(true);
  });
});
