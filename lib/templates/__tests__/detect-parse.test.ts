import { describe, it, expect } from 'vitest';
import { extractJson, parseDetectField, parseMarks, toBbox } from '../detect-parse';

describe('extractJson', () => {
  it('strips fences and prose around the object', () => {
    expect(extractJson('Sure:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it('returns null on garbage', () => { expect(extractJson('no json here')).toBeNull(); });
});

describe('parseDetectField', () => {
  it('builds a SINGLE field with a deduped key and a guessed type when the model omits one', () => {
    const f = parseDetectField('{"label":"Αριθμός","value":"309","kind":"SINGLE"}', { taken: ['arithmos'], fallbackLabel: 'Πεδίο 3' });
    expect(f).toMatchObject({ label: 'Αριθμός', key: 'arithmos_2', kind: 'SINGLE', valueType: 'NUMBER', value: '309', columns: null });
  });
  it('trusts a valid model valueType', () => {
    expect(parseDetectField('{"label":"Αρ.","value":"309","valueType":"text"}', { taken: [], fallbackLabel: 'x' }).valueType).toBe('TEXT');
  });
  it('falls back to the given label when the model has none', () => {
    expect(parseDetectField('{"value":"x"}', { taken: [], fallbackLabel: 'Πεδίο 1' }).label).toBe('Πεδίο 1');
  });
  it('builds TABLE columns with unique keys', () => {
    const f = parseDetectField('{"label":"Γραμμές","kind":"TABLE","columns":[{"label":"Είδος"},{"label":"Είδος"},{"label":"Αξία","valueType":"CURRENCY"}]}', { taken: [], fallbackLabel: 'x' });
    expect(f.kind).toBe('TABLE');
    expect(f.columns?.map((c) => c.key)).toEqual(['eidos', 'eidos_2', 'axia']);
    expect(f.columns?.[2].valueType).toBe('CURRENCY');
  });
  it('a TABLE without columns degrades to SINGLE', () => {
    expect(parseDetectField('{"label":"x","kind":"TABLE","columns":[]}', { taken: [], fallbackLabel: 'x' }).kind).toBe('SINGLE');
  });
});

describe('toBbox', () => {
  it('converts Gemini box_2d [ymin,xmin,ymax,xmax] on a 0-1000 grid', () => {
    expect(toBbox({ box_2d: [100, 200, 300, 600] })).toEqual([0.2, 0.1, 0.4, 0.2]);
  });
  it('accepts an already-normalized bbox', () => { expect(toBbox({ bbox: [0.1, 0.2, 0.3, 0.4] })).toEqual([0.1, 0.2, 0.3, 0.4]); });
  it('rejects empty or inverted boxes', () => { expect(toBbox({ box_2d: [300, 200, 100, 600] })).toBeNull(); expect(toBbox({})).toBeNull(); });
});

describe('parseMarks', () => {
  const content = JSON.stringify({ marks: [
    { label: 'Αριθμός', value: '309', box_2d: [150, 600, 190, 700] },
    { label: '', value: '60.64.00.000.010', box_2d: [800, 100, 830, 400] },
    { label: 'Ημερομηνία', value: '30/06/2026', bbox: [0.7, 0.15, 0.2, 0.03] },
    { label: 'bad', value: 'x' },
  ] });
  it('keeps only marks with a usable box, dedupes keys against existing fields, names GL accounts', () => {
    const m = parseMarks(content, { taken: ['arithmos'] });
    expect(m.map((x) => x.key)).toEqual(['arithmos_2', 'gl_account_handwritten', 'imerominia']);
    expect(m[1].label).toBe('Λογιστικό άρθρο (χειρόγραφο)');
    expect(m[1].valueType).toBe('TEXT');
    expect(m[2].valueType).toBe('DATE');
    expect(m[2].bbox).toEqual([0.7, 0.15, 0.2, 0.03]);
  });
  it('caps the count', () => { expect(parseMarks(content, { taken: [], max: 1 })).toHaveLength(1); });
  it('returns [] for non-JSON', () => { expect(parseMarks('nope', { taken: [] })).toEqual([]); });
});
