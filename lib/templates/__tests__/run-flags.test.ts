import { describe, it, expect } from 'vitest';
import { recomputeFieldFlags, type StoredFlags } from '../run-flags';
import type { FieldDef, FieldValue, TemplateValueType } from '../schema';

const field = (over: Partial<FieldDef>): FieldDef => ({
  key: 'k', label: 'K', kind: 'SINGLE', valueType: 'TEXT' as TemplateValueType, color: '#0078D4',
  region: { page: 0, bbox: [0, 0, 0.1, 0.1] }, columns: null, aiHint: null, required: false, order: 0, ...over,
});

const TOTAL = field({ key: 'total', label: 'Σύνολο', valueType: 'CURRENCY', required: true, order: 0 });
const NET = field({ key: 'net', label: 'Καθαρή αξία', valueType: 'CURRENCY', order: 1 });
const NOTE = field({ key: 'note', label: 'Σημείωση', order: 2 });
const FIELDS = [TOTAL, NET, NOTE];

const value = (v: FieldValue['value']): FieldValue =>
  ({ raw: v == null ? null : String(v), value: v, confidence: 1, source: 'manual', page: 0, bbox: [0, 0, 0.1, 0.1], color: '#0078D4' });

const MISSING = 'Λείπει υποχρεωτικό πεδίο «Σύνολο»';
const ROWS = [{ fieldKey: 'total', invoiceKey: 'totalAmount' }, { fieldKey: 'net', invoiceKey: 'subtotal' }, { fieldKey: 'note', invoiceKey: 'notes' }];

const run = (over: {
  flags?: StoredFlags | null;
  values?: Record<string, FieldValue>;
  /** Folded into `flags.baseOcr` — the pre-projection snapshot the runner stored on the run. */
  baseOcr?: Record<string, unknown>;
  mode?: 'AUTO' | 'SEMI_AUTO' | 'MANUAL';
  rows?: { fieldKey: string; invoiceKey: string }[];
} = {}) =>
  recomputeFieldFlags({
    flags: over.baseOcr ? { ...(over.flags ?? {}), baseOcr: over.baseOcr } : over.flags ?? null,
    fields: FIELDS,
    values: over.values ?? { total: value(150), net: value(120), note: value('x') },
    mode: over.mode ?? 'SEMI_AUTO',
    rows: over.rows,
  });

describe('recomputeFieldFlags — required fields', () => {
  it('clears the flag of a required field the human just filled in, and keeps everything else', () => {
    const out = run({
      mode: 'AUTO',
      flags: { review: [MISSING, 'μεγάλο ποσό'], blocked: [MISSING, 'χωρίς κατηγορία'], notified: ['c1'], fields: { total: 'blocked', note: 'review' } },
    });
    expect(out.review).toEqual(['μεγάλο ποσό']);
    expect(out.blocked).toEqual(['χωρίς κατηγορία']);
    // The read error a rule/reader left on an untouched optional field survives.
    expect(out.fields).toEqual({ note: 'review' });
    expect(out.notified).toEqual(['c1']);
  });

  it('re-adds the flag for a required field that was emptied — review in SEMI_AUTO, blocked in AUTO', () => {
    const emptied = { total: value(null), net: value(120), note: value('x') };
    const semi = run({ values: emptied, flags: { review: [], blocked: [], fields: {} } });
    expect(semi.review).toEqual([MISSING]);
    expect(semi.blocked).toEqual([]);
    expect(semi.fields).toEqual({ total: 'review' });

    const auto = run({ values: emptied, mode: 'AUTO', flags: { review: [], blocked: [], fields: {} } });
    expect(auto.review).toEqual([MISSING]);
    expect(auto.blocked).toEqual([MISSING]);
    expect(auto.fields).toEqual({ total: 'blocked' });
  });

  it('never duplicates a reason that is already on the run', () => {
    const out = run({ values: { total: value(null), net: value(120), note: value('x') }, mode: 'AUTO', flags: { review: [MISSING], blocked: [MISSING] } });
    expect(out.review).toEqual([MISSING]);
    expect(out.blocked).toEqual([MISSING]);
  });
});

describe('recomputeFieldFlags — cross-check against the base OCR', () => {
  const STALE_NET = 'Ασυμφωνία «Καθαρή αξία»: πρότυπο 12 · OCR 120';

  it('re-adds the flag when the corrected total contradicts the OCR, without blocking', () => {
    const out = run({ values: { total: value(229.4), net: value(120), note: value('x') }, baseOcr: { totalAmount: 22.94 }, rows: ROWS });
    expect(out.review).toEqual(['Ασυμφωνία «Σύνολο»: πρότυπο 229.4 · OCR 22.94']);
    expect(out.blocked).toEqual([]);
    expect(out.fields).toEqual({ total: 'review' });
  });

  it('re-adds the mismatch of a field the human did NOT correct', () => {
    // `net` is still 12 against the OCR's 120: the correction next door does not make the run agree.
    const out = run({
      values: { total: value(150), net: value(12), note: value('x') },
      baseOcr: { totalAmount: 150, subtotal: 120 }, rows: ROWS,
      flags: { review: [STALE_NET], blocked: [], fields: { net: 'review' } },
    });
    expect(out.review).toEqual([STALE_NET]);
    expect(out.fields).toEqual({ net: 'review' });
  });

  it('drops a mismatch the correction resolved', () => {
    const out = run({
      values: { total: value(150), net: value(120), note: value('x') },
      baseOcr: { subtotal: 120 }, rows: ROWS,
      flags: { review: [STALE_NET, 'μεγάλο ποσό'], blocked: [], fields: { net: 'review' } },
    });
    expect(out.review).toEqual(['μεγάλο ποσό']);
    expect(out.fields).toEqual({});
  });

  it('keeps the snapshot on the flags it returns, so the NEXT correction can re-check too', () => {
    const out = run({ baseOcr: { totalAmount: 150 }, rows: ROWS });
    expect(out.baseOcr).toEqual({ totalAmount: 150 });
  });

  it('leaves an existing mismatch alone when there is no projection to re-check it against', () => {
    const out = run({ mode: 'MANUAL', flags: { review: [STALE_NET], blocked: [], fields: { net: 'review' } } });
    expect(out.review).toEqual([STALE_NET]);
    expect(out.fields).toEqual({ net: 'review' });
  });

  it('leaves an existing mismatch alone on a run that stored no baseOcr — even one that projects', () => {
    // Runs written before `baseOcr` existed. The document's `extractedData` is by now this run's OWN
    // projection, so there is nothing independent left to re-check against: dropping the reason here
    // would erase a genuine «Ασυμφωνία» on the very first correction.
    const out = run({
      values: { total: value(150), net: value(120), note: value('x') },
      rows: ROWS,
      flags: { review: [STALE_NET, 'μεγάλο ποσό'], blocked: [], fields: { net: 'review' } },
    });
    expect(out.review).toEqual([STALE_NET, 'μεγάλο ποσό']);
    expect(out.fields).toEqual({ net: 'review' });
  });

  it('only cross-checks the keys worth money — an unrelated mapped field keeps its own verdict', () => {
    const out = run({
      baseOcr: { notes: 'άλλο κείμενο' }, rows: ROWS,
      flags: { review: ['μεγάλο ποσό'], blocked: [], fields: { note: 'review' } },
    });
    expect(out.review).toEqual(['μεγάλο ποσό']);
    expect(out.fields).toEqual({ note: 'review' });
  });
});
