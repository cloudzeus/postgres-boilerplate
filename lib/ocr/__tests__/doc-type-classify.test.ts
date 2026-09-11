import { describe, it, expect } from 'vitest';
import {
  normalizeGreek, familyOf, seriesFamily, classifySeries, inferInvoiceKind, labelFromFileName,
  parseSeriesChoice, seriesKey, type SeriesCandidate,
} from '../doc-type-classify';
const C = (code: string, abbrev: string | null, name: string, kind: 'purchase' | 'creditor', sosource = kind === 'purchase' ? 1251 : 1653): SeriesCandidate => ({ code, abbrev, name, kind, sosource });
const purchases = [C('2061', 'ΤΙΜΑ', 'Τιμολόγιο Αγοράς', 'purchase'), C('2062', 'ΤΔΑΠ', 'Τιμολόγιο Αγοράς-Δελτίο Αποστολής', 'purchase'), C('2081', 'ΠΤΑ', 'Πιστωτικό Τιμολόγιο Αγοράς', 'purchase'), C('2041', 'ΔΕΑΠ', 'Δελτίο Αποστολής Προμηθευτή', 'purchase')];
const creditors = [C('1001', 'ΤΠΥ', 'Τιμολόγιο Παροχής Υπηρεσιών', 'creditor'), C('1002', 'ΑΠΥ', 'Απόδειξη Παροχής Υπηρεσιών', 'creditor'), C('1003', 'ΠΤΠΥ', 'Πιστωτικό Παροχής Υπηρεσιών', 'creditor')];
const all = [...purchases, ...creditors];

