// lib/ocr/__tests__/registry-fill.test.ts
// Ποια τιμή κερδίζει: ΧΡΗΣΤΗΣ > ΜΗΤΡΩΟ (ΑΑΔΕ/VIES) > OCR > κενό. Καθαρή λογική, κανένα I/O.
import { describe, it, expect } from 'vitest';
import { planRegistryFill, registryValue } from '../registry-fill';

type K = 'name' | 'doyCode' | 'profession' | 'address' | 'zip' | 'city';

describe('registryValue — τι μετράει ως τιμή', () => {
  it('καθαρίζει κενά και πολλαπλά διαστήματα', () => {
    expect(registryValue('  ΑΛΦΑ   ΑΕ ')).toBe('ΑΛΦΑ ΑΕ');
  });

  it('το «---» του VIES ΔΕΝ είναι τιμή — είναι «κρυφό»', () => {
    expect(registryValue('---')).toBeNull();
    expect(registryValue('-')).toBeNull();
    expect(registryValue('-----')).toBeNull();
  });

  it('κενό, null και undefined δεν είναι τιμές', () => {
    expect(registryValue('')).toBeNull();
    expect(registryValue('   ')).toBeNull();
    expect(registryValue(null)).toBeNull();
    expect(registryValue(undefined)).toBeNull();
  });
});

describe('planRegistryFill — το μητρώο κερδίζει το OCR', () => {
  it('εφαρμόζει ό,τι έδωσε το μητρώο, ακόμη κι αν το πεδίο έχει ήδη τιμή OCR', () => {
    const r = planRegistryFill<K>({
      registry: { name: 'ΑΛΦΑ ΑΝΩΝΥΜΗ ΕΤΑΙΡΕΙΑ', city: 'ΑΘΗΝΑ' },
    });
    expect(r.values).toEqual({ name: 'ΑΛΦΑ ΑΝΩΝΥΜΗ ΕΤΑΙΡΕΙΑ', city: 'ΑΘΗΝΑ' });
    expect(r.applied.sort()).toEqual(['city', 'name']);
    expect(r.skipped).toEqual([]);
  });

  it('πεδίο που κατέχει ο ΧΡΗΣΤΗΣ δεν ξαναγράφεται ποτέ', () => {
    const r = planRegistryFill<K>({
      registry: { name: 'ΑΛΦΑ ΑΕ', address: 'ΑΘΗΝΩΝ 1' },
      userOwned: ['name'],
    });
    expect(r.values).toEqual({ address: 'ΑΘΗΝΩΝ 1' });
    expect(r.applied).toEqual(['address']);
    expect(r.skipped).toEqual(['name']);
  });

  it('η κατοχή δηλώνεται ΡΗΤΑ, δεν συμπεραίνεται από ισότητα τιμών', () => {
    // Ο χρήστης πληκτρολόγησε ακριβώς ό,τι λέει και το μητρώο: μένει δικό του.
    const r = planRegistryFill<K>({ registry: { name: 'ΑΛΦΑ ΑΕ' }, userOwned: ['name'] });
    expect(r.applied).toEqual([]);
    expect(r.skipped).toEqual(['name']);
  });
});

describe('«δεν βρέθηκε» / «ανενεργό» / κρυφό πεδίο δεν σβήνουν τίποτα', () => {
  it('άδειο μητρώο ⇒ καμία εγγραφή (οι τιμές του OCR μένουν)', () => {
    expect(planRegistryFill<K>({ registry: {} })).toEqual({ values: {}, applied: [], skipped: [] });
  });

  it('μητρώο με μόνο κενές τιμές ⇒ καμία εγγραφή, κανένα σβήσιμο', () => {
    const r = planRegistryFill<K>({
      registry: { name: null, address: '', profession: undefined, city: '   ' },
    });
    expect(r.values).toEqual({});
    expect(r.applied).toEqual([]);
  });

  it('VIES που κρύβει την επωνυμία («---») εφαρμόζει μόνο τη διεύθυνση', () => {
    const r = planRegistryFill<K>({ registry: { name: '---', address: '1 MAIN ST, DUBLIN' } });
    expect(r.values).toEqual({ address: '1 MAIN ST, DUBLIN' });
    expect(r.applied).toEqual(['address']);
  });
});
