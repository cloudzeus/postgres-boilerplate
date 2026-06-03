import { describe, it, expect } from 'vitest';
import { slugifyFieldKey, buildCustomFieldsPrompt, mergeCustomFields, coerceFieldValue, mergeLineCustomFields, buildLineFieldsPrompt } from '../field-rules';

describe('slugifyFieldKey', () => {
  it('transliterates a Greek label to an ascii slug', () => {
    expect(slugifyFieldKey('Αριθμός Παραγγελίας')).toBe('arithmos_paraggelias');
  });
  it('collapses punctuation/spaces to single underscores', () => {
    expect(slugifyFieldKey('  Κωδικός  Σύμβασης / 2026 ')).toBe('kodikos_symvasis_2026');
  });
  it('keeps an already-ascii label', () => {
    expect(slugifyFieldKey('PO Number')).toBe('po_number');
  });
  it('falls back to a deterministic hash when nothing is transliterable', () => {
    const a = slugifyFieldKey('★★★');
    const b = slugifyFieldKey('★★★');
    expect(a).toBe(b);
    expect(a.startsWith('field_')).toBe(true);
  });
  it('returns a deterministic hash key for an empty/untransliterable label', () => {
    expect(slugifyFieldKey('')).toBe(slugifyFieldKey(''));
    expect(slugifyFieldKey('').startsWith('field_')).toBe(true);
  });
});

describe('buildCustomFieldsPrompt', () => {
  it('lists every active field key + description', () => {
    const p = buildCustomFieldsPrompt([
      { key: 'po', label: 'Αρ. Παραγγελίας', description: 'πάνω δεξιά' } as any,
    ]);
    expect(p).toContain('"po"');
    expect(p).toContain('Αρ. Παραγγελίας');
    expect(p).toContain('πάνω δεξιά');
    expect(p.toLowerCase()).toContain('json');
  });
});

describe('mergeCustomFields', () => {
  it('writes found values and normalizes empty → null, ignoring unknown keys', () => {
    const data: any = { vatNumber: '999863881' };
    const rules = [{ key: 'po' }, { key: 'contract' }] as any;
    const out = mergeCustomFields(data, { po: 'PO-1', contract: '', extra: 'x' }, rules);
    expect(out.customFields).toEqual({ po: 'PO-1', contract: null });
  });
  it('preserves previously stored custom fields not in this pass', () => {
    const data: any = { customFields: { old: 'keep' } };
    const out = mergeCustomFields(data, { po: 'PO-2' }, [{ key: 'po' }] as any);
    expect(out.customFields).toEqual({ old: 'keep', po: 'PO-2' });
  });
  it('does not mutate the input data object', () => {
    const data: any = { customFields: { old: 'keep' } };
    const out = mergeCustomFields(data, { po: 'PO-9' }, [{ key: 'po' }] as any);
    expect(data.customFields).toEqual({ old: 'keep' }); // unchanged
    expect(out).not.toBe(data);
    expect(out.customFields).toEqual({ old: 'keep', po: 'PO-9' });
  });
});

describe('coerceFieldValue', () => {
  it('text: trims and maps empty to null', () => {
    expect(coerceFieldValue('  PO-1 ', 'text')).toBe('PO-1');
    expect(coerceFieldValue('', 'text')).toBeNull();
    expect(coerceFieldValue(null, 'text')).toBeNull();
  });
  it('list: splits a delimited string into a trimmed array', () => {
    expect(coerceFieldValue('SN1, SN2;SN3\nSN4', 'list')).toEqual(['SN1', 'SN2', 'SN3', 'SN4']);
  });
  it('list: accepts an array and drops empties', () => {
    expect(coerceFieldValue(['A', '', ' B '], 'list')).toEqual(['A', 'B']);
  });
  it('list: empty result becomes null', () => {
    expect(coerceFieldValue('', 'list')).toBeNull();
    expect(coerceFieldValue([], 'list')).toBeNull();
    expect(coerceFieldValue(null, 'list')).toBeNull();
  });
});

describe('mergeCustomFields with valueType', () => {
  it('coerces a list-typed document field to an array', () => {
    const out = mergeCustomFields({} as any, { serials: 'SN1, SN2' }, [{ key: 'serials', valueType: 'list' }] as any);
    expect(out.customFields).toEqual({ serials: ['SN1', 'SN2'] });
  });
});

describe('mergeLineCustomFields', () => {
  const rules = [{ key: 'serials', valueType: 'list' }] as any;
  it('merges per-line values by index, coercing lists', () => {
    const data: any = { items: [{ name: 'A' }, { name: 'B' }] };
    const out = mergeLineCustomFields(data, [
      { index: 0, serials: 'SN1, SN2' },
      { index: 1, serials: null },
    ], rules);
    expect(out.items[0].customFields).toEqual({ serials: ['SN1', 'SN2'] });
    expect(out.items[1].customFields).toEqual({ serials: null });
  });
  it('ignores out-of-range and non-integer indices', () => {
    const data: any = { items: [{ name: 'A' }] };
    const out = mergeLineCustomFields(data, [{ index: 5, serials: 'X' }, { index: 'x' as any, serials: 'Y' }], rules);
    expect(out.items[0].customFields).toBeUndefined();
  });
  it('does not mutate the input', () => {
    const data: any = { items: [{ name: 'A' }] };
    const out = mergeLineCustomFields(data, [{ index: 0, serials: 'S' }], rules);
    expect(data.items[0].customFields).toBeUndefined();
    expect(out).not.toBe(data);
  });
  it('returns data unchanged when items or parsedLines missing', () => {
    const data: any = { vatNumber: '1' };
    expect(mergeLineCustomFields(data, null, rules)).toBe(data);
  });
});

describe('buildLineFieldsPrompt', () => {
  it('includes line indices, field keys and the lines shape', () => {
    const p = buildLineFieldsPrompt(
      [{ key: 'serials', label: 'Serials', valueType: 'list' } as any],
      [{ index: 0, code: 'HW1', name: 'Router' }],
    );
    expect(p).toContain('"serials"');
    expect(p).toContain('Router');
    expect(p).toContain('"lines"');
    expect(p).toContain('"index"');
  });
});
