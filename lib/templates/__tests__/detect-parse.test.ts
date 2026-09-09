import { describe, it, expect } from 'vitest';
import { extractJson, parseDetectField, parseMarks, toBbox } from '../detect-parse';

describe('extractJson', () => {
  it('strips fences and prose around the object', () => {
    expect(extractJson('Sure:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it('returns null on garbage', () => { expect(extractJson('no json here')).toBeNull(); });
  it('accepts a top-level array', () => { expect(extractJson('[{"a":1},{"a":2}]')).toEqual([{ a: 1 }, { a: 2 }]); });
  it('stops at the matching brace, so trailing prose with braces cannot break it', () => {
    expect(extractJson('{"a":{"b":1}}\nΕλπίζω να βοήθησα {όπως ζητήθηκε}')).toEqual({ a: { b: 1 } });
  });
  it('is not confused by braces inside strings', () => { expect(extractJson('{"a":"}{"}')).toEqual({ a: '}{' }); });
});

describe('parseDetectField', () => {
  it('builds a SINGLE field with a deduped key and a guessed type when the model omits one', () => {
    const f = parseDetectField('{"label":"Αριθμός","value":"309","kind":"SINGLE"}', { taken: ['arithmos'], fallbackLabel: 'Πεδίο 3' });
    expect(f).toMatchObject({ label: 'Αριθμός', key: 'arithmos_2', kind: 'SINGLE', valueType: 'NUMBER', value: '309', columns: null });
  });
  it('trusts a valid model valueType', () => {
    expect(parseDetectField('{"label":"Αρ.","value":"309","valueType":"text"}', { taken: [], fallbackLabel: 'x' })?.valueType).toBe('TEXT');
  });
  it('strips a trailing colon from the label', () => {
    expect(parseDetectField('{"label":"Αριθμός:","value":"309"}', { taken: [], fallbackLabel: 'x' })?.label).toBe('Αριθμός');
  });
  it('returns null when the model answered with no JSON at all', () => {
    expect(parseDetectField('δεν κατάλαβα', { taken: [], fallbackLabel: 'x' })).toBeNull();
    expect(parseDetectField('[{"label":"x"}]', { taken: [], fallbackLabel: 'x' })).toBeNull();
  });
  it('clamps an over-long label and an over-long column list to the validator limits', () => {
    const long = 'α'.repeat(300);
    const cols = Array.from({ length: 40 }, (_, i) => ({ label: `Στήλη ${i}` }));
    const f = parseDetectField(JSON.stringify({ label: long, kind: 'TABLE', columns: [{ label: long }, ...cols] }), { taken: [], fallbackLabel: 'x' });
    expect(f?.label).toHaveLength(120);
    expect(f?.columns).toHaveLength(30);
    expect(f?.columns?.[0].label).toHaveLength(120);
  });
  it('falls back to the given label when the model has none', () => {
    expect(parseDetectField('{"value":"x"}', { taken: [], fallbackLabel: 'Πεδίο 1' })?.label).toBe('Πεδίο 1');
  });
  it('builds TABLE columns with unique keys', () => {
    const f = parseDetectField('{"label":"Γραμμές","kind":"TABLE","columns":[{"label":"Είδος"},{"label":"Είδος"},{"label":"Αξία","valueType":"CURRENCY"}]}', { taken: [], fallbackLabel: 'x' });
    expect(f?.kind).toBe('TABLE');
    expect(f?.columns?.map((c) => c.key)).toEqual(['eidos', 'eidos_2', 'axia']);
    expect(f?.columns?.[2].valueType).toBe('CURRENCY');
  });
  it('accepts columns given as plain strings', () => {
    const f = parseDetectField('{"label":"Γραμμές","kind":"TABLE","columns":["Είδος","Αξία"]}', { taken: [], fallbackLabel: 'x' });
    expect(f?.columns?.map((c) => c.label)).toEqual(['Είδος', 'Αξία']);
    expect(f?.columns?.map((c) => c.key)).toEqual(['eidos', 'axia']);
  });
  it('guesses a column type from its sample when the model gives none', () => {
    const f = parseDetectField('{"label":"Γραμμές","kind":"TABLE","columns":[{"label":"Ημ/νία","sample":"30/06/2026"},{"label":"Ποσό","sample":"1.234,50 €"}]}', { taken: [], fallbackLabel: 'x' });
    expect(f?.columns?.map((c) => c.valueType)).toEqual(['DATE', 'CURRENCY']);
  });
  it('a TABLE without columns degrades to SINGLE', () => {
    expect(parseDetectField('{"label":"x","kind":"TABLE","columns":[]}', { taken: [], fallbackLabel: 'x' })?.kind).toBe('SINGLE');
  });
});

describe('toBbox', () => {
  it('converts Gemini box_2d [ymin,xmin,ymax,xmax] on a 0-1000 grid', () => {
    expect(toBbox({ box_2d: [100, 200, 300, 600] })).toEqual([0.2, 0.1, 0.4, 0.2]);
  });
  it('accepts an already-normalized bbox', () => { expect(toBbox({ bbox: [0.1, 0.2, 0.3, 0.4] })).toEqual([0.1, 0.2, 0.3, 0.4]); });
  it('rejects empty or inverted boxes', () => { expect(toBbox({ box_2d: [300, 200, 100, 600] })).toBeNull(); expect(toBbox({})).toBeNull(); });
  it('coerces numeric strings', () => {
    expect(toBbox({ box_2d: ['100', '200', '300', '600'] })).toEqual([0.2, 0.1, 0.4, 0.2]);
    expect(toBbox({ bbox: ['0.1', '0.2', '0.3', '0.4'] })).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(toBbox({ box_2d: ['a', 'b', 'c', 'd'] })).toBeNull();
  });
  it('treats a box_2d whose four values are all ≤ 1 as already normalized', () => {
    expect(toBbox({ box_2d: [0.1, 0.2, 0.4, 0.5] })).toEqual([0.2, 0.1, 0.3, 0.3]);
  });
  it('clamps the rounding overflow instead of dropping the box', () => {
    const b = toBbox({ box_2d: [100.5, 100.5, 1000, 1000] });
    expect(b).not.toBeNull();
    expect(b![0] + b![2]).toBeLessThanOrEqual(1);
    expect(b![1] + b![3]).toBeLessThanOrEqual(1);
  });
});

describe('parseMarks', () => {
  const content = JSON.stringify({ marks: [
    { label: 'Αριθμός', value: '309', box_2d: [150, 600, 190, 700] },
    { label: '', value: '60.64.00.000.010', box_2d: [800, 100, 830, 400] },
    { label: 'Ημερομηνία:', value: '30/06/2026', bbox: [0.7, 0.15, 0.2, 0.03] },
    { label: 'bad', value: 'x' },
    { label: '', value: '', box_2d: [10, 10, 20, 20] },
  ] });
  it('keeps only marks with a usable box, dedupes keys against existing fields, names GL accounts', () => {
    const m = parseMarks(content, { taken: ['arithmos'] })!;
    expect(m.map((x) => x.key)).toEqual(['arithmos_2', 'gl_account_handwritten', 'imerominia']);
    expect(m[1].label).toBe('Λογιστικό άρθρο (χειρόγραφο)');
    expect(m[1].valueType).toBe('TEXT');
    expect(m[2].valueType).toBe('DATE');
    expect(m[2].bbox).toEqual([0.7, 0.15, 0.2, 0.03]);
  });
  it('strips a trailing colon from the label', () => { expect(parseMarks(content, { taken: [] })![2].label).toBe('Ημερομηνία'); });
  it('skips a mark with neither a label nor a value', () => { expect(parseMarks(content, { taken: [] })).toHaveLength(3); });
  it('numbers an unnamed mark after the fields the template already has', () => {
    const m = parseMarks(JSON.stringify({ marks: [{ value: '309', box_2d: [150, 600, 190, 700] }, { value: '77', box_2d: [250, 600, 290, 700] }] }), { taken: ['a', 'b', 'c'] });
    expect(m!.map((x) => x.label)).toEqual(['Πεδίο 4', 'Πεδίο 5']);
  });
  it('drops a mark that boxes (nearly) the whole page', () => {
    expect(parseMarks(JSON.stringify({ marks: [{ label: 'x', value: 'y', box_2d: [0, 0, 1000, 1000] }] }), { taken: [] })).toEqual([]);
  });
  it('accepts a top-level array of marks', () => {
    const m = parseMarks('[{"label":"Αριθμός","value":"309","box_2d":[150,600,190,700]}]', { taken: [] });
    expect(m!.map((x) => x.key)).toEqual(['arithmos']);
  });
  it('caps the count', () => { expect(parseMarks(content, { taken: [], max: 1 })).toHaveLength(1); });
  it('caps at zero without proposing anything', () => { expect(parseMarks(content, { taken: [], max: 0 })).toEqual([]); });
  it('returns null for non-JSON but [] for a valid reply with no marks', () => {
    expect(parseMarks('nope', { taken: [] })).toBeNull();
    expect(parseMarks('{"marks":[]}', { taken: [] })).toEqual([]);
    expect(parseMarks('{"ok":true}', { taken: [] })).toEqual([]);
  });
});
