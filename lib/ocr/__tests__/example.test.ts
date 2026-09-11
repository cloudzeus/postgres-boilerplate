// lib/ocr/__tests__/example.test.ts
// Το συμπυκνωμένο παράδειγμα αναφοράς: τι κρατάει, τι πετάει και — το σημαντικότερο — ότι το
// όριο των 4000 χαρακτήρων είναι ΕΓΓΥΗΣΗ, όχι ευχή. Ένα παράδειγμα εκτός ορίου δεν είναι απλώς
// ακριβό: σπρώχνει έξω από το παράθυρο του μοντέλου τις ίδιες τις οδηγίες εξαγωγής.
import { describe, it, expect } from 'vitest';
import { trimExample, EXAMPLE_MAX_CHARS, EXAMPLE_MAX_LINES } from '../example';
import { coerceDocument, type DocumentJson } from '../canonical';

const line = (i: number) => ({
  code: `ΚΩΔ-${i}`, name: `Είδος ${i}`, unit: 'ΤΕΜ',
  quantity: 2, unitPrice: 10, discount: 0, net: 20, vatRate: 24, vatAmount: 4.8, total: 24.8,
});

const doc = (over: Record<string, unknown> = {}): DocumentJson => coerceDocument({
  kind: 'invoice',
  type: { label: 'ΤΙΜΟΛΟΓΙΟ ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙΩΝ', series: 'ΤΠΥ', number: '17', myDataType: '2.1' },
  date: '2026-06-22',
  dueDate: '2026-07-22',
  currency: 'EUR',
  issuer: {
    name: 'ΚΑΠΑΛΙΝΕ ΑΕ', vat: '999863881', doy: 'ΦΑΕ ΑΘΗΝΩΝ', address: 'Πειραιώς 12',
    city: 'Αθήνα', zip: '10435', country: 'GR', phone: '2101234567', email: 'info@kapaline.gr',
    gemi: '123456', profession: 'Εμπόριο',
  },
  recipient: { name: 'DGESPA ΑΕ', vat: '094014201', address: 'Σταδίου 5', doy: 'Α΄ ΑΘΗΝΩΝ' },
  lines: [line(1), line(2), line(3), line(4), line(5)],
  totals: { net: 100, vatAmount: 24, total: 124, payable: 124 },
  vatBreakdown: [{ rate: 24, net: 100, vat: 24 }],
  digital: { mark: '400014123456789', uid: 'ABC123', authCode: 'XYZ', provider: 'Epsilon' },
  payment: {
    method: 'Κατάθεση', terms: '30 ημέρες',
    ibans: [
      { bank: 'ΕΘΝΙΚΗ', iban: 'GR1601101250000000012300695' },
      { bank: 'ALPHA', iban: 'GR9601401250000000012300696' },
      { bank: 'ΠΕΙΡΑΙΩΣ', iban: 'GR9601721250000000012300697' },
    ],
  },
  references: { orderNo: 'ΠΑΡ-9', deliveryNote: 'ΔΑ-3', contract: 'ΣΥΜ-1' },
  handwritten: { glAccount: '64.00' },
  ...over,
});

const json = (v: unknown) => JSON.stringify(v);
const parsed = (d: DocumentJson) => JSON.parse(json(trimExample(d)));

