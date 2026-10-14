// Οι περιπτώσεις είναι ΠΡΑΓΜΑΤΙΚΕΣ αναγνώσεις της ουράς στις 2026-10-11.
import { describe, it, expect } from 'vitest';
import { afmRepairCandidates, namesMatch } from '../afm-repair';
import { isValidAfm } from '../validate';

describe('afmRepairCandidates', () => {
  it('Entersoft: «999867881» → το σωστό 999863881 είναι υποψήφιο (σύγχυση 3↔7)', () => {
    const c = afmRepairCandidates('999867881');
    expect(c).toContain('999863881');
    expect(c.every(isValidAfm)).toBe(true);
  });

  it('ΟΤΕ: «09401924» (8 ψηφία) → το 094019245 είναι ΠΡΩΤΟ (χαμένο τελευταίο ψηφίο)', () => {
    expect(afmRepairCandidates('09401924')[0]).toBe('094019245');
  });

  it('επιστρέφει ΜΟΝΟ έγκυρα, ποτέ το ίδιο το λάθος, και σέβεται το πλαφόν', () => {
    const c = afmRepairCandidates('998825619', 5);
    expect(c.length).toBeLessThanOrEqual(5);
    expect(c).not.toContain('998825619');
    expect(c.every(isValidAfm)).toBe(true);
  });

  it('άχρηστη είσοδος ⇒ κανένας υποψήφιος', () => {
    expect(afmRepairCandidates('')).toEqual([]);
    expect(afmRepairCandidates('12345')).toEqual([]);
  });
});

describe('namesMatch', () => {
  it.each([
    ['ΟΡΓΑΝΙΣΜΟΣ ΤΗΛΕΠΙΚΟΙΝΩΝΙΩΝ ΤΗΣ ΕΛΛΑΔΟΣ Α.Ε.', 'ΟΡΓΑΝΙΣΜΟΣ ΤΗΛΕΠΙΚΟΙΝΩΝΙΩΝ ΤΗΣ ΕΛΛΑΔΟΣ ΑΝΩΝΥΜΗ ΕΤΑΙΡΕΙΑ'],
    ['ENTERSOFT ΑΝΩΝΥΜΗ ΕΤΑΙΡΕΙΑ', 'ENTERSOFT ΑΝΩΝΥΜΗ ΕΤΑΙΡΕΙΑ ΠΑΡΟΧΗΣ ΛΥΣΕΩΝ ΛΟΓΙΣΜΙΚΟΥ'],
    ['PRICEWATERHOUSECOOPERS ACCOUNTING A.Ε.', 'PRICEWATERHOUSECOOPERS ACCOUNTING ΑΝΩΝΥΜΗ ΕΤΑΙΡΕΙΑ'],
    ['Ingenio Συστήματα Πληροφορικής Ε.Ε.', 'INGENIO ΣΥΣΤΗΜΑΤΑ ΠΛΗΡΟΦΟΡΙΚΗΣ ΕΤΕΡΟΡΡΥΘΜΗ ΕΤΑΙΡΕΙΑ'],
  ])('ίδια εταιρεία: «%s» ≈ «%s»', (a, b) => expect(namesMatch(a, b)).toBe(true));

  it.each([
    ['INGENIO ΣΥΣΤΗΜΑΤΑ ΠΛΗΡΟΦΟΡΙΚΗΣ Ε.Ε.', 'ΚΑΡΑΦΥΛΛΗΣ ΣΥΣΤΗΜΑΤΑ ΠΛΗΡΟΦΟΡΙΚΗΣ ΑΝΩΝΥΜΟΣ ΕΤΑΙΡΕΙΑ'],
    ['ENTERSOFT ΑΝΩΝΥΜΗ ΕΤΑΙΡΕΙΑ', 'ΠΑΠΑΔΟΠΟΥΛΟΣ ΓΕΩΡΓΙΟΣ'],
  ])('ΑΛΛΗ εταιρεία, ας μοιράζονται λέξεις: «%s» ≠ «%s»', (a, b) => expect(namesMatch(a, b)).toBe(false));
});

import { withoutRecipient } from '../afm-repair';

describe('withoutRecipient — ο παραλήπτης δεν είναι εκδότης', () => {
  it('αφαιρεί το ΑΦΜ του παραλήπτη και το δικό μας, ανεξάρτητα από πρόθεμα EL/κενά', () => {
    expect(withoutRecipient(['099095556', '094019245'], ['EL099095556', null])).toEqual(['094019245']);
    expect(withoutRecipient(['099095556'], [' 099 095 556 '])).toEqual([]);
    expect(withoutRecipient(['094019245'], [undefined, '', '123'])).toEqual(['094019245']);
  });
});
