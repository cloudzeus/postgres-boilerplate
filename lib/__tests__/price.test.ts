// lib/__tests__/price.test.ts
// Χονδρική → λιανική. Καθαρή λογική, κανένα I/O.
import { describe, it, expect } from 'vitest';
import { retailFromWholesale, roundPrice, PRICE_DECIMALS } from '../price';
import { disambiguateLabels } from '../unique-labels';

describe('retailFromWholesale', () => {
  it('24% πάνω στα 10 → 12,40 (και όχι 12.400000000000002)', () => {
    expect(retailFromWholesale(10, 24)).toBe(12.4);
  });

  it('13% και 6% όπως τα περιμένει ο λογιστής', () => {
    expect(retailFromWholesale(100, 13)).toBe(113);
    expect(retailFromWholesale(8.5, 6)).toBe(9.01);
  });

  it('μηδενικός συντελεστής αφήνει την τιμή ως έχει', () => {
    expect(retailFromWholesale(10, 0)).toBe(10);
  });

  it('χωρίς ποσοστό (π.χ. «Άρθρο 39α») ΔΕΝ παράγεται λιανική', () => {
    expect(retailFromWholesale(10, null)).toBeNull();
  });

  it('χωρίς χονδρική δεν υπάρχει τίποτα να υπολογιστεί', () => {
    expect(retailFromWholesale(null, 24)).toBeNull();
    expect(retailFromWholesale(Number.NaN, 24)).toBeNull();
  });

  it('στρογγυλοποιεί στα δεκαδικά που έχουμε δηλώσει, χωρίς να χάνει λεπτό', () => {
    expect(PRICE_DECIMALS).toBe(4);
    expect(retailFromWholesale(1.23456, 24)).toBe(roundPrice(1.23456 * 1.24));
    expect(String(retailFromWholesale(1.23456, 24)).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(4);
  });
});

describe('disambiguateLabels — δύο ίδιες ετικέτες δεν είναι επιλογή', () => {
  it('μόνο οι ΕΠΑΝΑΛΑΜΒΑΝΟΜΕΝΕΣ ετικέτες παίρνουν τον κωδικό τους', () => {
    const out = disambiguateLabels([
      { code: '1', label: 'Μηδενικός Συντελεστής ΦΠΑ (0%)' },
      { code: '7', label: 'Μηδενικός Συντελεστής ΦΠΑ (0%)' },
      { code: '3', label: 'Κανονικός (24%)' },
    ]);
    expect(out.map((o) => o.label)).toEqual([
      'Μηδενικός Συντελεστής ΦΠΑ (0%) · κωδ. 1',
      'Μηδενικός Συντελεστής ΦΠΑ (0%) · κωδ. 7',
      'Κανονικός (24%)',
    ]);
  });

  it('ο κωδικός δεν αλλάζει ποτέ — είναι η τιμή που φεύγει στο SoftOne', () => {
    const out = disambiguateLabels([{ code: 'A', label: 'X' }, { code: 'B', label: 'X' }]);
    expect(out.map((o) => o.code)).toEqual(['A', 'B']);
  });

  /**
   * Η παγίδα που χτύπησε ζωντανά: κωδικοί «0» και «1» με ετικέτα «… ΦΠΑ 0%». Ένα `includes`
   * πετύχαινε τυχαία μέσα στο «0%» και άφηνε τη ΜΙΑ από τις δύο διπλές χωρίς κωδικό — δηλαδή
   * πάλι αδιάκριτες. Και οι δύο πρέπει να τον παίρνουν.
   */
  it('μονοψήφιος κωδικός που τυχαίνει να υπάρχει στο κείμενο δεν ακυρώνει τη διάκριση', () => {
    const out = disambiguateLabels([
      { code: '0', label: 'Μηδενικός Συντελεστής ΦΠΑ 0%' },
      { code: '1', label: 'Μηδενικός Συντελεστής ΦΠΑ 0%' },
    ]);
    expect(out.map((o) => o.label)).toEqual([
      'Μηδενικός Συντελεστής ΦΠΑ 0% · κωδ. 0',
      'Μηδενικός Συντελεστής ΦΠΑ 0% · κωδ. 1',
    ]);
  });
});
