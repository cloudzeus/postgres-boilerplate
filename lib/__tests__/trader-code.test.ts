// lib/__tests__/trader-code.test.ts
// Ο μηχανισμός «επόμενος ελεύθερος κωδικός». Καθαρή λογική — κανένα I/O, κανένα mock.
import { describe, it, expect } from 'vitest';
import { nextTraderCode, parseCodeShape } from '../trader-code';

describe('parseCodeShape', () => {
  it.each([
    ['53-00001', { prefix: '53-', value: 1, width: 5 }],
    ['0001', { prefix: '', value: 1, width: 4 }],
    ['53.90.00.0000', { prefix: '53.90.00.', value: 0, width: 4 }],
    ['1000', { prefix: '', value: 1000, width: 4 }],
    ['Π.0042', { prefix: 'Π.', value: 42, width: 4 }],
  ])('%s', (code, shape) => expect(parseCodeShape(code)).toEqual(shape));

  it('χωρίς τελικά ψηφία → null (δεν είναι σειρά)', () => {
    expect(parseCodeShape('ΠΙΣΤΩΤΗΣ')).toBeNull();
    expect(parseCodeShape('')).toBeNull();
    expect(parseCodeShape('   ')).toBeNull();
  });
});

describe('nextTraderCode — τα τρία πραγματικά σχήματα της εγκατάστασης', () => {
  it('πιστωτές: 53-00001 → 53-00002 (πλάτος 5, πρόθεμα «53-»)', () => {
    expect(nextTraderCode(['53-00001'])).toEqual({
      code: '53-00002', source: 'pattern', prefix: '53-', width: 5, taken: 1,
    });
  });

  it('προμηθευτές: 0001 → 0002 (χωρίς πρόθεμα, πλάτος 4)', () => {
    expect(nextTraderCode(['0001'])).toMatchObject({ code: '0002', source: 'pattern', prefix: '', width: 4 });
  });

  it('λογαριασμοί λογιστικού σχεδίου: 53.90.00.0000 → 53.90.00.0001', () => {
    expect(nextTraderCode(['53.90.00.0000'])).toMatchObject({ code: '53.90.00.0001', prefix: '53.90.00.' });
  });
});

describe('nextTraderCode — συμπερασμός σχήματος', () => {
  it('κυρίαρχο πρόθεμα: το πολυπληθέστερο κερδίζει, τα υπόλοιπα αγνοούνται για την αύξηση', () => {
    const r = nextTraderCode(['53-00001', '53-00002', '53-00007', '0001', '1000']);
    expect(r).toMatchObject({ code: '53-00008', prefix: '53-', width: 5, source: 'pattern' });
  });

  it('ισοπαλία πλήθους: κερδίζει το πρόθεμα με το μεγαλύτερο max', () => {
    expect(nextTraderCode(['A-001', 'B-050'])).toMatchObject({ code: 'B-051', prefix: 'B-' });
  });

  it('κενά στη σειρά ΔΕΝ γεμίζουν — η πρόταση είναι max+1', () => {
    // Ένα κενό σημαίνει συνήθως διαγραμμένη/δεσμευμένη εγγραφή· η επαναχρησιμοποίηση
    // μπερδεύει ιστορικό και λογιστικές παραπομπές.
    expect(nextTraderCode(['53-00001', '53-00002', '53-00009'])).toMatchObject({ code: '53-00010' });
  });

  it('διατηρεί το πλάτος και το μεγαλώνει μόνο όταν χρειαστεί (0999 → 1000)', () => {
    expect(nextTraderCode(['0997', '0999'])).toMatchObject({ code: '1000', width: 4 });
    expect(nextTraderCode(['9999'])).toMatchObject({ code: '10000', width: 4 });
  });

  it('το πλάτος το ορίζει ο ΜΕΓΑΛΥΤΕΡΟΣ κωδικός της ομάδας', () => {
    expect(nextTraderCode(['53-1', '53-00020'])).toMatchObject({ code: '53-00021', width: 5 });
  });

  it('ποτέ δεν προτείνει πιασμένο κωδικό, ακόμη κι όταν αυτός γράφτηκε αλλιώς', () => {
    // «53-2» και «53-00002» είναι διαφορετικά strings, άρα διαφορετικοί κωδικοί·
    // το κυρίαρχο σχήμα (πλάτος 5) δίνει 53-00002, που ΥΠΑΡΧΕΙ → προχωρά.
    expect(nextTraderCode(['53-00001', '53-00002', '53-2'])).toMatchObject({ code: '53-00003' });
  });

  it('αγνοεί κωδικούς χωρίς ψηφία, αλλά τους μετρά ως πιασμένους', () => {
    const r = nextTraderCode(['ΠΙΣΤΩΤΗΣ', '53-00004']);
    expect(r).toMatchObject({ code: '53-00005', prefix: '53-' });
    expect(r.taken).toBe(2);
  });

  it('το πρόθεμα κρατά τα πεζά/κεφαλαία του, αλλά η σύγκριση «πιασμένου» τα αγνοεί', () => {
    // «a-» και «A-» είναι ΔΙΑΦΟΡΕΤΙΚΑ προθέματα (ισοπαλία πλήθους → μεγαλύτερο max).
    expect(nextTraderCode(['a-001', 'A-002'])).toMatchObject({ code: 'A-003', prefix: 'A-' });
    // Εδώ το κυρίαρχο σχήμα θα έδινε «a-002», που είναι πιασμένο από το «A-002».
    expect(nextTraderCode(['a-001', 'a-003', 'A-002'])).toMatchObject({ code: 'a-004', prefix: 'a-' });
  });
});

describe('nextTraderCode — καμία απόδειξη', () => {
  it('χωρίς κωδικούς και χωρίς μάσκα ΔΕΝ εφευρίσκει τίποτα', () => {
    expect(nextTraderCode([])).toEqual({ code: null, source: 'none', taken: 0 });
    expect(nextTraderCode([], { mask: '' })).toEqual({ code: null, source: 'none', taken: 0 });
    expect(nextTraderCode([], { mask: null })).toMatchObject({ code: null, source: 'none' });
  });

  it('χωρίς κωδικούς χρησιμοποιεί ΑΥΤΟΥΣΙΑ τη μάσκα ως πρώτο κωδικό', () => {
    expect(nextTraderCode([], { mask: '53-00001' })).toEqual({
      code: '53-00001', source: 'mask', prefix: '53-', width: 5, taken: 0,
    });
  });

  it('η μάσκα προχωρά αν ο πρώτος κωδικός της είναι πιασμένος από ξένο σχήμα', () => {
    // «ΠΙΣΤ» δεν έχει ψηφία → δεν ορίζει σχήμα, αλλά πιάνει κωδικό.
    expect(nextTraderCode(['ΠΙΣΤ', '53-00001'], { mask: '53-00001' }))
      // Υπάρχει κωδικός με ψηφία, άρα κερδίζει το σχήμα — όχι η μάσκα.
      .toMatchObject({ code: '53-00002', source: 'pattern' });
  });

  it('η μάσκα υπερισχύει ΜΟΝΟ όταν δεν υπάρχει κανένας κωδικός με ψηφία', () => {
    expect(nextTraderCode(['ΠΙΣΤ'], { mask: '53-00001' }))
      .toMatchObject({ code: '53-00001', source: 'mask', taken: 1 });
  });

  it('μάσκα χωρίς ψηφία δίνεται ως έχει (δεν είναι σειρά)', () => {
    expect(nextTraderCode([], { mask: 'ΠΙΣΤ' })).toMatchObject({ code: 'ΠΙΣΤ', source: 'mask', width: 0 });
  });
});
