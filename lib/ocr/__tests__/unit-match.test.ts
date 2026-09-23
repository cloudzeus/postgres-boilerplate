// lib/ocr/__tests__/unit-match.test.ts
// Τυπωμένη μονάδα γραμμής → μονάδα μητρώου (MTRUNIT). Καθαρή λογική, χωρίς I/O.
//
// Ο κανόνας: ταιριάζουμε ΜΟΝΟ ό,τι είναι αναμφισβήτητο. Το «δεν βρέθηκε» είναι έγκυρη απάντηση
// και ΠΡΕΠΕΙ να φτάνει στον χρήστη — το παλιό σιωπηλό «ΤΕΜΑΧΙΑ για όλα» ήταν ο λόγος που μια
// χρέωση ρεύματος σε KWh θα γραφόταν στο SoftOne ως τεμάχια.
import { describe, it, expect } from 'vitest';
import { matchUnit, unitOptions, foldUnit, type UnitOption } from '../unit-match';

/** Το πραγματικό μητρώο MTRUNIT της εγκατάστασης. */
const UNITS: UnitOption[] = [
  { code: '100', name: 'MM [SoftOne]' },
  { code: '101', name: 'Τεμάχια' },
  { code: '107', name: 'Κιβώτια' },
  { code: '108', name: 'Πακέτο' },
  { code: '109', name: 'Σελίδα' },
  { code: '120', name: 'Μέτρα' },
  { code: '130', name: 'Τετρ. Μέτρα' },
  { code: '140', name: 'Κυβικά Μέτρα' },
  { code: '141', name: 'Λίτρα' },
  { code: '150', name: 'Κιλά' },
  { code: '151', name: 'Τόννοι' },
  { code: '200', name: 'Ώρες' },
];

describe('η μονάδα που ΔΕΝ υπάρχει', () => {
  /**
   * Το καρφί του παραστατικού της ENERGA. Το μητρώο δεν έχει μονάδα ενέργειας· η σωστή απάντηση
   * είναι «δεν ξέρω», ώστε το UI να το πει και να ζητήσει επιλογή.
   */
  it('KWh δεν ταιριάζει πουθενά — και ΔΕΝ γίνεται ΤΕΜ', () => {
    expect(matchUnit('KWh', UNITS)).toBeNull();
    expect(matchUnit('kWh', UNITS)).toBeNull();
    expect(matchUnit('ΚWh', UNITS)).toBeNull();  // με ελληνικό Κ — ομόγλυφο
  });

  it('κενή ή άγνωστη μονάδα ⇒ null', () => {
    expect(matchUnit('', UNITS)).toBeNull();
    expect(matchUnit(null, UNITS)).toBeNull();
    expect(matchUnit(undefined, UNITS)).toBeNull();
    expect(matchUnit('   ', UNITS)).toBeNull();
    expect(matchUnit('Nm³', UNITS)).toBeNull();
  });

  it('χωρίς μητρώο δεν ταιριάζει τίποτα', () => {
    expect(matchUnit('ΤΕΜ', [])).toBeNull();
  });
});

describe('ακριβές ταίριασμα στο όνομα του μητρώου', () => {
  it('ίδιο όνομα, με ή χωρίς τόνους και πεζά/κεφαλαία', () => {
    expect(matchUnit('Τεμάχια', UNITS)).toMatchObject({ code: '101', matchedBy: 'exact' });
    expect(matchUnit('ΤΕΜΑΧΙΑ', UNITS)).toMatchObject({ code: '101' });
    expect(matchUnit('τεμαχια', UNITS)).toMatchObject({ code: '101' });
    expect(matchUnit('Ώρες', UNITS)).toMatchObject({ code: '200', matchedBy: 'exact' });
  });

  it('η ετικέτα προέλευσης του μητρώου δεν εμποδίζει («MM [SoftOne]» ≡ «MM»)', () => {
    expect(matchUnit('MM', UNITS)).toMatchObject({ code: '100' });
  });
});

describe('ρητά συνώνυμα', () => {
  it('οι συντμήσεις του τιμολογίου', () => {
    expect(matchUnit('ΤΕΜ', UNITS)).toMatchObject({ code: '101', matchedBy: 'synonym' });
    expect(matchUnit('τμχ', UNITS)).toMatchObject({ code: '101' });
    expect(matchUnit('pcs', UNITS)).toMatchObject({ code: '101' });
    expect(matchUnit('KG', UNITS)).toMatchObject({ code: '150' });
    expect(matchUnit('LT', UNITS)).toMatchObject({ code: '141' });
    expect(matchUnit('m2', UNITS)).toMatchObject({ code: '130' });
    expect(matchUnit('M3', UNITS)).toMatchObject({ code: '140' });
    expect(matchUnit('ώρες', UNITS)).toMatchObject({ code: '200' });
  });

  /** Το σκέτο «m» λείπει επίτηδες: το μητρώο έχει και «MM», και η εικασία δεν αξίζει. */
  it('το διφορούμενο «m» δεν ταιριάζει', () => {
    expect(matchUnit('m', UNITS)).toBeNull();
  });

  it('συνώνυμο που δεν υπάρχει στο μητρώο δεν εφευρίσκεται', () => {
    expect(matchUnit('ΤΕΜ', [{ code: '150', name: 'Κιλά' }])).toBeNull();
  });
});

describe('κανονικοποίηση', () => {
  it('τόνοι, ομόγλυφα, κενά και τελείες φεύγουν', () => {
    expect(foldUnit('Τετρ. Μέτρα')).toBe(foldUnit('ΤΕΤΡΜΕΤΡΑ'));
    expect(foldUnit('Κιλά')).toBe(foldUnit('ΚΙΛΑ'));
  });
});

describe('η λίστα του dropdown', () => {
  it('βάζει πρώτη την πιθανή μονάδα, χωρίς να κρύψει καμία', () => {
    const opts = unitOptions('ΤΕΜ', UNITS);
    expect(opts[0].code).toBe('101');
    expect(opts).toHaveLength(UNITS.length);
  });

  it('χωρίς ταίριασμα αφήνει τη σειρά του μητρώου ανέπαφη', () => {
    expect(unitOptions('KWh', UNITS).map((u) => u.code)).toEqual(UNITS.map((u) => u.code));
  });
});
