// lib/ocr/__tests__/extract-merge.test.ts
// Οι συγχωνεύσεις του pipeline πάνω στο ΚΑΝΟΝΙΚΟ έγγραφο: πολυσέλιδο (`mergeDocuments`),
// υβριδικό PDF ψηφιακό+όραση (`mergeHybridDocuments`) και το μέτρο «τι λείπει» που αποφασίζει
// αν αξίζει δεύτερο πέρασμα με ακριβότερο μοντέλο (`missingRequired`).
import { describe, it, expect } from 'vitest';
import { coerceDocument, type DocumentJson } from '../canonical';
import {
  fixSwappedPartiesDocument, mergeDocuments, mergeHybridDocuments, missingRequired,
} from '../extract-merge';

const doc = (raw: Record<string, unknown>): DocumentJson => coerceDocument({ kind: 'invoice', ...raw });

describe('mergeDocuments — πολυσέλιδο', () => {
  it('κρατάει τη μία σελίδα αυτούσια', () => {
    const only = doc({ type: { number: '17' } });
    expect(mergeDocuments([only])).toEqual(only);
  });

  it('η ΠΡΩΤΗ σελίδα με τιμή κερδίζει στην κεφαλίδα', () => {
    const p1 = doc({ issuer: { name: 'ΚΑΠΑΛΙΝΕ ΑΕ', vat: '999863881' }, type: { number: '17' }, date: '2026-06-22' });
    const p2 = doc({ issuer: { name: 'ΛΑΘΟΣ ΑΕ', address: 'Οδός 1' }, type: { number: '99' } });
    const m = mergeDocuments([p1, p2]);
    expect(m.issuer.name).toBe('ΚΑΠΑΛΙΝΕ ΑΕ');
    expect(m.type.number).toBe('17');
    expect(m.date).toBe('2026-06-22');
    expect(m.issuer.address).toBe('Οδός 1');      // κενό στην πρώτη → γεμίζει από τη δεύτερη
  });

  it('τα ΣΥΝΟΛΑ τα δίνει η ΤΕΛΕΥΤΑΙΑ σελίδα που τα τύπωσε', () => {
    const p1 = doc({ totals: { net: 40, vatAmount: 9.6, total: 49.6 } });
    const p2 = doc({ totals: { net: 100, vatAmount: 24, total: 124 } });
    const p3 = doc({});                            // σελίδα χωρίς σύνολα δεν σβήνει τα προηγούμενα
    const m = mergeDocuments([p1, p2, p3]);
    expect(m.totals.total).toBe(124);
    expect(m.totals.net).toBe(100);
  });

  it('το vatBreakdown το δίνει η τελευταία σελίδα που το έχει', () => {
    const p1 = doc({ vatBreakdown: [{ rate: 13, net: 40, vat: 5.2 }] });
    const p2 = doc({ vatBreakdown: [{ rate: 24, net: 100, vat: 24 }] });
    expect(mergeDocuments([p1, p2]).vatBreakdown).toEqual([{ rate: 24, net: 100, vat: 24 }]);
  });

  it('οι γραμμές ενώνονται με τη σειρά των σελίδων, χωρίς διπλές', () => {
    const p1 = doc({ lines: [{ code: 'A1', name: 'Είδος Α', net: 50 }, { code: 'B2', name: 'Είδος Β', net: 30 }] });
    const p2 = doc({ lines: [{ code: 'B2', name: 'Είδος Β', net: 30 }, { code: 'C3', name: 'Είδος Γ', net: 20 }] });
    expect(mergeDocuments([p1, p2]).lines.map((l) => l.code)).toEqual(['A1', 'B2', 'C3']);
  });

  it('οι λογαριασμοί τραπέζης ενώνονται ανά IBAN', () => {
    const p1 = doc({ payment: { ibans: [{ bank: 'ΕΤΕ', iban: 'GR11' }] } });
    const p2 = doc({ payment: { ibans: [{ bank: 'ΕΤΕ', iban: 'GR11' }, { bank: 'ALPHA', iban: 'GR22' }] } });
    expect(mergeDocuments([p1, p2]).payment.ibans.map((b) => b.iban)).toEqual(['GR11', 'GR22']);
  });

  it('το custom συγχωνεύεται ρηχά και μια κενή τιμή δεν σβήνει την προηγούμενη', () => {
    const p1 = doc({ custom: { time: '10:00', itemsCount: 3 } });
    const p2 = doc({ custom: { time: null, meterNo: '42' } });
    expect(mergeDocuments([p1, p2]).custom).toEqual({ time: '10:00', itemsCount: 3, meterNo: '42' });
  });

  it('ο τύπος βγαίνει από την παρουσία παραλήπτη στη συνολική κεφαλίδα', () => {
    const p1 = doc({ kind: 'receipt', issuer: { name: 'ΑΕ' } });
    const p2 = doc({ kind: 'receipt', recipient: { name: 'ΠΕΛΑΤΗΣ', vat: '094014201' } });
    expect(mergeDocuments([p1, p2]).kind).toBe('invoice');
  });

  it('ένα γενικό κείμενο μένει γενικό', () => {
    const p1 = coerceDocument({ title: 'Α', fullText: 'σελίδα 1' }, 'general_text');
    const p2 = coerceDocument({ fullText: 'σελίδα 2' }, 'general_text');
    const m = mergeDocuments([p1, p2]);
    expect(m.kind).toBe('general');
    expect(m.custom.title).toBe('Α');
  });
});

