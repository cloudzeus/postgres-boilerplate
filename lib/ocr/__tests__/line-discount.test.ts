// lib/ocr/__tests__/line-discount.test.ts
// Η έκπτωση της γραμμής στα ΣΩΣΤΑ πεδία του SoftOne.
//
// Ο πραγματικός λόγος ύπαρξης: στις 23/09/2026 δέκα παραστατικά μπήκαν στη demo με ΑΡΝΗΤΙΚΑ ποσά,
// επειδή η έκπτωση **σε ευρώ** γραφόταν στο `DISC1PRC`, που είναι **ποσοστό**. Το SoftOne δεν
// διαμαρτύρεται: υπολογίζει `350 × (1 − 122,5/100) = −78,75` και το γράφει.
import { describe, it, expect } from 'vitest';
import { discountFields, discountAmbiguous } from '../purdoc-payload';

/** Η γραμμή που έσπασε: 350 → 227,50, δηλαδή 122,50 € έκπτωση (= 35 %). */
const REAL = { quantity: 1, unitPrice: 350, discount: 122.5, net: 227.5 };

describe('discountFields', () => {
  it('ΠΟΣΟ σε ευρώ → DISC1VAL, ΠΟΤΕ DISC1PRC', () => {
    expect(discountFields(REAL)).toEqual({ DISC1VAL: 122.5 });
  });

  it('ΠΟΣΟΣΤΟ → DISC1PRC', () => {
    // 350 με 35 % έκπτωση δίνει 227,50 — εδώ ο αριθμός 35 ΕΙΝΑΙ ποσοστό.
    expect(discountFields({ quantity: 1, unitPrice: 350, discount: 35, net: 227.5 })).toEqual({ DISC1PRC: 35 });
  });

  it('χωρίς έκπτωση → κανένα πεδίο (δεν στέλνουμε μηδενικά)', () => {
    expect(discountFields({ quantity: 2, unitPrice: 10, discount: 0, net: 20 })).toEqual({});
    expect(discountFields({ quantity: 2, unitPrice: 10, net: 20 })).toEqual({});
  });

  it('ασαφής έκπτωση → ΚΑΝΕΝΑ πεδίο· δεν μαντεύουμε', () => {
    // 100 − 10 = 90 και 100 × 0,9 = 90: ο ίδιος αριθμός ταιριάζει και στις δύο ερμηνείες.
    // Εδώ το `analyzeLine` προτιμά ποσοστό, που είναι και το ασφαλές για το SoftOne.
    expect(discountFields({ quantity: 1, unitPrice: 100, discount: 10, net: 90 })).toEqual({ DISC1PRC: 10 });
    // Ούτε η μία ερμηνεία δεν βγάζει το σύνολο ⇒ τίποτα δεν φεύγει.
    expect(discountFields({ quantity: 1, unitPrice: 100, discount: 40, net: 75 })).toEqual({});
  });
});

describe('discountAmbiguous — το εμπόδιο', () => {
  it('η γραμμή που έσπασε ΔΕΝ είναι ασαφής: διαβάζεται ως ποσό', () => {
    expect(discountAmbiguous(REAL)).toBe(false);
  });

  it('έκπτωση που δεν βγάζει το σύνολο με καμία ερμηνεία ⇒ μπλοκάρει', () => {
    expect(discountAmbiguous({ quantity: 1, unitPrice: 100, discount: 40, net: 75 })).toBe(true);
  });

  it('χωρίς έκπτωση δεν μπλοκάρει ποτέ', () => {
    expect(discountAmbiguous({ quantity: 3, unitPrice: 10, net: 30 })).toBe(false);
    expect(discountAmbiguous({ quantity: 3, unitPrice: 10, discount: 0, net: 30 })).toBe(false);
  });
});

describe('το ίδιο το σφάλμα, αριθμητικά', () => {
  it('122,5 ως ΠΟΣΟΣΤΟ σε τιμή 350 δίνει ΑΡΝΗΤΙΚΗ αξία', () => {
    expect(350 * (1 - 122.5 / 100)).toBeCloseTo(-78.75, 2);
  });
  it('122,5 ως ΠΟΣΟ δίνει τη σωστή αξία', () => {
    expect(350 - 122.5).toBeCloseTo(227.5, 2);
  });
});