describe('normalizeGreek', () => {
  it('uppercases, strips accents and punctuation', () => { expect(normalizeGreek('Τιμολόγιο – Δελτίο Αποστολής')).toBe('ΤΙΜΟΛΟΓΙΟ ΔΕΛΤΙΟ ΑΠΟΣΤΟΛΗΣ'); });
  it.each([
    ['Δ.Α.', 'ΔΑ'], ['Τ.Δ.Α.', 'ΤΔΑ'], ['Δ.Αποστολής', 'Δ ΑΠΟΣΤΟΛΗΣ'], ['Τιμ. Παροχής Υπηρεσιών', 'ΤΙΜ ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙΩΝ'],
  ])('collapses abbreviation dots: %s → %s', (raw, out) => { expect(normalizeGreek(raw)).toBe(out); });
});
describe('seriesFamily', () => {
  it.each([
    [C('2061', 'ΤΙΜΑ', 'Τιμολόγιο Αγοράς', 'purchase'), 'TIM'],
    [C('2062', 'ΤΔΑΠ', 'Τιμολόγιο Αγοράς-Δελτίο Αποστολής', 'purchase'), 'TDA'],
    [C('2041', 'ΔΕΑΠ', 'Δελτίο Αποστολής Προμηθευτή', 'purchase'), 'DA'],
    [C('2081', 'ΠΤΑ', 'Πιστωτικό Τιμολόγιο Αγοράς', 'purchase'), 'PT'],
    [C('1001', 'ΤΠΥ', 'Τιμολόγιο Παροχής Υπηρεσιών', 'creditor'), 'TPY'],
    [C('1002', 'ΑΠΥ', 'Απόδειξη Παροχής Υπηρεσιών', 'creditor'), 'APY'],
    [C('9999', null, 'Άγνωστη σειρά', 'creditor'), null],
  ])('%o → %s', (cand, fam) => { expect(seriesFamily(cand as SeriesCandidate)).toBe(fam); });
});
describe('familyOf', () => {
  it.each([
    ['ΤΙΜΟΛΟΓΙΟ ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙΩΝ', 'TPY'], ['ΤΠΥ', 'TPY'], ['Τιμολόγιο – Δελτίο Αποστολής', 'TDA'], ['ΔΕΛΤΙΟ ΑΠΟΣΤΟΛΗΣ ΤΙΜΟΛΟΓΙΟ', 'TDA'],
    ['ΤΙΜΟΛΟΓΙΟ', 'TIM'], ['ΤΙΜΟΛΟΓΙΟ ΠΩΛΗΣΗΣ', 'TIM'], ['ΔΕΛΤΙΟ ΑΠΟΣΤΟΛΗΣ', 'DA'], ['ΠΙΣΤΩΤΙΚΟ ΤΙΜΟΛΟΓΙΟ', 'PT'], ['ΠΙΣΤΩΤΙΚΟ ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙΩΝ', 'PT'],
    ['ΑΠΟΔΕΙΞΗ ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙΩΝ', 'APY'], ['ΑΠΟΔΕΙΞΗ ΛΙΑΝΙΚΗΣ ΠΩΛΗΣΗΣ', 'ALP'], ['ΛΟΓΑΡΙΑΣΜΟΣ ΡΕΥΜΑΤΟΣ', 'LOG'], ['ΕΚΚΑΘΑΡΙΣΤΙΚΟΣ', 'LOG'], ['INVOICE', 'TIM'], ['CREDIT NOTE', 'PT'], ['DEBIT NOTE', 'TIM'], ['', null],
    ['ΤΙΜΟΛΟΓΙΟ ΠΩΛΗΣΗΣ - ΔΕΛΤΙΟ ΑΠΟΣΤΟΛΗΣ', 'TDA'], ['ΤΙΜ. ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙΩΝ', 'TPY'], ['Δ.ΑΠΟΣΤΟΛΗΣ ΤΙΜΟΛΟΓΙΟ', 'TDA'],
    ['Δ.Α.', 'DA'], ['ΑΠΟΔΕΙΞΗ', 'ALP'], ['ΠΙΣΤΩΤΙΚΟ ΣΗΜΕΙΩΜΑ', 'PT'], ['ΛΟΓΑΡΙΑΣΜΟΣ ΥΔΡΕΥΣΗΣ', 'LOG'], [null, null], [undefined, null],
  ])('%s → %s', (label, fam) => { expect(familyOf(label)).toBe(fam); });
});
describe('classifySeries', () => {
  it('picks the creditor ΤΠΥ for a service invoice from a creditor', () => {
    const r = classifySeries({ documentTypeLabel: 'ΤΙΜΟΛΟΓΙΟ ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙΩΝ', issuerKind: 'creditor', totalAmount: 229.4, invoiceKind: 'service' }, all);
    expect(r?.code).toBe('1001'); expect(r!.confidence).toBeGreaterThan(0.8); expect(r!.tie).toBe(false);
  });
  it('restricts to purchase series for a supplier and prefers ΤΔΑΠ for a combined label', () => {
    const r = classifySeries({ documentTypeLabel: 'ΤΙΜΟΛΟΓΙΟ – ΔΕΛΤΙΟ ΑΠΟΣΤΟΛΗΣ', issuerKind: 'supplier', totalAmount: 100, invoiceKind: 'product' }, all);
    expect(r?.code).toBe('2062');
  });
  it('a negative total or a credit label goes to the credit series of the right side', () => {
    expect(classifySeries({ documentTypeLabel: 'ΤΙΜΟΛΟΓΙΟ', issuerKind: 'supplier', totalAmount: -50, invoiceKind: 'product' }, all)?.code).toBe('2081');
    expect(classifySeries({ documentTypeLabel: 'ΠΙΣΤΩΤΙΚΟ', issuerKind: 'creditor', totalAmount: 10, invoiceKind: 'service' }, all)?.code).toBe('1003');
  });
  it('unknown issuer: considers both sides, uses invoiceKind to break the tie, and flags near-ties', () => {
    const r = classifySeries({ documentTypeLabel: 'ΤΙΜΟΛΟΓΙΟ', issuerKind: null, totalAmount: 10, invoiceKind: null }, all);
    expect(['2061', '1001']).toContain(r?.code); expect(r!.tie).toBe(true);
    expect(classifySeries({ documentTypeLabel: 'ΤΙΜΟΛΟΓΙΟ', issuerKind: null, totalAmount: 10, invoiceKind: 'service' }, all)?.code).toBe('1001');
  });
  it('a side decided only by invoiceKind resolves the tie but caps the confidence at 0.7', () => {
    const product = classifySeries({ documentTypeLabel: 'ΤΙΜΟΛΟΓΙΟ', issuerKind: null, totalAmount: 10, invoiceKind: 'product' }, all);
    expect(product?.code).toBe('2061'); expect(product!.tie).toBe(false); expect(product!.confidence).toBeLessThanOrEqual(0.7);
    const service = classifySeries({ documentTypeLabel: 'ΤΙΜΟΛΟΓΙΟ', issuerKind: null, totalAmount: 10, invoiceKind: 'service' }, all);
    expect(service?.code).toBe('1001'); expect(service!.tie).toBe(false); expect(service!.confidence).toBeLessThanOrEqual(0.7);
  });
  it('invoiceKind "mixed" is neutral — identical outcome to an unknown content', () => {
    const base = { documentTypeLabel: 'ΤΙΜΟΛΟΓΙΟ', issuerKind: null, totalAmount: 10 } as const;
    const mixed = classifySeries({ ...base, invoiceKind: 'mixed' }, all);
    const unknown = classifySeries({ ...base, invoiceKind: null }, all);
    expect(mixed?.code).toBe(unknown?.code); expect(mixed!.tie).toBe(unknown!.tie); expect(mixed!.confidence).toBe(unknown!.confidence);
    expect(mixed!.alternatives).toEqual(unknown!.alternatives);
    expect(mixed!.reason).toContain('περιεχόμενο mixed');
  });
  it('a missing documentTypeLabel gives a flat, low-confidence tie', () => {
    const r = classifySeries({ documentTypeLabel: null, issuerKind: null, totalAmount: 10, invoiceKind: null }, all);
    expect(r).not.toBeNull(); expect(r!.reason).toContain('χωρίς τυπωμένο τύπο');
    expect(r!.tie).toBe(true); expect(r!.confidence).toBeLessThan(0.3);
  });
  it('alternatives: at most 5, sorted descending, rounded to 2 decimals and inside 0–1', () => {
    const r = classifySeries({ documentTypeLabel: 'ΤΙΜΟΛΟΓΙΟ', issuerKind: null, totalAmount: 10, invoiceKind: 'product' }, all);
    const alts = r!.alternatives;
    expect(alts.length).toBeLessThanOrEqual(5);
    expect(alts[0].code).toBe(r!.code);
    expect(alts.map((a) => a.score)).toEqual([...alts.map((a) => a.score)].sort((x, y) => y - x));
    for (const a of alts) { expect(a.score).toBe(Math.round(a.score * 100) / 100); expect(a.score).toBeGreaterThanOrEqual(0); expect(a.score).toBeLessThanOrEqual(1); }
  });
  it('falls back to the other side when the requested side has no enabled series, and says so', () => {
    const noPurchases = classifySeries({ documentTypeLabel: 'ΤΙΜΟΛΟΓΙΟ', issuerKind: 'supplier', totalAmount: 10, invoiceKind: 'product' }, creditors);
    expect(noPurchases?.kind).toBe('creditor');
    expect(noPurchases!.reason).toContain('δεν υπάρχουν ενεργές σειρές αγορών');
    const noCreditors = classifySeries({ documentTypeLabel: 'ΤΙΜΟΛΟΓΙΟ ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙΩΝ', issuerKind: 'creditor', totalAmount: 10, invoiceKind: 'service' }, purchases);
    expect(noCreditors?.kind).toBe('purchase');
    expect(noCreditors!.reason).toContain('δεν υπάρχουν ενεργές σειρές πιστωτών');
    expect(classifySeries({ documentTypeLabel: 'ΤΙΜΟΛΟΓΙΟ', issuerKind: 'supplier', totalAmount: 10, invoiceKind: 'product' }, all)!.reason).not.toContain('δεν υπάρχουν ενεργές σειρές');
  });
  it('returns null with no candidates and a low-confidence fallback for an unknown label', () => {
    expect(classifySeries({ documentTypeLabel: 'ΤΙΜΟΛΟΓΙΟ', issuerKind: null, totalAmount: 1, invoiceKind: null }, [])).toBeNull();
    const r = classifySeries({ documentTypeLabel: 'ΚΑΤΙ ΠΕΡΙΕΡΓΟ', issuerKind: 'supplier', totalAmount: 1, invoiceKind: 'product' }, all);
    expect(r?.confidence ?? 0).toBeLessThan(0.5);
  });
  it('utility bills map to ΤΠΥ of a creditor', () => {
    expect(classifySeries({ documentTypeLabel: 'ΕΚΚΑΘΑΡΙΣΤΙΚΟΣ ΛΟΓΑΡΙΑΣΜΟΣ', issuerKind: null, totalAmount: 78298.47, invoiceKind: 'service' }, all)?.code).toBe('1001');
  });
});

