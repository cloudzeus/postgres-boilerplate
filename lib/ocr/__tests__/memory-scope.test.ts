import { describe, expect, it } from 'vitest';
import { ruleFitsWorld, scopeKey, scopeKeys, worldOfLines } from '@/lib/ocr/memory-scope';

describe('memory-scope', () => {
  it('ο κόσμος από τον πίνακα γραμμών', () => {
    expect(worldOfLines('LINLINES')).toBe('lin');
    expect(worldOfLines('AUTO')).toBe('pur');
    expect(worldOfLines('EXPANAL')).toBe('pur');
    expect(worldOfLines('SXDOCLINES')).toBeNull();
    expect(worldOfLines(null)).toBeNull();
  });
  it('κλειδιά: πρώτα με κόσμο, μετά χωρίς', () => {
    expect(scopeKeys(['@family:software@24', '@family:software'], 'pur'))
      .toEqual(['@family:software@24#pur', '@family:software#pur', '@family:software@24', '@family:software']);
    expect(scopeKeys(['a'], null)).toEqual(['a']);
    expect(scopeKey('a', 'lin')).toBe('a#lin');
  });
  it('έξοδο δεν χωράει σε ειδικές συναλλαγές, χρεοπίστωση δεν χωράει σε αγορές', () => {
    expect(ruleFitsWorld({ mtrl: null, expn: 5, lin: null }, 'lin')).toBe(false);
    expect(ruleFitsWorld({ mtrl: null, expn: null, lin: 7 }, 'pur')).toBe(false);
    expect(ruleFitsWorld({ mtrl: null, expn: null, lin: 7 }, 'lin')).toBe(true);
    expect(ruleFitsWorld({ mtrl: 1, expn: null, lin: null }, null)).toBe(true);
  });
});
