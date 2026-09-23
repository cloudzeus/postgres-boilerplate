// lib/ocr/__tests__/vat-map.test.ts
// Συντελεστής γραμμής → κωδικός κατηγορίας ΦΠΑ του SoftOne. Καθαρή λογική, χωρίς I/O.
//
// Τα δεδομένα των τεστ είναι το ΠΡΑΓΜΑΤΙΚΟ μητρώο της εγκατάστασης (διαβασμένο από τον τοπικό
// καθρέφτη), γιατί ακριβώς εκεί κρύβεται το πρόβλημα: οι μηδενικές κατηγορίες έρχονται με
// `rate: null`.
import { describe, it, expect } from 'vitest';
import {
  buildVatRateMap, missingVatRates, parseVatRateOverrides, suggestVatCategories, type VatCategoryLite,
} from '../vat-map';

/** Το μητρώο του πελάτη, ταξινομημένο όπως το διαβάζει η καταχώριση (`order`, `code`). */
const REGISTRY: VatCategoryLite[] = [
  { code: '0', descr: 'Μηδενικός Συντελεστής ΦΠΑ 0%', rate: null, isActive: true },
  { code: 'NORMAL', descr: 'Κανονικό (24%)', rate: 24, isActive: false },
  { code: '1', descr: 'Μηδενικός Συντελεστής ΦΠΑ 0%', rate: null, isActive: true },
  { code: '1000', descr: 'Άρθρο 39α 0%', rate: null, isActive: true },
  { code: '1040', descr: 'ΦΠΑ 4%', rate: 4, isActive: true },
  { code: '1060', descr: 'ΦΠΑ 6%', rate: 6, isActive: true },
  { code: '1091', descr: 'ΦΠΑ 9% Νέος Συντελεστής', rate: 9, isActive: true },
  { code: '1131', descr: 'ΦΠΑ 13% Νέος Συντελεστής', rate: 13, isActive: true },
  { code: '1170', descr: 'ΦΠΑ 17%', rate: 17, isActive: true },
  { code: '1410', descr: 'ΦΠΑ 24%', rate: 24, isActive: true },
  { code: '2410', descr: '2 ΦΠΑ 24%', rate: 24, isActive: true },
];

describe('ο αυτόματος χάρτης από το μητρώο', () => {
  it('δίνει τους συντελεστές που ΔΗΛΩΝΕΙ το SoftOne', () => {
    const { byRate } = buildVatRateMap(REGISTRY);
    expect(byRate).toMatchObject({ 4: 1040, 6: 1060, 9: 1091, 13: 1131, 17: 1170, 24: 1410 });
  });

  /** Δύο ενεργές κατηγορίες 24 % (1410, 2410): ο κωδικός δεν επιτρέπεται να αλλάζει τυχαία. */
  it('πρώτος κερδίζει όταν δύο κατηγορίες έχουν τον ίδιο συντελεστή', () => {
    expect(buildVatRateMap(REGISTRY).byRate[24]).toBe(1410);
  });

  it('ανενεργή κατηγορία δεν μπαίνει ποτέ στον χάρτη', () => {
    const { byRate } = buildVatRateMap([{ code: '9999', descr: 'παλιό', rate: 3, isActive: false }]);
    expect(byRate[3]).toBeUndefined();
  });

  /**
   * ΤΟ ΚΑΡΦΙ. Οι τρεις μηδενικές κατηγορίες υπάρχουν και είναι ενεργές, αλλά το SoftOne δεν
   * δηλώνει ποσοστό για καμία — άρα κανένας αυτόματος χάρτης δεν μπορεί να βγάλει κλειδί `0`.
   */
  it('το 0 % ΔΕΝ προκύπτει αυτόματα: οι μηδενικές κατηγορίες έχουν κενό rate', () => {
    expect(buildVatRateMap(REGISTRY).byRate[0]).toBeUndefined();
  });
});

