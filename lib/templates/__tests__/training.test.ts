import { describe, it, expect } from 'vitest';
import { normalizeForCompare, sampleScore, scoreSamples, trainingGate, type TrainingField, type TrainingSample } from '../training';

const f = (key: string, over: Partial<TrainingField> = {}): TrainingField =>
  ({ key, valueType: 'TEXT', required: false, ...over });

const sample = (over: Partial<TrainingSample>): TrainingSample =>
  ({ status: 'VERIFIED', expected: null, lastResult: null, ...over });

/** `lastResult` as `readSample` stores it: a FieldValue-shaped record per key. */
const read = (v: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(v).map(([k, value]) => [k, { raw: String(value ?? ''), value }]));

describe('normalizeForCompare', () => {
  it('folds TEXT to lowercase, accent-free, single-spaced', () => {
    expect(normalizeForCompare('  ΚΑΠΑΛΙΝΕ   Α.Ε. ', 'TEXT')).toBe(normalizeForCompare('καπαλινέ α ε', 'TEXT'));
    expect(normalizeForCompare('Τιμολόγιο', 'TEXT')).toBe('τιμολογιο');
  });
  it('keeps digits in TEXT (an invoice number is text)', () => {
    expect(normalizeForCompare('ΤΙΜ-451', 'TEXT')).toBe('τιμ 451');
  });
  it('compares NUMBER/CURRENCY by value, rounded to 2 decimals', () => {
    expect(normalizeForCompare('1.240,00', 'CURRENCY')).toBe(normalizeForCompare(1240, 'CURRENCY'));
    expect(normalizeForCompare('1240,004', 'NUMBER')).toBe(normalizeForCompare('1240', 'NUMBER'));
    expect(normalizeForCompare('1.240,50', 'CURRENCY')).not.toBe(normalizeForCompare('1240', 'CURRENCY'));
  });
  it('compares DATE as ISO regardless of the printed format', () => {
    expect(normalizeForCompare('12/09/2026', 'DATE')).toBe('2026-09-12');
    expect(normalizeForCompare('2026-09-12', 'DATE')).toBe('2026-09-12');
  });
  it('compares LIST/TABLE cell by cell', () => {
    expect(normalizeForCompare(['Α', 'Β'], 'LIST')).toBe(normalizeForCompare(['α', 'β'], 'LIST'));
    expect(normalizeForCompare([{ code: 'A1', qty: 2 }], 'LIST')).toBe(normalizeForCompare([{ qty: 2, code: 'a1' }], 'LIST'));
    expect(normalizeForCompare(['Α'], 'LIST')).not.toBe(normalizeForCompare(['Β'], 'LIST'));
  });
  it('is null for nothing at all', () => {
    expect(normalizeForCompare(null, 'TEXT')).toBeNull();
    expect(normalizeForCompare('', 'TEXT')).toBeNull();
    expect(normalizeForCompare('  ', 'TEXT')).toBeNull();
    expect(normalizeForCompare('όχι αριθμός', 'NUMBER')).toBeNull();
  });
});

describe('sampleScore', () => {
  it('is the fraction of expected keys the reader got right', () => {
    const s = sample({ expected: { a: 'X', b: '5' }, lastResult: read({ a: 'x', b: '6' }) });
    expect(sampleScore([f('a'), f('b', { valueType: 'NUMBER' })], s)).toBe(0.5);
  });
  it('is null when the sample expects nothing', () => {
    expect(sampleScore([f('a')], sample({ expected: {}, lastResult: read({ a: 'x' }) }))).toBeNull();
  });
  it('counts an unread field as wrong, not as absent', () => {
    expect(sampleScore([f('a')], sample({ expected: { a: 'X' }, lastResult: {} }))).toBe(0);
  });
  it('an expected EMPTY value matches a field the reader left empty', () => {
    expect(sampleScore([f('a')], sample({ expected: { a: '' }, lastResult: read({ a: null }) }))).toBe(1);
  });
  it('a field keyed like an Object prototype member is not «expected» just because JS says so', () => {
    // `'constructor' in expected` is TRUE for every object alive — the field would count as declared
    // (and, having no real value, as always wrong) and would drag the template's score down for ever.
    const s = sample({ expected: { a: 'X' }, lastResult: read({ a: 'X' }) });
    expect(sampleScore([f('a'), f('constructor'), f('toString')], s)).toBe(1);
  });
});

