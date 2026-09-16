// lib/__tests__/doc-reference.test.ts
// Η μία κανονικοποίηση σύγκρισης αναφορών — τη μοιράζονται το payload, ο έλεγχος διπλοεγγραφής
// και η επαλήθευση μετά την εγγραφή, οπότε ό,τι σπάσει εδώ σπάει και στα τρία.
import { describe, it, expect } from 'vitest';
import { normalizeDocRef } from '@/lib/doc-reference';

describe('normalizeDocRef', () => {
  it('αγνοεί διαχωριστικά και πεζά/κεφαλαία', () => {
    expect(normalizeDocRef('ΤΠΥ 17')).toBe(normalizeDocRef('τπυ-17'));
    expect(normalizeDocRef('ΤΠΥ/17')).toBe(normalizeDocRef('ΤΠΥ.17'));
  });

  it('διπλώνει τα ελληνικά ομόγλυφα σε λατινικά — η γραμμή 1042 του πελάτη είναι μεικτή', () => {
    // «ΤΙΜ-AA-2455»: ΤΙΜ ελληνικό (U+03A4 U+0399 U+039C), AA λατινικό (U+0041).
    expect(normalizeDocRef('ΤΙΜ-AA-2455')).toBe(normalizeDocRef('ΤΙΜ-ΑΑ-2455'));
    expect(normalizeDocRef('ΑΒΕΖΗΙΚΜΝΟΡΤΥΧ')).toBe('ABEZHIKMNOPTYX');
  });

  it('ΔΕΝ πειράζει τα ελληνικά γράμματα χωρίς λατινικό ομόγλυφο', () => {
    expect(normalizeDocRef('ΔΠ-0035656')).toBe('ΔΠ0035656');
    expect(normalizeDocRef('ΛΦΨΩΓΞΣΘ')).toBe('ΛΦΨΩΓΞΣΘ');
  });

  it('ο τόνος δεν καταπίνει τον χαρακτήρα', () => {
    expect(normalizeDocRef('ΤΊΜ')).toBe(normalizeDocRef('ΤΙΜ'));
    expect(normalizeDocRef('ΆΈΉΊΌΎΏ')).toBe('AEHIOY' + 'Ω');
  });

  it('κενό ή σκουπίδια → κενό (και άρα καμία σύγκριση δεν «περνά» κατά λάθος)', () => {
    expect(normalizeDocRef(null)).toBe('');
    expect(normalizeDocRef('---')).toBe('');
    expect(normalizeDocRef(undefined)).toBe('');
  });
});
