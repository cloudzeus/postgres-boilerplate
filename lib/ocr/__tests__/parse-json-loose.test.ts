import { describe, it, expect, vi } from 'vitest';

// Το `extract.ts` φέρνει μαζί βάση και ρυθμίσεις· εδώ ελέγχεται μόνο ο parser.
vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/settings', () => ({ getSetting: async () => undefined }));
import { firstJsonObject, parseJsonLoose, stripTrailingCommas } from '../extract';

describe('parseJsonLoose', () => {
  it('καθαρό JSON και code fences', () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('σωστό JSON και μετά περισσευούμενο άγκιστρο (Revoil)', () => {
    expect(parseJsonLoose('{"lines":[{"name":"ΜΑΖΟΥΤ"}],"total":10}\n  }')).toEqual({ lines: [{ name: 'ΜΑΖΟΥΤ' }], total: 10 });
  });

  it('δύο αντικείμενα στη σειρά — κρατά το πρώτο', () => {
    expect(parseJsonLoose('{"a":1}\n{"b":2}')).toEqual({ a: 1 });
  });

  it('κείμενο πριν και άγκιστρα μέσα σε strings', () => {
    expect(parseJsonLoose('Ορίστε: {"note":"τιμή {x} } ok","n":"a\\"}"} τέλος }')).toEqual({ note: 'τιμή {x} } ok', n: 'a"}' });
  });

  it('κόμμα πριν από } ή ]', () => {
    expect(parseJsonLoose('{"a":[1,2,],"b":{"c":3,},}')).toEqual({ a: [1, 2], b: { c: 3 } });
  });

  it('κενό ή χωρίς JSON → σφάλμα', () => {
    expect(() => parseJsonLoose('')).toThrow();
    expect(() => parseJsonLoose('καθόλου JSON')).toThrow(/valid JSON/);
  });
});

describe('βοηθητικά', () => {
  it('firstJsonObject: null σε ημιτελές', () => {
    expect(firstJsonObject('{"a":{"b":1}')).toBeNull();
  });
  it('stripTrailingCommas δεν πειράζει κόμματα μέσα σε strings', () => {
    expect(stripTrailingCommas('{"t":"a, }","x":1,}')).toBe('{"t":"a, }","x":1}');
  });
});
