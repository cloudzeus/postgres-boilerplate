import { describe, it, expect } from 'vitest';
import {
  applyNameCase, stripGreekTonos, parseNameCase, finalItemNames, needsAccenting, acceptAccented, foldForCompare, looksForeign,
} from '@/lib/item-naming';

describe('applyNameCase', () => {
  it('κεφαλαία: χωρίς τόνους, με διαλυτικά όπου χρειάζονται', () => {
    expect(applyNameCase('Κάδος απορριμμάτων 120 lt', 'upper')).toBe('ΚΑΔΟΣ ΑΠΟΡΡΙΜΜΑΤΩΝ 120 LT');
    expect(applyNameCase('ταΐστρα', 'upper')).toBe('ΤΑΪΣΤΡΑ');
    expect(applyNameCase('Ψάρι κατεψυγμένο', 'upper')).not.toMatch(/[ΆΈΉΊΌΎΏ]/);
  });
  it('πεζά: τελικό ς, κρατά τους υπάρχοντες τόνους', () => {
    expect(applyNameCase('ΔΟΧΕΙΟ ΨΕΚΑΣΤΗΡΩΝ ΟΔΟΣ', 'lower')).toBe('δοχειο ψεκαστηρων οδος');
    expect(applyNameCase('Σωλήνας Γαλβανιζέ Ø80mm', 'lower')).toBe('σωλήνας γαλβανιζέ ø80mm');
  });
  it('όπως γράφονται: μόνο καθάρισμα κενών και όριο 128', () => {
    expect(applyNameCase('  Βίδα   M8  ', 'asis')).toBe('Βίδα M8');
    expect(applyNameCase('x'.repeat(200), 'asis')).toHaveLength(128);
  });
  it('λατινικά διακριτικά δεν πειράζονται', () => {
    expect(stripGreekTonos('CAFFÈ ΆΛΦΑ')).toBe('CAFFÈ ΑΛΦΑ');
  });
  it('άγνωστη τιμή ρύθμισης ⇒ όπως γράφονται', () => {
    expect(parseNameCase('xyz')).toBe('asis');
    expect(parseNameCase(undefined)).toBe('asis');
  });
});

describe('finalItemNames', () => {
  it('μετάφραση: ελληνικά στο NAME, αρχική στο NAME1 με την ίδια μορφή', () => {
    expect(finalItemNames('Σωλήνας λείος', 'TUBO smooth', 'upper')).toEqual({ name: 'ΣΩΛΗΝΑΣ ΛΕΙΟΣ', name1: 'TUBO SMOOTH' });
  });
  it('χωρίς αρχική ή ίδια με το όνομα ⇒ NAME1 κενό', () => {
    expect(finalItemNames('Βίδα', null, 'asis').name1).toBeNull();
    expect(finalItemNames('ΒΙΔΑ', 'Βίδα', 'upper').name1).toBeNull();
  });
});

describe('τονισμός πεζών', () => {
  it('χρειάζεται τονισμό μόνο ελληνικό κείμενο χωρίς ούτε έναν τόνο', () => {
    expect(needsAccenting('δοχειο ψεκαστηρων')).toBe(true);
    expect(needsAccenting('δοχείο ψεκαστήρων')).toBe(false);
    expect(needsAccenting('tubo avv d80')).toBe(false);
  });
  it('δεκτό μόνο αν άλλαξαν αποκλειστικά τόνοι', () => {
    expect(acceptAccented('δοχειο ψεκαστηρων 5lt', 'Δοχείο ψεκαστήρων 5lt')).toBe('δοχείο ψεκαστήρων 5lt');
    // «διόρθωσε» γράμμα ή αριθμό ⇒ απόρριψη
    expect(acceptAccented('δοχειο ψεκαστηρων 5lt', 'δοχείο ψεκαστήρα 5lt')).toBeNull();
    expect(acceptAccented('δοχειο 5lt', 'δοχείο 6lt')).toBeNull();
    expect(acceptAccented('δοχειο', '')).toBeNull();
  });
  it('η σύγκριση αγνοεί τόνους, διαλυτικά, πεζά/κεφαλαία και τελικό ς', () => {
    expect(foldForCompare('Ταΐζω ΟΔΟΣ')).toBe(foldForCompare('ταιζω οδοσ'));
  });
});

describe('looksForeign', () => {
  it('λατινικά > ελληνικά ⇒ ξένη περιγραφή', () => {
    expect(looksForeign('TUBO AVV D80 4M')).toBe(true);
    expect(looksForeign('ΣΩΛΗΝΑΣ D80')).toBe(false);
  });
});
