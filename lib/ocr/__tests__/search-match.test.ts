// lib/ocr/__tests__/search-match.test.ts
// Η αναζήτηση λογαριασμών πρέπει να βρίσκει ό,τι πληκτρολογεί ΑΝΘΡΩΠΟΣ: χωρίς τόνους,
// με κεφαλαία, χωρίς τις τελείες του κωδικού.
import { describe, it, expect } from 'vitest';
import { foldGreek, foldCode, matchesQuery } from '../search-match';

const ACCOUNT = { code: '64.00.23', name: 'Έξοδα Κίνησης 24%' };

describe('foldGreek', () => {
  it('ΤΕΛΙΚΟ ΣΙΓΜΑ: το ίδιο το toLowerCase το παράγει', () => {
    // Αυτό ήταν το σφάλμα: «ΚΙΝΗΣ».toLowerCase() δίνει «κινης» (U+03C2), και η αντικατάσταση
    // έτρεχε ΠΡΙΝ — οπότε κάθε αναζήτηση με κεφαλαία που τελειώνει σε Σ έβγαζε μηδέν.
    expect(foldGreek('ΚΙΝΗΣ')).toBe('κινησ');
    expect(foldGreek('ΚΙΝΗΣΗΣ')).toBe('κινησησ');
    expect(foldGreek('κινήσεως')).toBe('κινησεωσ');
  });

  it('τόνοι και διαλυτικά φεύγουν', () => {
    expect(foldGreek('Έξοδα')).toBe('εξοδα');
    expect(foldGreek('Ενοίκιο')).toBe('ενοικιο');
    expect(foldGreek('προϋπολογισμός')).toBe('προυπολογισμοσ');
  });
});

describe('foldCode', () => {
  it('βγάζει ό,τι δεν είναι γράμμα ή ψηφίο', () => {
    expect(foldCode('64.00.23')).toBe('640023');
    expect(foldCode('6400')).toBe('6400');
    // Τα ελληνικά ΔΕΝ είναι [a-zA-Z], οπότε πέφτουν — ο κωδικός συγκρίνεται λατινικά/αριθμητικά.
    expect(foldCode('ΠΡ-AN-IRIS')).toBe('aniris');
  });
});

describe('matchesQuery — όπως πληκτρολογεί άνθρωπος', () => {
  const m = (q: string) => matchesQuery(q, ACCOUNT.code, ACCOUNT.name);

  it('ΚΕΦΑΛΑΙΑ χωρίς τόνο βρίσκουν πεζά με τόνο', () => {
    expect(m('ΚΙΝΗΣ')).toBe(true);
    expect(m('ΕΞΟΔΑ')).toBe(true);
    expect(m('ΕΞΟΔΑ ΚΙΝΗΣ')).toBe(true);
  });

  it('πεζά με ή χωρίς τόνο', () => {
    expect(m('κινησ')).toBe(true);
    expect(m('κίνησης')).toBe(true);
  });

  it('ΚΩΔΙΚΟΣ χωρίς τελείες', () => {
    expect(m('6400')).toBe(true);
    expect(m('64.00')).toBe(true);
    expect(m('640023')).toBe(true);
  });

  it('κενό ερώτημα ανοίγει ΟΛΗ τη λίστα', () => {
    // Μια λίστα που απαιτεί να μαντέψεις τα δύο πρώτα γράμματα είναι άχρηστη.
    expect(m('')).toBe(true);
    expect(m('   ')).toBe(true);
  });

  it('άσχετο ερώτημα δεν ταιριάζει', () => {
    expect(m('ενοικιο')).toBe(false);
    expect(m('9999')).toBe(false);
  });

  it('κενά πεδία μητρώου δεν ρίχνουν τίποτα', () => {
    expect(matchesQuery('κατι', null, null)).toBe(false);
    expect(matchesQuery('', null, null)).toBe(true);
  });
});
