import { describe, it, expect } from 'vitest';
import {
  AMBIGUITY_GAP, FINGERPRINT_WORDS, MATCH_THRESHOLD,
  buildFingerprint, isEmptyFingerprint, rankTemplates, similarity, toFingerprint,
} from '../fingerprint';

const TEXT = `ΚΑΠΑΛΙΝΕ ΑΝΩΝΥΜΗ ΕΤΑΙΡΕΙΑ ΕΜΠΟΡΙΑΣ ΧΡΩΜΑΤΩΝ
ΤΙΜΟΛΟΓΙΟ ΠΩΛΗΣΗΣ 451  ΗΜΕΡΟΜΗΝΙΑ 12/09/2026  ΑΦΜ 123456789
ΠΕΡΙΓΡΑΦΗ ΠΟΣΟΤΗΤΑ ΑΞΙΑ ΦΠΑ ΣΥΝΟΛΟ
ΒΕΡΝΙΚΙ ΘΑΛΑΣΣΗΣ ΔΙΑΛΥΤΙΚΟ ΠΙΣΤΟΛΙ ΒΑΦΗΣ 1.234,56`;

describe('buildFingerprint', () => {
  const fp = buildFingerprint({ issuerName: 'Καπαλινέ Α.Ε.', afm: 'EL 123456789', text: TEXT, aspect: 0.707 });

  it('normalises the ΑΦΜ to nine digits and the issuer to fold-comparable Greek', () => {
    expect(fp.afm).toBe('123456789');
    expect(fp.issuer).toBe('ΚΑΠΑΛΙΝΕ ΑΕ');
    expect(fp.aspect).toBe(0.707);
  });
  it('keeps the words that identify the layout', () => {
    expect(fp.words).toContain('ΒΕΡΝΙΚΙ');
    expect(fp.words).toContain('ΔΙΑΛΥΤΙΚΟ');
    expect(fp.words).toContain('ΕΜΠΟΡΙΑΣ');
  });
  it('drops the boilerplate every Greek invoice prints', () => {
    for (const w of ['ΤΙΜΟΛΟΓΙΟ', 'ΠΟΣΟΤΗΤΑ', 'ΣΥΝΟΛΟ', 'ΦΠΑ', 'ΑΦΜ', 'ΗΜΕΡΟΜΗΝΙΑ', 'ΑΞΙΑ', 'ΠΕΡΙΓΡΑΦΗ']) {
      expect(fp.words).not.toContain(w);
    }
  });
  it('drops short tokens and bare numbers (an invoice number is not a layout)', () => {
    expect(fp.words.some((w) => w.length < 4)).toBe(false);
    expect(fp.words.some((w) => /^\d+$/.test(w))).toBe(false);
    expect(fp.words).not.toContain('123456789');
  });
  it('is capped and deterministic', () => {
    const many = Array.from({ length: 200 }, (_, i) => `ΛΕΞΗΑΑ${i}`).join(' ');
    const big = buildFingerprint({ text: many });
    expect(big.words.length).toBe(FINGERPRINT_WORDS);
    expect(buildFingerprint({ text: many }).words).toEqual(big.words);
  });
  it('has no words and no issuer when it was given nothing', () => {
    const empty = buildFingerprint({});
    expect(empty).toEqual({ afm: null, issuer: null, words: [], aspect: null });
    expect(isEmptyFingerprint(empty)).toBe(true);
    expect(isEmptyFingerprint(buildFingerprint({ issuerName: 'Χ Α.Ε.' }))).toBe(false);
  });
  it('rejects an aspect that is not a sane page ratio', () => {
    expect(buildFingerprint({ aspect: 0 }).aspect).toBeNull();
    expect(buildFingerprint({ aspect: Number.NaN }).aspect).toBeNull();
  });
});

