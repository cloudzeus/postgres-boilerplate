import { describe, it, expect } from 'vitest';
import { slugifyFieldKey } from '../slug';

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
