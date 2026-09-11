// lib/ocr/__tests__/split.test.ts
// Πού κόβεται μια σαρωμένη στοίβα παραστατικών. Τα κείμενα είναι γραμμένα όπως βγαίνουν πραγματικά
// από το text layer ενός ελληνικού PDF — κεφαλίδα, ΑΦΜ, αριθμός, «σελ. k από N».
import { describe, it, expect } from 'vitest';
import {
  suggestSplits, segmentsOf, normalizeCuts, documentNumberOf, issuerAfmOf, pageMarkerOf,
} from '../split';

const page = (text: string) => ({ text });

// ΑΦΜ έγκυρα (mod-11): 999863881 (ΚΑΠΑΛΙΝΕ), 094014201 (ΟΤΕ), 998184801.
const A = '999863881';
const B = '094014201';

const invoiceP1 = (num: string, afm = A, marker = 'Σελίδα 1 από 3') => page(
  `ΚΑΠΑΛΙΝΕ Α.Ε.\nΑΦΜ: ${afm}  ΔΟΥ ΦΑΕ ΑΘΗΝΩΝ\nΤΙΜΟΛΟΓΙΟ ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙΩΝ\nΑριθμός: ${num}\n${marker}\nΠελάτης: DGESPA AE ΑΦΜ ${B}`,
);
const invoicePn = (num: string, k: number, of: number, afm = A) => page(
  `ΚΑΠΑΛΙΝΕ Α.Ε. ΑΦΜ ${afm}\nΑριθ. ${num}\nΣελ. ${k}/${of}\nΣΥΝΕΧΕΙΑ ΓΡΑΜΜΩΝ`,
);

describe('ανιχνευτές σελίδας', () => {
  it('διαβάζει τον δείκτη σελίδας σε ελληνικά και αγγλικά', () => {
    expect(pageMarkerOf('Σελίδα 1 από 3')).toEqual({ page: 1, of: 3 });
    expect(pageMarkerOf('ΣΕΛ. 2/3')).toEqual({ page: 2, of: 3 });
    expect(pageMarkerOf('Page 1 of 2')).toEqual({ page: 1, of: 2 });
    expect(pageMarkerOf('χωρίς δείκτη')).toBeNull();
    expect(pageMarkerOf('Σελίδα 5 από 2')).toBeNull();     // αδύνατο → αγνοείται
  });

  it('διαβάζει τον αριθμό παραστατικού μόνο όταν είναι ετικετοποιημένος', () => {
    expect(documentNumberOf('Αριθμός: ΤΠΥ-17')).toBe('ΤΠΥ17');
    expect(documentNumberOf('ΑΡ. ΠΑΡΑΣΤΑΤΙΚΟΥ 1032')).toBe('1032');
    expect(documentNumberOf('No. INV/2026/44')).toBe('INV202644');
    expect(documentNumberOf('ΣΥΝΟΛΟ 1.234,56 ΕΥΡΩ')).toBeNull();
  });

  it('διαβάζει το ΠΡΩΤΟ έγκυρο ΑΦΜ και αγνοεί τα άκυρα', () => {
    expect(issuerAfmOf(`ΑΦΜ: ${A} Πελάτης ΑΦΜ ${B}`)).toBe(A);
    expect(issuerAfmOf(`Α.Φ.Μ. EL${A}`)).toBe(A);
    expect(issuerAfmOf('ΑΦΜ: 123456789')).toBeNull();      // κόβεται στο mod-11
    expect(issuerAfmOf('τηλ 2101234567')).toBeNull();
  });
});