describe('similarity', () => {
  const a = buildFingerprint({ issuerName: 'ΚΑΠΑΛΙΝΕ ΑΕ', text: TEXT, aspect: 0.707 });

  it('is 1 for the same document read twice', () => {
    expect(similarity(a, buildFingerprint({ issuerName: 'ΚΑΠΑΛΙΝΕ ΑΕ', text: TEXT, aspect: 0.707 }))).toBeCloseTo(1, 6);
  });
  it('stays high for the next invoice of the same issuer (different values, same layout)', () => {
    const b = buildFingerprint({
      issuerName: 'ΚΑΠΑΛΙΝΕ Α.Ε.',
      text: TEXT.replace('451', '452').replace('1.234,56', '87,10'),
      aspect: 0.708,
    });
    expect(similarity(a, b)).toBeGreaterThan(MATCH_THRESHOLD);
  });
  it('is low for an unrelated issuer and layout', () => {
    const other = buildFingerprint({
      issuerName: 'ΜΕΤΑΦΟΡΙΚΗ ΟΛΥΜΠΟΣ ΕΠΕ',
      text: 'ΔΕΛΤΙΟ ΑΠΟΣΤΟΛΗΣ ΜΕΤΑΦΟΡΑ ΔΡΟΜΟΛΟΓΙΟ ΠΡΟΟΡΙΣΜΟΣ ΦΟΡΤΩΤΙΚΗ ΚΙΒΩΤΙΑ',
      aspect: 1.41,
    });
    expect(similarity(a, other)).toBeLessThan(MATCH_THRESHOLD);
  });
  it('redistributes the weight of the parts one side is missing', () => {
    const wordsOnly = buildFingerprint({ text: TEXT });
    // No issuer and no aspect on one side: the words alone must still be able to reach 1.
    expect(similarity(wordsOnly, a)).toBeCloseTo(1, 6);
  });
  it('is 0 when there is nothing at all to compare', () => {
    expect(similarity(buildFingerprint({}), a)).toBe(0);
    expect(similarity(buildFingerprint({}), buildFingerprint({}))).toBe(0);
  });
  it('is symmetric', () => {
    const b = buildFingerprint({ issuerName: 'ΑΛΛΟΣ ΑΕ', text: TEXT, aspect: 1.41 });
    expect(similarity(a, b)).toBeCloseTo(similarity(b, a), 9);
  });
});

describe('rankTemplates', () => {
  const fp = buildFingerprint({ issuerName: 'ΚΑΠΑΛΙΝΕ ΑΕ', text: TEXT, aspect: 0.707 });

  it('scores a template by its BEST fingerprint and sorts descending', () => {
    const ranked = rankTemplates(fp, [
      { templateId: 'far', fingerprints: [buildFingerprint({ issuerName: 'ΑΣΧΕΤΟΣ', text: 'ΚΑΤΙ ΑΛΛΟ ΤΕΛΕΙΩΣ ΔΙΑΦΟΡΕΤΙΚΟ' })] },
      {
        templateId: 'near',
        fingerprints: [
          buildFingerprint({ issuerName: 'ΑΣΧΕΤΟΣ', text: 'ΞΕΝΟ ΚΕΙΜΕΝΟ ΕΝΤΕΛΩΣ' }),
          buildFingerprint({ issuerName: 'ΚΑΠΑΛΙΝΕ ΑΕ', text: TEXT, aspect: 0.707 }),
        ],
      },
    ]);
    expect(ranked.map((r) => r.templateId)).toEqual(['near', 'far']);
    expect(ranked[0].score).toBeCloseTo(1, 6);
  });
  it('skips candidates with no usable fingerprint', () => {
    expect(rankTemplates(fp, [{ templateId: 'x', fingerprints: [] }, { templateId: 'y', fingerprints: [buildFingerprint({})] }]))
      .toEqual([]);
  });
  it('breaks a score tie on the id so the answer never flickers', () => {
    const same = [buildFingerprint({ issuerName: 'ΚΑΠΑΛΙΝΕ ΑΕ', text: TEXT, aspect: 0.707 })];
    const ranked = rankTemplates(fp, [{ templateId: 'b', fingerprints: same }, { templateId: 'a', fingerprints: same }]);
    expect(ranked.map((r) => r.templateId)).toEqual(['a', 'b']);
  });
  it('thresholds are the ones the recogniser documents', () => {
    expect(MATCH_THRESHOLD).toBe(0.55);
    expect(AMBIGUITY_GAP).toBe(0.1);
  });
});

describe('toFingerprint', () => {
  it('reads a stored fingerprint back, dropping junk', () => {
    expect(toFingerprint({ afm: '123456789', issuer: 'Χ', words: ['ΑΑΑΑ', 5, 'ΒΒΒΒ'], aspect: 0.7 }))
      .toEqual({ afm: '123456789', issuer: 'Χ', words: ['ΑΑΑΑ', 'ΒΒΒΒ'], aspect: 0.7 });
  });
  it('is null for anything that is not a fingerprint', () => {
    expect(toFingerprint(null)).toBeNull();
    expect(toFingerprint('x')).toBeNull();
    expect(toFingerprint([])).toBeNull();
  });
});
