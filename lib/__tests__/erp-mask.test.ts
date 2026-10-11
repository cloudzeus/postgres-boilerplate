import { describe, it, expect } from 'vitest';
import { erpMaskAccepts, parseErpMaskError } from '../erp-mask';
import { proposeItemCode } from '../item-code';

describe('erpMaskAccepts — η μάσκα «nnnnnnnnn» του Demo S1', () => {
  it.each([['82130000', true], ['903100001', true], ['97861883881117', false], ['ΥΠΗΡ-0054', false], ['600-747-211', false], ['', false]])(
    '%s → %s', (code, ok) => expect(erpMaskAccepts('nnnnnnnnn', code)).toBe(ok));
  it('κυριολεκτικοί χαρακτήρες και γράμματα', () => {
    expect(erpMaskAccepts('ΥΠ-nnnn', 'ΥΠ-0042')).toBe(true);
    expect(erpMaskAccepts('ΥΠ-nnnn', 'ΥΠ_0042')).toBe(false);
    expect(erpMaskAccepts('AAnnn', 'ΑΒ123')).toBe(true);
  });
  it('χωρίς μάσκα δεν υπάρχει περιορισμός', () => expect(erpMaskAccepts(null, 'οτιδήποτε')).toBe(true));
});

describe('parseErpMaskError', () => {
  it('διαβάζει τη μάσκα από το ΑΥΤΟΥΣΙΟ μήνυμα του SoftOne', () => {
    expect(parseErpMaskError('Ο κωδικός πρέπει να είναι της μορφής nnnnnnnnn')).toBe('nnnnnnnnn');
    expect(parseErpMaskError('Ο κωδικός πρέπει να είναι της μορφής nnnnnnnnn.')).toBe('nnnnnnnnn');
    expect(parseErpMaskError('Δεν έχετε συμπληρώσει το πεδίο Φ.Π.Α.')).toBeNull();
  });
});

describe('proposeItemCode με μάσκα ERP', () => {
  const existing = ['97861883881116', '97861883881115', '97861883881114', '50132', '903100000', '8977139'];
  it('το μοτίβο βγαίνει ΜΟΝΟ από κωδικούς που τηρούν τη μάσκα', () => {
    const p = proposeItemCode({ existing, erpMask: 'nnnnnnnnn' });
    expect(p.code).toBe('903100001');
  });
  it('χωρίς μάσκα, το παλιό λάθος (14ψήφιο) — για να φαίνεται τι διορθώθηκε', () => {
    expect(proposeItemCode({ existing }).code).toBe('97861883881117');
  });
  it('κωδικός προμηθευτή εκτός μάσκας αγνοείται', () => {
    expect(proposeItemCode({ existing, supplierCode: '600-747-211', erpMask: 'nnnnnnnnn' }).source).not.toBe('supplier');
  });
});

describe('proposeItemCode — κανένας υπάρχων δεν τηρεί τη μάσκα', () => {
  it('ο πρώτος κωδικός βγαίνει από τη μάσκα και παρακάμπτει τους πιασμένους', () => {
    expect(proposeItemCode({ existing: ['ΥΠΗΡ-0045', 'ΥΠΗΡ-0053'], erpMask: 'nnnnnnnnn' }).code).toBe('000000001');
    expect(proposeItemCode({ existing: ['ΥΠΗΡ-0045', '000000001'], erpMask: 'nnnnnnnnn' }).code).not.toBe('000000001');
  });
});

describe('proposeItemCode — μοναδικότητα σε ΟΛΟ το MTRL', () => {
  it('δεν προτείνει κωδικό υπηρεσίας που έχει ήδη είδος', () => {
    // Υπηρεσίες: μόνο «000000001». Είδη: «000000002» και «000000003».
    const p = proposeItemCode({ existing: ['000000001'], takenElsewhere: ['000000002', '000000003'], erpMask: 'nnnnnnnnn' });
    expect(p.code).toBe('000000004');
  });
  it('οι κωδικοί άλλων τύπων ΔΕΝ αλλάζουν το μοτίβο', () => {
    const p = proposeItemCode({ existing: ['ΥΠ-0007'], takenElsewhere: ['97861883881116', '97861883881117'] });
    expect(p.code).toBe('ΥΠ-0008');
  });
  it('η πρώτη από τη μάσκα παρακάμπτει κωδικούς άλλων τύπων', () => {
    expect(proposeItemCode({ existing: [], takenElsewhere: ['000000001'], erpMask: 'nnnnnnnnn' }).code).toBe('000000002');
  });
});