describe('inferInvoiceKind', () => {
  it('returns null without line items', () => {
    expect(inferInvoiceKind(null)).toBeNull();
    expect(inferInvoiceKind({})).toBeNull();
    expect(inferInvoiceKind({ items: [] })).toBeNull();
    expect(inferInvoiceKind({ items: 'όχι πίνακας' })).toBeNull();
  });

  it('single-quantity service wording → service', () => {
    expect(inferInvoiceKind({ items: [{ name: 'ΠΑΡΟΧΗ ΥΠΗΡΕΣΙΩΝ ΛΟΓΙΣΤΗ', quantity: 1 }] })).toBe('service');
    // Ποσότητα που λείπει μετράει σαν μονάδα — τα τιμολόγια υπηρεσιών συχνά δεν τυπώνουν ποσότητα.
    expect(inferInvoiceKind({ items: [{ name: 'Αμοιβή συμβούλου', quantity: null }, { name: 'Συντήρηση' }] })).toBe('service');
    expect(inferInvoiceKind({ items: [{ name: 'MONTHLY SERVICE FEE', quantity: 1 }] })).toBe('service');
  });

  it('service wording with real quantities is NOT a service invoice', () => {
    // 12 τεμάχια «μεταφορικών» δεν είναι πια γραμμή υπηρεσίας: πέφτει στον έλεγχο εμπορεύματος.
    expect(inferInvoiceKind({ items: [{ code: 'Μ1', name: 'ΜΕΤΑΦΟΡΙΚΑ', quantity: 12 }] })).toBe('product');
  });

  it('coded lines with quantity > 1, or units, → product', () => {
    expect(inferInvoiceKind({ items: [{ code: '7001', name: 'Βίδες', quantity: 50 }] })).toBe('product');
    expect(inferInvoiceKind({ items: [{ name: 'Αλεύρι', quantity: 1, unit: 'KG' }] })).toBe('product');
    expect(inferInvoiceKind({ items: [{ name: 'Χαρτί Α4 ΤΕΜ', quantity: 1 }] })).toBe('product');
  });

  it('a unit-looking substring inside a word does not count', () => {
    // «ΑΛΤ» περιέχει «ΛΤ» αλλά όχι ως αυτοτελή λέξη· «M3» μόνο ως μονάδα.
    expect(inferInvoiceKind({ items: [{ name: 'ΑΛΤΗΡΕΣ', quantity: 1 }] })).toBeNull();
    expect(inferInvoiceKind({ items: [{ name: 'Σκυρόδεμα', quantity: 1, unit: 'M3' }] })).toBe('product');
  });

  it('returns null when nothing points either way', () => {
    expect(inferInvoiceKind({ items: [{ name: 'Διάφορα', quantity: 1 }] })).toBeNull();
    // Ποσότητα > 1 χωρίς κωδικό είδους δεν φτάνει από μόνη της.
    expect(inferInvoiceKind({ items: [{ name: 'Διάφορα', quantity: 4 }] })).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Ταυτότητα σειράς: `sosource:code`                                   */
/* ------------------------------------------------------------------ */

describe('seriesKey / alternatives', () => {
  it('η ταυτότητα είναι το ζεύγος ενότητα:κωδικός', () => {
    expect(seriesKey(C('2061', 'ΤΙΜΑ', 'Τιμολόγιο Αγοράς', 'purchase'))).toBe('1251:2061');
    expect(seriesKey(C('2061', 'ΤΠΥ', 'Τιμολόγιο Παροχής', 'creditor'))).toBe('1653:2061');
  });

  it('οι εναλλακτικές κουβαλούν την ενότητά τους, ώστε να ξεχωρίζουν ομώνυμοι κωδικοί', () => {
    // ΙΔΙΟΣ κωδικός «2061» και στις δύο πλευρές: χωρίς `sosource` δεν ξεχωρίζουν.
    const twins = [
      C('2061', 'ΤΙΜΑ', 'Τιμολόγιο Αγοράς', 'purchase'),
      C('2061', 'ΤΠΥ', 'Τιμολόγιο Παροχής Υπηρεσιών', 'creditor'),
    ];
    const r = classifySeries(
      { documentTypeLabel: 'ΤΙΜΟΛΟΓΙΟ', issuerKind: null, totalAmount: 100, invoiceKind: null },
      twins,
    )!;
    expect(r.alternatives.map(seriesKey).sort()).toEqual(['1251:2061', '1653:2061']);
    expect(r.alternatives.every((a) => typeof a.sosource === 'number')).toBe(true);
  });
});

describe('parseSeriesChoice', () => {
  const options = [
    C('2061', 'ΤΙΜΑ', 'Τιμολόγιο Αγοράς', 'purchase'),
    C('2061', 'ΤΠΥ', 'Τιμολόγιο Παροχής Υπηρεσιών', 'creditor'),
    C('1002', 'ΑΠΥ', 'Απόδειξη Παροχής Υπηρεσιών', 'creditor'),
  ];

  it('δέχεται το ζεύγος και διαλέγει τη ΣΩΣΤΗ πλευρά', () => {
    expect(parseSeriesChoice('1653:2061', options)).toBe(options[1]);
    expect(parseSeriesChoice('1251:2061', options)).toBe(options[0]);
    expect(parseSeriesChoice(' 1653 : 2061 ', options)).toBe(options[1]);
  });

  it('σκέτος κωδικός γίνεται δεκτός μόνο όταν είναι μοναδικός', () => {
    expect(parseSeriesChoice('1002', options)).toBe(options[2]);
    // «2061» υπάρχει και στις δύο ενότητες → αμφίσημο, το απορρίπτουμε.
    expect(parseSeriesChoice('2061', options)).toBeNull();
  });

  it('άγνωστη ή κενή απάντηση → null', () => {
    expect(parseSeriesChoice('1251:9999', options)).toBeNull();
    expect(parseSeriesChoice('9999', options)).toBeNull();
    expect(parseSeriesChoice('', options)).toBeNull();
    expect(parseSeriesChoice(null, options)).toBeNull();
  });
});

describe('inferInvoiceKind — ποσότητες ως κείμενο', () => {
  it('«1» ως string μετράει σαν μονάδα (υπηρεσία), όχι σαν άγνωστη ποσότητα', () => {
    expect(inferInvoiceKind({ items: [{ name: 'ΠΑΡΟΧΗ ΥΠΗΡΕΣΙΩΝ ΛΟΓΙΣΤΗ', quantity: '1' }] })).toBe('service');
  });

  it('«12» ως string βγάζει τη γραμμή από τις υπηρεσίες, όπως και ο αριθμός', () => {
    expect(inferInvoiceKind({ items: [{ code: 'Μ1', name: 'ΜΕΤΑΦΟΡΙΚΑ', quantity: '12' }] })).toBe('product');
  });

  it('δεκαδικό με ΚΟΜΜΑ («9,56») διαβάζεται σωστά', () => {
    expect(inferInvoiceKind({ items: [{ code: '7001', name: 'Βίδες', quantity: '9,56' }] })).toBe('product');
  });

  it('ποσότητα που δεν είναι αριθμός μένει άγνωστη', () => {
    expect(inferInvoiceKind({ items: [{ name: 'Αμοιβή συμβούλου', quantity: 'κατ αποκοπήν' }] })).toBe('service');
  });
});

describe('labelFromFileName', () => {
  it.each([
    ['ΤΠΥ1032.pdf', 'ΤΠΥ'],                       // ο τύπος κολλημένος στον αριθμό
    ['ΤΠΥ_4441.pdf', 'ΤΠΥ'],
    ['ΓΚΟΥΜΑΣ ΕΕ - ΤΔΑ 3.pdf', 'ΤΔΑ'],            // ο τύπος μέσα σε όνομα προμηθευτή
    ['Invoice_2200569632.PDF', 'INVOICE'],
    ['INV-88.pdf', 'INVOICE'],                     // «INV» ως αυτοτελές token → ΤΙΜ
    ['S1Prt_260129.PDF', null],                    // εκτύπωση SoftOne, καμία ένδειξη
    ['invoices/5565927642.pdf', null],             // «invoices» είναι ΦΑΚΕΛΟΣ, όχι token του ονόματος
    ['5565927642.pdf', null],
    ['', null],
    [null, null],
  ])('%s → %s', (name, label) => { expect(labelFromFileName(name)).toBe(label); });

  it('η ετικέτα που γυρίζει είναι αναγνωρίσιμη από το familyOf', () => {
    expect(familyOf(labelFromFileName('ΤΠΥ1032.pdf'))).toBe('TPY');
    expect(familyOf(labelFromFileName('Invoice_1.pdf'))).toBe('TIM');
    expect(familyOf(labelFromFileName('ΓΚΟΥΜΑΣ ΕΕ - ΤΔΑ 3.pdf'))).toBe('TDA');
  });
});
