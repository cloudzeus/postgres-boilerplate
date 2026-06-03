import { describe, it, expect } from 'vitest';
import { slugifyFieldKey, buildCustomFieldsPrompt, mergeCustomFields } from '../field-rules';

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
