// lib/__tests__/trader-code.test.ts
// Ο μηχανισμός «επόμενος ελεύθερος κωδικός». Καθαρή λογική — κανένα I/O, κανένα mock.
import { describe, it, expect } from 'vitest';
import { applyCodeProposal, nextTraderCode, parseCodeShape } from '../trader-code';

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

  // ΠΡΟΣΟΧΗ στο τι ΔΕΝ λέει αυτή η δοκιμή. Το `53.90.00.0000` της εγκατάστασης είναι
  // λογαριασμός τραπέζης (`SODTYPE 14`) — ΔΕΝ επιτρέπεται να σπείρει την αρίθμηση
  // συναλλασσομένων. Η εγγύηση αυτή δεν ζει εδώ: ζει στο επίπεδο του ερωτήματος
  // (`GetTable TRDR … SODTYPE=<n>` στο `softoneNextTraderCode`, και το αντίστοιχο
  // `where: { sodtype }` στον τοπικό καθρέφτη), που δίνει στη συνάρτηση ΜΟΝΟ κωδικούς
  // του ίδιου τύπου. Εδώ ελέγχεται μόνο ότι η καθαρή συνάρτηση χειρίζεται σωστά ένα
  // σχήμα με τελείες, ό,τι κι αν της δώσει ο καλών.
  it('σχήμα με τελείες: 53.90.00.0000 → 53.90.00.0001 (καθαρή συνάρτηση, ό,τι της δοθεί)', () => {
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

describe('applyCodeProposal — ο κωδικός ακολουθεί τον τύπο', () => {
  it('γράφει την πρόταση σε άδειο πεδίο', () => {
    expect(applyCodeProposal({ current: '', lastProposal: '', proposal: '0004' })).toBe('0004');
  });

  it('ΑΛΛΑΓΗ ΤΥΠΟΥ: το πεδίο που κρατά τη δική μας πρόταση παίρνει την αρίθμηση του νέου τύπου', () => {
    // Ακριβώς το σενάριο που είχε σπάσει: «Προσθήκη χρεώστη» ενώ το πεδίο έχει τον
    // προτεινόμενο κωδικό ΠΡΟΜΗΘΕΥΤΗ. Ο χρεώστης δεν παίρνει ΠΟΤΕ κωδικό προμηθευτή.
    expect(applyCodeProposal({ current: '0004', lastProposal: '0004', proposal: '33-00002' })).toBe('33-00002');
  });

  it('ΧΕΙΡΟΚΙΝΗΤΟΣ ΚΩΔΙΚΟΣ: επιβιώνει της αλλαγής τύπου', () => {
    expect(applyCodeProposal({ current: 'ΔΙΚΟΣ-ΜΟΥ', lastProposal: '0004', proposal: '33-00002' })).toBeNull();
  });

  it('ο χειροκίνητος κωδικός επιβιώνει και δεύτερης, τρίτης αλλαγής τύπου', () => {
    const mine = { current: 'ΔΙΚΟΣ-ΜΟΥ', lastProposal: '0004' };
    expect(applyCodeProposal({ ...mine, proposal: '33-00002' })).toBeNull();
    expect(applyCodeProposal({ ...mine, proposal: '53-00002' })).toBeNull();
  });

  it('αλυσίδα προμηθευτής → χρεώστης → πιστωτής → προμηθευτής χωρίς παρέμβαση χρήστη', () => {
    // Η ακολουθία που επαληθεύτηκε και ζωντανά στην ουρά.
    let current = '';
    let lastProposal = '';
    for (const proposal of ['0004', '33-00002', '53-00002', '0004']) {
      const next = applyCodeProposal({ current, lastProposal, proposal });
      expect(next).toBe(proposal);
      current = next as string;
      lastProposal = next as string;
    }
    expect(current).toBe('0004');
  });

  it('ο χρήστης γράφει στη μέση της αλυσίδας και από εκεί και πέρα το πεδίο είναι δικό του', () => {
    let current = applyCodeProposal({ current: '', lastProposal: '', proposal: '0004' }) as string;
    const lastProposal = current;
    current = 'ΧΕΙΡΟΚΙΝΗΤΟΣ';
    expect(applyCodeProposal({ current, lastProposal, proposal: '33-00002' })).toBeNull();
    expect(applyCodeProposal({ current, lastProposal, proposal: '53-00002' })).toBeNull();
  });

  it('πεδίο με μόνο κενά μετρά ως άδειο', () => {
    expect(applyCodeProposal({ current: '   ', lastProposal: '', proposal: '53-00002' })).toBe('53-00002');
  });

  it('κενή πρόταση (ο server δεν πρότεινε) καθαρίζει το πεδίο μας, όχι του χρήστη', () => {
    expect(applyCodeProposal({ current: '0004', lastProposal: '0004', proposal: '' })).toBe('');
    expect(applyCodeProposal({ current: 'ΔΙΚΟΣ-ΜΟΥ', lastProposal: '0004', proposal: '' })).toBeNull();
  });

  it('είναι καθαρή: ίδια είσοδος, ίδια έξοδος, καμία παρενέργεια σε επανάληψη', () => {
    // Ο React εκτελεί updaters δύο φορές σε StrictMode· η απόφαση δεν επιτρέπεται να
    // αλλάζει στη δεύτερη εκτέλεση — εκεί ακριβώς είχε σπάσει η παλιά υλοποίηση.
    const input = { current: '0004', lastProposal: '0004', proposal: '33-00002' };
    const snapshot = { ...input };
    expect(applyCodeProposal(input)).toBe('33-00002');
    expect(applyCodeProposal(input)).toBe('33-00002');
    expect(input).toEqual(snapshot);
  });
});