describe('trimExample — τι κρατάει', () => {
  it('κρατάει την ταυτότητα του παραστατικού και ολόκληρο τον εκδότη', () => {
    const ex = parsed(doc());
    expect(ex.type).toEqual({ label: 'ΤΙΜΟΛΟΓΙΟ ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙΩΝ', series: 'ΤΠΥ', number: '17' });
    expect(ex.date).toBe('2026-06-22');
    expect(ex.currency).toBe('EUR');
    expect(ex.issuer).toMatchObject({ name: 'ΚΑΠΑΛΙΝΕ ΑΕ', vat: '999863881', doy: 'ΦΑΕ ΑΘΗΝΩΝ', city: 'Αθήνα' });
    expect(ex.totals).toMatchObject({ net: 100, vatAmount: 24, total: 124 });
    expect(ex.vatBreakdown).toEqual([{ rate: 24, net: 100, vat: 24 }]);
    expect(ex.digital).toMatchObject({ mark: '400014123456789', uid: 'ABC123', provider: 'Epsilon' });
  });

  it('από τον παραλήπτη κρατάει ΜΟΝΟ επωνυμία και ΑΦΜ', () => {
    const ex = parsed(doc());
    expect(ex.recipient).toEqual({ name: 'DGESPA ΑΕ', vat: '094014201' });
  });

  it('το πολύ 3 γραμμές, χωρίς τα παράγωγα ποσά τους', () => {
    const ex = parsed(doc());
    expect(ex.lines).toHaveLength(EXAMPLE_MAX_LINES);
    expect(ex.lines[0]).toEqual({
      code: 'ΚΩΔ-1', name: 'Είδος 1', unit: 'ΤΕΜ', quantity: 2, unitPrice: 10, vatRate: 24, net: 20,
    });
  });

  it('το πολύ 2 IBAN, και οι αναφορές μόνο όσες έχουν νόημα ως θέση', () => {
    const ex = parsed(doc());
    expect(ex.payment.ibans).toHaveLength(2);
    expect(ex.payment.ibans[0].iban).toBe('GR1601101250000000012300695');
    expect(ex.references).toEqual({ orderNo: 'ΠΑΡ-9', deliveryNote: 'ΔΑ-3' });
  });

  it('πετάει κάθε κενό κλειδί — και τα άδεια αντικείμενα μαζί', () => {
    const ex = parsed(doc({
      digital: {}, payment: {}, references: {}, recipient: {}, vatBreakdown: [], lines: [],
    }));
    expect(ex).not.toHaveProperty('digital');
    expect(ex).not.toHaveProperty('recipient');
    expect(ex).not.toHaveProperty('lines');
    expect(ex).not.toHaveProperty('vatBreakdown');
    expect(json(ex)).not.toContain('null');
  });

  it('δεν στέλνει χειρόγραφα ή σημειώσεις — δεν είναι θέση πεδίου, είναι περιεχόμενο', () => {
    const ex = parsed(doc({ notes: 'Παρατηρήσεις του ενός εγγράφου' }));
    expect(ex).not.toHaveProperty('handwritten');
    expect(ex).not.toHaveProperty('notes');
  });
});

describe('trimExample — το όριο', () => {
  it('ένα τιμολόγιο με 200 γραμμές μένει κάτω από το όριο και κρατάει 3 γραμμές', () => {
    const many = doc({ lines: Array.from({ length: 200 }, (_, i) => line(i)) });
    const ex = trimExample(many);
    expect(json(ex).length).toBeLessThanOrEqual(EXAMPLE_MAX_CHARS);
    expect((ex as { lines: unknown[] }).lines).toHaveLength(EXAMPLE_MAX_LINES);
  });

  it('όταν οι γραμμές είναι τεράστιες, πέφτουν ΠΡΩΤΕΣ — ο εκδότης και τα σύνολα μένουν', () => {
    const fat = doc({ lines: [1, 2, 3].map((i) => ({ ...line(i), name: 'Π'.repeat(1800) })) });
    const ex = parsed(fat);
    expect(json(ex).length).toBeLessThanOrEqual(EXAMPLE_MAX_CHARS);
    expect(ex.lines?.length ?? 0).toBeLessThan(EXAMPLE_MAX_LINES);
    expect(ex.issuer.vat).toBe('999863881');
    expect(ex.totals.total).toBe(124);
  });

  it('όταν ούτε χωρίς γραμμές δεν χωράει, φεύγουν πληρωμή και αναφορές', () => {
    const fat = doc({
      lines: [{ ...line(1), name: 'Π'.repeat(5000) }],
      payment: { method: 'Μ'.repeat(3000), terms: null, ibans: [] },
      references: { orderNo: 'Ο'.repeat(3000) },
    });
    const ex = parsed(fat);
    expect(json(ex).length).toBeLessThanOrEqual(EXAMPLE_MAX_CHARS);
    expect(ex).not.toHaveProperty('payment');
    expect(ex).not.toHaveProperty('references');
    expect(ex.issuer.vat).toBe('999863881');
  });

  it('ακόμη και με τερατώδη επωνυμία το όριο τηρείται', () => {
    const monstrous = doc({ issuer: { name: 'Α'.repeat(9000), vat: '999863881', address: 'Δ'.repeat(9000) } });
    const ex = trimExample(monstrous);
    expect(json(ex).length).toBeLessThanOrEqual(EXAMPLE_MAX_CHARS);
    expect((ex as { issuer: { vat: string } }).issuer.vat).toBe('999863881');
  });

  it('ένα άδειο έγγραφο δεν σκάει', () => {
    const ex = trimExample(coerceDocument({ kind: 'receipt' }));
    expect(json(ex).length).toBeLessThanOrEqual(EXAMPLE_MAX_CHARS);
  });
});