describe('mergeHybridDocuments — ψηφιακό PDF + όραση', () => {
  const digital = doc({
    issuer: { name: 'ΚΑΠΑΛΙΝΕ ΑΕ' }, type: { number: '17' },
    lines: [{ code: 'A1', name: 'Είδος Α', net: 50 }],
  });
  const vision = doc({
    issuer: { name: 'ΑΛΛΟ', vat: '999863881' }, date: '2026-06-22',
    totals: { total: 124 },
    lines: [{ code: 'X9', name: 'Από την όραση', net: 10 }],
  });

  it('το ψηφιακό κερδίζει και η όραση γεμίζει μόνο τα κενά', () => {
    const m = mergeHybridDocuments(digital, vision);
    expect(m.issuer.name).toBe('ΚΑΠΑΛΙΝΕ ΑΕ');
    expect(m.issuer.vat).toBe('999863881');
    expect(m.date).toBe('2026-06-22');
    expect(m.totals.total).toBe(124);
  });

  it('κρατάει τις γραμμές του ψηφιακού όσο υπάρχουν', () => {
    expect(mergeHybridDocuments(digital, vision).lines.map((l) => l.code)).toEqual(['A1']);
  });

  it('παίρνει τις γραμμές της όρασης όταν το ψηφιακό δεν διάβασε καμία', () => {
    const empty = doc({ issuer: { name: 'ΚΑΠΑΛΙΝΕ ΑΕ' } });
    expect(mergeHybridDocuments(empty, vision).lines.map((l) => l.code)).toEqual(['X9']);
  });
});

describe('missingRequired', () => {
  const full = doc({
    issuer: { name: 'ΚΑΠΑΛΙΝΕ ΑΕ', vat: '999863881' }, type: { number: '17' }, date: '2026-06-22',
    totals: { net: 100, vatAmount: 24, total: 124 },
  });

  it('μηδέν όταν όλα τα υποχρεωτικά υπάρχουν', () => {
    expect(missingRequired(full, 'invoice')).toBe(0);
  });

  it('μετράει ό,τι λείπει από την κεφαλίδα', () => {
    const partial = doc({ issuer: { name: 'ΚΑΠΑΛΙΝΕ ΑΕ' }, type: { number: '17' } });
    expect(missingRequired(partial, 'invoice')).toBe(5);   // vat, date, net, vatAmount, total
  });

  it('η απόδειξη δεν ζητάει ανάλυση ΦΠΑ', () => {
    const receipt = doc({ issuer: { name: 'ΑΕ', vat: '999863881' }, type: { number: '5' }, date: '2026-06-22', totals: { total: 12.4 } });
    expect(missingRequired(receipt, 'receipt')).toBe(0);
  });

  it('το γενικό κείμενο ζητάει τίτλο και κείμενο', () => {
    const empty = coerceDocument({}, 'general_text');
    expect(missingRequired(empty, 'general_text')).toBe(2);
    const ok = coerceDocument({ title: 'Α', fullText: 'κείμενο' }, 'general_text');
    expect(missingRequired(ok, 'general_text')).toBe(0);
  });
});

describe('fixSwappedPartiesDocument', () => {
  const own = '094014201';
  it('αντιστρέφει εκδότη/παραλήπτη όταν ο «εκδότης» είμαστε εμείς', () => {
    const d = doc({ issuer: { name: 'ΕΜΕΙΣ', vat: own }, recipient: { name: 'ΑΥΤΟΙ', vat: '999863881' } });
    const fixed = fixSwappedPartiesDocument(d, own);
    expect(fixed.issuer.vat).toBe('999863881');
    expect(fixed.issuer.name).toBe('ΑΥΤΟΙ');
    expect(fixed.recipient.vat).toBe(own);
    expect(fixed.recipient.name).toBe('ΕΜΕΙΣ');
  });
  it('δεν πειράζει τίποτα όταν ο εκδότης είναι άλλος ή δεν ξέρουμε το δικό μας ΑΦΜ', () => {
    const d = doc({ issuer: { vat: '999863881' }, recipient: { vat: own } });
    expect(fixSwappedPartiesDocument(d, own)).toEqual(d);
    expect(fixSwappedPartiesDocument(d, null)).toEqual(d);
  });
});