describe('suggestSplits', () => {
  it('τριασέλιδο τιμολόγιο και μετά μονοσέλιδο → δύο παραστατικά', () => {
    const pages = [
      invoiceP1('ΤΠΥ-17'),
      invoicePn('ΤΠΥ-17', 2, 3),
      invoicePn('ΤΠΥ-17', 3, 3),
      invoiceP1('ΤΠΥ-18', A, 'Σελίδα 1 από 1'),
    ];
    expect(suggestSplits(pages)).toEqual([0, 3]);
    expect(segmentsOf(suggestSplits(pages), 4)).toEqual([{ from: 0, to: 2 }, { from: 3, to: 3 }]);
  });

  it('«σελ. 1 από N» ανοίγει νέο παραστατικό ακόμη και με ίδιο εκδότη και χωρίς αριθμό', () => {
    const pages = [
      page('ΚΑΠΑΛΙΝΕ ΑΕ ΑΦΜ 999863881 Σελίδα 1 από 2'),
      page('ΚΑΠΑΛΙΝΕ ΑΕ ΑΦΜ 999863881 Σελ. 2/2'),
      page('ΚΑΠΑΛΙΝΕ ΑΕ ΑΦΜ 999863881 Σελίδα 1 από 2'),
      page('ΚΑΠΑΛΙΝΕ ΑΕ ΑΦΜ 999863881 Σελ. 2/2'),
    ];
    expect(suggestSplits(pages)).toEqual([0, 2]);
  });

  it('«σελ. k από N» με k>1 μένει συνέχεια ακόμη κι αν ο αριθμός διαβάστηκε λάθος', () => {
    const pages = [
      invoiceP1('ΤΠΥ-17'),
      invoicePn('ΤΠΥ-17', 2, 3),                            // OCR έφαγε το «7»
      invoicePn('ΤΠΥ-17', 3, 3),
    ];
    expect(suggestSplits(pages)).toEqual([0]);
  });

  it('αλλαγή αριθμού παραστατικού χωρίς δείκτη σελίδας → νέο', () => {
    const pages = [
      page('ΚΑΠΑΛΙΝΕ ΑΕ ΑΦΜ 999863881 Αριθμός: 1001 ΣΥΝΟΛΟ 124,00'),
      page('ΚΑΠΑΛΙΝΕ ΑΕ ΑΦΜ 999863881 Αριθμός: 1002 ΣΥΝΟΛΟ 248,00'),
    ];
    expect(suggestSplits(pages)).toEqual([0, 1]);
  });

  it('αλλαγή ΑΦΜ εκδότη → νέο, ακόμη κι αν δεν υπάρχει αριθμός πουθενά', () => {
    const pages = [
      page('ΚΑΠΑΛΙΝΕ ΑΕ ΑΦΜ 999863881 ΤΙΜΟΛΟΓΙΟ'),
      page('ΟΤΕ ΑΕ ΑΦΜ 094014201 ΛΟΓΑΡΙΑΣΜΟΣ'),
    ];
    expect(suggestSplits(pages)).toEqual([0, 1]);
  });

  it('σελίδα χωρίς κανένα σήμα είναι συνέχεια', () => {
    const pages = [
      invoiceP1('ΤΠΥ-17'),
      page('συνέχεια πίνακα ειδών χωρίς κεφαλίδα'),
      page(''),
    ];
    expect(suggestSplits(pages)).toEqual([0]);
  });

  it('η ταυτότητα του τμήματος συμπληρώνεται από σελίδα-συνέχεια όταν λείπει από την πρώτη', () => {
    const pages = [
      page('εξώφυλλο χωρίς στοιχεία'),
      page('ΑΦΜ: 999863881 συνέχεια'),
      page('ΑΦΜ: 094014201 άλλος εκδότης'),
    ];
    expect(suggestSplits(pages)).toEqual([0, 2]);
  });

  it('ΣΑΡΩΜΕΝΟ PDF (καθόλου κείμενο) → ένα παραστατικό ανά σελίδα', () => {
    expect(suggestSplits([page(''), page('  '), page('\n')])).toEqual([0, 1, 2]);
  });

  it('μονοσέλιδο και άδειο', () => {
    expect(suggestSplits([page('οτιδήποτε')])).toEqual([0]);
    expect(suggestSplits([])).toEqual([]);
  });
});

describe('normalizeCuts / segmentsOf', () => {
  it('κρατάει πάντα το 0, πετάει διπλά και εκτός ορίων, ταξινομεί', () => {
    expect(normalizeCuts([3, 1, 1, 0, -2, 99, 2.7], 5)).toEqual([0, 1, 2, 3]);
    expect(normalizeCuts([], 3)).toEqual([0]);
  });

  it('τα τμήματα καλύπτουν ΟΛΕΣ τις σελίδες χωρίς κενό ή επικάλυψη', () => {
    const segs = segmentsOf([0, 2, 5], 7);
    expect(segs).toEqual([{ from: 0, to: 1 }, { from: 2, to: 4 }, { from: 5, to: 6 }]);
    expect(segs.reduce((n, s) => n + (s.to - s.from + 1), 0)).toBe(7);
  });
});
