// lib/__tests__/item-code.test.ts
// Η πρόταση κωδικού για νέα εγγραφή μητρώου ειδών. Καθαρή λογική — κανένα I/O, κανένα mock.
import { describe, it, expect } from 'vitest';
import { proposeItemCode, itemCodeMaskKey, isItemCodeKind } from '../item-code';
import { nextCode, isCodeTaken } from '../next-code';
import { nextTraderCode } from '../trader-code';

describe('κανόνας 1 — ο κωδικός του προμηθευτή, αν είναι ελεύθερος', () => {
  it('ελεύθερος κωδικός γραμμής ⇒ τον κρατάμε αυτούσιο', () => {
    expect(proposeItemCode({ existing: ['00001', '00002'], supplierCode: 'ABC-991' })).toEqual({
      code: 'ABC-991', source: 'supplier', taken: 2, supplierCodeTaken: false, supplierCode: 'ABC-991',
    });
  });

  it('ο έλεγχος αγνοεί κεφαλαία/πεζά: «abc-991» δεν είναι ελεύθερο όταν υπάρχει «ABC-991»', () => {
    const r = proposeItemCode({ existing: ['ABC-991'], supplierCode: 'abc-991', mask: '00001' });
    expect(r.source).not.toBe('supplier');
    expect(r.supplierCodeTaken).toBe(true);
  });
});

describe('κανόνας 2 — ο επόμενος ελεύθερος της ΔΙΚΗΣ μας αρίθμησης', () => {
  it('πιασμένος κωδικός προμηθευτή ⇒ πέφτουμε στη σειρά, και το λέμε', () => {
    expect(proposeItemCode({ existing: ['00001', '00002', 'ABC-991'], supplierCode: 'ABC-991' })).toMatchObject({
      code: '00003', source: 'pattern', supplierCodeTaken: true, supplierCode: 'ABC-991',
    });
  });

  it('γραμμή χωρίς κωδικό ⇒ σειρά, χωρίς ψεύτικο «πιασμένος»', () => {
    expect(proposeItemCode({ existing: ['ΥΠ.0007'], supplierCode: null })).toMatchObject({
      code: 'ΥΠ.0008', source: 'pattern', supplierCodeTaken: false, supplierCode: null,
    });
  });

  it('κενό string κωδικού γραμμής μετρά ως «δεν υπάρχει»', () => {
    expect(proposeItemCode({ existing: ['0001'], supplierCode: '   ' }).supplierCodeTaken).toBe(false);
  });
});

describe('άδειο μητρώο — μάσκα, αλλιώς ΤΙΠΟΤΑ', () => {
  it('χωρίς κανέναν κωδικό η μάσκα δίνει τον πρώτο', () => {
    expect(proposeItemCode({ existing: [], mask: 'ΕΞ-0001' })).toMatchObject({ code: 'ΕΞ-0001', source: 'mask' });
  });

  it('χωρίς κωδικούς ΚΑΙ χωρίς μάσκα δεν εφευρίσκουμε τίποτα', () => {
    expect(proposeItemCode({ existing: [], mask: '' })).toMatchObject({ code: null, source: 'none' });
  });

  it('ο κωδικός προμηθευτή ισχύει ακόμη και σε άδειο μητρώο — προηγείται της μάσκας', () => {
    expect(proposeItemCode({ existing: [], supplierCode: 'K-77', mask: '0001' }))
      .toMatchObject({ code: 'K-77', source: 'supplier' });
  });
});

/**
 * Ο παλιός δρόμος ήταν slug της ΠΕΡΙΓΡΑΦΗΣ, κομμένο στους 20 χαρακτήρες. Δύο διαφορετικές
 * μακριές περιγραφές του ίδιου προμηθευτή κατέληγαν στον ΙΔΙΟ κωδικό — και κανείς δεν ρωτούσε
 * αν ήταν ελεύθερος. Η πρόταση σήμερα δεν βλέπει καν την περιγραφή.
 */
describe('οι συγκρούσεις του slug δεν μπορούν πια να συμβούν', () => {
  const A = 'Χρέωση Προμηθείας Ρεύματος (Α)';
  const B = 'Χρέωση Προμηθείας Ρεύματος (Β)';
  const slug20 = (s: string) => s.toUpperCase().replace(/[^0-9A-ZΑ-ΩΆΈΉΊΌΎΏΪΫ]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20);

  it('οι δύο περιγραφές ΕΙΧΑΝ κοινό slug — η απόδειξη του παλιού λάθους', () => {
    expect(slug20(A)).toBe(slug20(B));
  });

  it('…ενώ οι δύο προτάσεις σήμερα είναι διαφορετικές και ΕΛΕΥΘΕΡΕΣ', () => {
    const first = proposeItemCode({ existing: ['00001'] });
    const second = proposeItemCode({ existing: ['00001', first.code!] });
    expect(first.code).toBe('00002');
    expect(second.code).toBe('00003');
    expect(isCodeTaken(['00001', first.code!], second.code!)).toBe(false);
  });
});

describe('κλειδιά ρυθμίσεων και type guard', () => {
  it('η μάσκα ζει δίπλα στην αντίστοιχη του συναλλασσομένου', () => {
    expect(itemCodeMaskKey('service')).toBe('softone.itemCodeMask.service');
    expect(itemCodeMaskKey('lineitem')).toBe('softone.itemCodeMask.lineitem');
  });

  it('isItemCodeKind δέχεται μόνο τα τέσσερα μητρώα', () => {
    expect(isItemCodeKind('expense')).toBe(true);
    expect(isItemCodeKind('supplier')).toBe(false);
  });
});

/** Η γενίκευση δεν άλλαξε τη συμπεριφορά: ο συναλλασσόμενος περνά από την ΙΔΙΑ μηχανή. */
describe('nextTraderCode === nextCode', () => {
  it.each([
    [['53-00001'], { mask: undefined as string | undefined }],
    [['0001', '0002', '0004'], { mask: undefined }],
    [[], { mask: '33-00001' }],
    [[], { mask: '' }],
  ])('ίδιο αποτέλεσμα για %j', (existing, opts) => {
    expect(nextTraderCode(existing, opts)).toEqual(nextCode(existing, opts));
  });
});