describe('η χειροκίνητη αντιστοίχιση', () => {
  it('γεμίζει το κενό του 0 % με κωδικό που διάλεξε άνθρωπος', () => {
    const { byRate, overridden } = buildVatRateMap(REGISTRY, { '0': '1000' });
    expect(byRate[0]).toBe(1000);
    expect(overridden).toContain(0);
  });

  it('νικά τον αυτόματο χάρτη — είναι ρητή απόφαση', () => {
    const { byRate } = buildVatRateMap(REGISTRY, { '24': '2410' });
    expect(byRate[24]).toBe(2410);
  });

  /** Κωδικός που δεν υπάρχει (ή ανενεργός) ΔΕΝ εφαρμόζεται: το SoftOne θα τον απέρριπτε. */
  it('αγνοεί κωδικό εκτός μητρώου και το αναφέρει', () => {
    const { byRate, ignored } = buildVatRateMap(REGISTRY, { '0': '7777' });
    expect(byRate[0]).toBeUndefined();
    expect(ignored).toEqual([{ rate: 0, code: '7777' }]);
  });

  it('αγνοεί κωδικό ανενεργής κατηγορίας', () => {
    const { byRate, ignored } = buildVatRateMap(REGISTRY, { '24.5': 'NORMAL' });
    expect(byRate[24.5]).toBeUndefined();
    expect(ignored).toHaveLength(1);
  });
});

describe('ανάγνωση της ρύθμισης', () => {
  it('δέχεται μόνο ζεύγη αριθμού → κωδικού', () => {
    expect(parseVatRateOverrides({ '0': '1000', '13': '1131' })).toEqual({ '0': '1000', '13': '1131' });
  });
  it('αγνοεί σκουπίδια χωρίς να πετάει', () => {
    expect(parseVatRateOverrides(null)).toEqual({});
    expect(parseVatRateOverrides('0=1000')).toEqual({});
    expect(parseVatRateOverrides(['0', '1000'])).toEqual({});
    expect(parseVatRateOverrides({ abc: '1000', '6': '', '-1': '1' })).toEqual({});
  });
  it('κανονικοποιεί το κλειδί (κόμμα, μηδενικά)', () => {
    expect(parseVatRateOverrides({ '0,0': '1000' })).toEqual({ '0': '1000' });
    expect(parseVatRateOverrides({ '06': '1060' })).toEqual({ '6': '1060' });
  });
});

describe('ποιοι συντελεστές λείπουν', () => {
  const { byRate } = buildVatRateMap(REGISTRY);

  /** Οι πέντε γραμμές του παραστατικού της ENERGA: 13, 6, 6, 0, 0. */
  it('το πραγματικό παραστατικό δείχνει ΜΟΝΟ το 0 %', () => {
    expect(missingVatRates([13, 6, 6, 0, 0], byRate)).toEqual([0]);
  });

  it('δεν επαναλαμβάνει τον ίδιο συντελεστή', () => {
    expect(missingVatRates([0, 0, 0], byRate)).toEqual([0]);
  });

  it('γραμμή χωρίς συντελεστή αναφέρεται ως null', () => {
    expect(missingVatRates([null, 24], byRate)).toEqual([null]);
  });

  it('με τη χειροκίνητη αντιστοίχιση δεν λείπει τίποτα', () => {
    const fixed = buildVatRateMap(REGISTRY, { '0': '1000' }).byRate;
    expect(missingVatRates([13, 6, 6, 0, 0], fixed)).toEqual([]);
  });
});

describe('οι προτεινόμενες κατηγορίες', () => {
  it('βάζουν πρώτες όσες γράφουν το ποσοστό στην περιγραφή τους', () => {
    const s = suggestVatCategories(REGISTRY, 0);
    expect(s.slice(0, 3).map((r) => r.code)).toEqual(['0', '1', '1000']);
  });

  it('δεν κρύβουν ποτέ τις υπόλοιπες — η απόφαση είναι του χρήστη', () => {
    const s = suggestVatCategories(REGISTRY, 0);
    expect(s).toHaveLength(REGISTRY.filter((r) => r.isActive !== false).length);
  });

  it('δεν προτείνουν ανενεργές κατηγορίες', () => {
    expect(suggestVatCategories(REGISTRY, 24).some((r) => r.code === 'NORMAL')).toBe(false);
  });

  it('χωρίς συντελεστή δίνουν όλο το ενεργό μητρώο', () => {
    expect(suggestVatCategories(REGISTRY, null).map((r) => r.code)).not.toContain('NORMAL');
  });
});