describe('scoreSamples', () => {
  const fields = [f('total', { valueType: 'CURRENCY', required: true }), f('note')];

  it('counts only VERIFIED samples', () => {
    const out = scoreSamples(fields, [
      sample({ expected: { total: '100' }, lastResult: read({ total: '100' }) }),
      sample({ status: 'READ', expected: { total: '100' }, lastResult: read({ total: '9' }) }),
      sample({ status: 'PENDING', expected: null, lastResult: null }),
    ]);
    expect(out.verified).toBe(1);
    expect(out.perField.total).toEqual({ ok: 1, total: 1, score: 1 });
  });

  it('a field is only scored on samples that expect it', () => {
    const out = scoreSamples(fields, [
      sample({ expected: { total: '100', note: 'a' }, lastResult: read({ total: '100', note: 'a' }) }),
      sample({ expected: { total: '200' }, lastResult: read({ total: '201' }) }),
    ]);
    expect(out.perField.total).toEqual({ ok: 1, total: 2, score: 0.5 });
    expect(out.perField.note).toEqual({ ok: 1, total: 1, score: 1 });
  });

  it('the overall score is the mean over the REQUIRED fields when there are any', () => {
    const out = scoreSamples(fields, [
      sample({ expected: { total: '100', note: 'a' }, lastResult: read({ total: '100', note: 'ΑΛΛΟ' }) }),
    ]);
    expect(out.perField.note.score).toBe(0);
    expect(out.overall).toBe(1); // only `total` is required
  });

  it('with no required field it is the mean over all of them', () => {
    const out = scoreSamples([f('a'), f('b')], [
      sample({ expected: { a: 'x', b: 'y' }, lastResult: read({ a: 'x', b: 'z' }) }),
    ]);
    expect(out.overall).toBe(0.5);
  });

  it('a field nobody ever confirmed scores zero — it is unproven, not perfect', () => {
    const out = scoreSamples(fields, [sample({ expected: { note: 'a' }, lastResult: read({ note: 'a' }) })]);
    expect(out.perField.total).toEqual({ ok: 0, total: 0, score: 0 });
    expect(out.overall).toBe(0);
  });

  it('no verified samples at all → zero, not NaN', () => {
    const out = scoreSamples(fields, [sample({ status: 'PENDING' })]);
    expect(out.verified).toBe(0);
    expect(out.overall).toBe(0);
    expect(out.perField.total).toEqual({ ok: 0, total: 0, score: 0 });
  });

  it('no fields at all → zero, not NaN', () => {
    expect(scoreSamples([], [sample({ expected: { a: 'x' } })]).overall).toBe(0);
  });
});

describe('trainingGate', () => {
  const t = { minTrainingScore: 0.9, minTrainingSamples: 3, trainingScore: 0.95, verifiedSamples: 4 };
  it('passes when both thresholds are met', () => {
    expect(trainingGate(t)).toEqual({ ok: true });
  });
  it('is switched off entirely by minTrainingSamples = 0', () => {
    expect(trainingGate({ ...t, minTrainingSamples: 0, trainingScore: null, verifiedSamples: 0 })).toEqual({ ok: true });
  });
  it('asks for more samples first', () => {
    expect(trainingGate({ ...t, verifiedSamples: 1 })).toEqual({ ok: false, reason: 'need_samples' });
  });
  it('then for a better score', () => {
    expect(trainingGate({ ...t, trainingScore: 0.5 })).toEqual({ ok: false, reason: 'low_score' });
    expect(trainingGate({ ...t, trainingScore: null })).toEqual({ ok: false, reason: 'low_score' });
  });
  it('accepts exactly the threshold', () => {
    expect(trainingGate({ ...t, verifiedSamples: 3, trainingScore: 0.9 })).toEqual({ ok: true });
  });
});
