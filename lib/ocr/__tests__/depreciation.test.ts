import { describe, it, expect } from 'vitest';
import { auditGlDepreciation, depreciationAdvice, legalClassForGl, legalClassForLine, LEGAL_DEPRECIATION } from '../depreciation';

// Οι λογιστικές κατηγορίες όπως είναι στημένες στο Demo S1 (παλιοί συντελεστές Π.Δ. 299/2003).
const GL = [
  { mtrAcn: 1001, code: 'ΕΠΙΠ', name: 'Έπιπλα', acnmsk: '14.00.00', depreciation: 20 },
  { mtrAcn: 1002, code: 'ΜΗΧΝ', name: 'Μηχανήματα', acnmsk: '12.00.00', depreciation: 15 },
  { mtrAcn: 1003, code: 'ΚΤΙΡ', name: 'Εγκαταστάσεις Κτιρίων', acnmsk: '11.00.00', depreciation: 25 },
  { mtrAcn: 1004, code: 'ΜΕΙΧ', name: 'Μεταφορικά Μέσα  ΕΙΧ', acnmsk: '13.01.00', depreciation: 15 },
  { mtrAcn: 1005, code: 'ΜΦΙΧ', name: 'Μεταφορικά Μέσα ΦΙΧ', acnmsk: '13.02.00', depreciation: 20 },
  { mtrAcn: 1006, code: 'ΥΠΟΛ', name: 'Ηλεκτρονικά Συγκροτήματα', acnmsk: '14.03.00', depreciation: 30 },
  { mtrAcn: 1007, code: 'ΤΗΛ', name: 'Εξοπλισμός τηλεπικοινωνιών', acnmsk: '14.08.00', depreciation: 20 },
  { mtrAcn: 1008, code: 'ΟΙΚ', name: 'Γήπεδα - Οικόπεδα', acnmsk: '10.00.00', depreciation: 0 },
];

describe('πίνακας άρθρου 24 ΚΦΕ', () => {
  it('βασικοί συντελεστές', () => {
    expect(LEGAL_DEPRECIATION.it.rate).toBe(20);
    expect(LEGAL_DEPRECIATION.machinery.rate).toBe(10);
    expect(LEGAL_DEPRECIATION.passenger.rate).toBe(16);
    expect(LEGAL_DEPRECIATION.goods_vehicle.rate).toBe(12);
    expect(LEGAL_DEPRECIATION.buildings.rate).toBe(4);
    expect(LEGAL_DEPRECIATION.passenger_zero.rate).toBe(50);
    expect(LEGAL_DEPRECIATION.other.rate).toBe(10);
  });
});

describe('legalClassForLine', () => {
  it('από την περιγραφή', () => {
    expect(legalClassForLine('NB APPLE MACBOOK PRO 14-INCH/M3/1T')).toBe('it');
    expect(legalClassForLine('Reactor 16m3')).toBe('machinery');
    expect(legalClassForLine('Γραφείο εργασίας και καρέκλα')).toBe('other');
    expect(legalClassForLine('Επιβατικό αυτοκίνητο Toyota Yaris')).toBe('passenger');
    expect(legalClassForLine('Ηλεκτρικό επιβατικό αυτοκίνητο')).toBe('passenger_zero');
    expect(legalClassForLine('Φορτηγό ΙΧ Isuzu')).toBe('goods_vehicle');
    expect(legalClassForLine('Wallbox φορτιστής 11kW')).toBe('ev_charging');
    expect(legalClassForLine('Βίδες')).toBeNull();
  });
});

describe('legalClassForGl / auditGlDepreciation', () => {
  it('ο λογαριασμός ΕΓΛΣ οδηγεί, το όνομα συμπληρώνει', () => {
    expect(legalClassForGl('Ηλεκτρονικά Συγκροτήματα', '14.03.00')).toBe('it');
    expect(legalClassForGl('Μεταφορικά Μέσα ΦΙΧ', '13.02.00')).toBe('goods_vehicle');
    expect(legalClassForGl('Μεταφορικά Μέσα  ΕΙΧ', '13.01.00')).toBe('passenger');
    expect(legalClassForGl('Γήπεδα - Οικόπεδα', '10.00.00')).toBe('land');
  });
  it('Demo S1: οι κατηγορίες έχουν παλιούς συντελεστές — μόνο τα οικόπεδα συμφωνούν', () => {
    const a = auditGlDepreciation(GL);
    expect(a.find((r) => r.code === 'ΥΠΟΛ')).toMatchObject({ glRate: 30, legalRate: 20, mismatch: true });
    expect(a.find((r) => r.code === 'ΚΤΙΡ')).toMatchObject({ glRate: 25, legalRate: 4, mismatch: true });
    expect(a.find((r) => r.code === 'ΟΙΚ')).toMatchObject({ legalRate: 0, mismatch: false });
    expect(a.filter((r) => r.mismatch)).toHaveLength(7);
  });
});

describe('depreciationAdvice', () => {
  it('MacBook 2.523,39 € σε «Ηλεκτρονικά Συγκροτήματα» 30% → νόμος 20%, 504,68 €/έτος, 5 έτη', () => {
    expect(depreciationAdvice({ lineName: 'NB APPLE MACBOOK PRO', amount: 2523.39, gl: GL[5] })).toMatchObject({
      cls: 'it', rate: 20, from: 'line', glRate: 30, mismatch: true, annual: 504.68, years: 5, lowValue: false,
    });
  });
  it('η περιγραφή υπερισχύει της κατηγορίας· χωρίς περιγραφή → από την κατηγορία', () => {
    expect(depreciationAdvice({ lineName: 'Laptop Dell', amount: 900, gl: GL[0] })?.cls).toBe('it');
    expect(depreciationAdvice({ lineName: 'Κάτι', amount: 3000, gl: GL[1] })).toMatchObject({ cls: 'machinery', from: 'gl', rate: 10, glRate: 15 });
    expect(depreciationAdvice({ lineName: 'Κάτι', amount: 3000, gl: null })).toBeNull();
  });
  it('κάτω από 1.500 € → δυνατή εφάπαξ απόσβεση', () => {
    expect(depreciationAdvice({ lineName: 'Laptop Lenovo', amount: 899, gl: null })?.lowValue).toBe(true);
    expect(depreciationAdvice({ lineName: 'Laptop Lenovo', amount: 1500, gl: null })?.lowValue).toBe(false);
  });
});
