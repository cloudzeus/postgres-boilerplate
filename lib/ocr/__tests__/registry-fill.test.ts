// lib/ocr/__tests__/registry-fill.test.ts
// Ποια τιμή κερδίζει: ΧΡΗΣΤΗΣ > ΜΗΤΡΩΟ (ΑΑΔΕ/VIES) > OCR > κενό. Καθαρή λογική, κανένα I/O.
import { describe, it, expect } from 'vitest';
import { planRegistryFill, registryValue } from '../registry-fill';

type K = 'name' | 'irsData' | 'profession' | 'address' | 'zip' | 'city';

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
    expect(planRegistryFill<K>({ registry: {} })).toEqual({ values: {}, applied: [], skipped: [], cleared: [] });
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

describe('planRegistryFill — Δ.Ο.Υ. που η ΑΑΔΕ δίνει αλλά το SoftOne δεν έχει (`clear`)', () => {
  it('το πεδίο ΑΔΕΙΑΖΕΙ (η τιμή του OCR είναι γνωστά λάθος) — δεν μπαίνει μαντεψιά', () => {
    const r = planRegistryFill<K>({ registry: { name: 'DGSOFT ΕΕ', irsData: null }, clear: ['irsData'] });
    expect(r.values).toEqual({ name: 'DGSOFT ΕΕ', irsData: '' });
    expect(r.cleared).toEqual(['irsData']);
    expect(r.applied).toEqual(['name']);
  });

  it('Δ.Ο.Υ. που διάλεξε ο ΧΡΗΣΤΗΣ δεν σβήνεται ποτέ', () => {
    const r = planRegistryFill<K>({ registry: {}, clear: ['irsData'], userOwned: ['irsData'] });
    expect(r.values).toEqual({});
    expect(r.cleared).toEqual([]);
    expect(r.skipped).toEqual(['irsData']);
  });

  it('ούτε ξαναγράφεται από τιμή μητρώου', () => {
    const r = planRegistryFill<K>({ registry: { irsData: '1101' }, userOwned: ['irsData'] });
    expect(r.values).toEqual({});
    expect(r.skipped).toEqual(['irsData']);
  });

  it('χωρίς `clear` (π.χ. η ΑΑΔΕ δεν έδωσε Δ.Ο.Υ. ή το SoftOne δεν απάντησε) τίποτα δεν σβήνεται', () => {
    const r = planRegistryFill<K>({ registry: { irsData: null } });
    expect(r.values).toEqual({});
    expect(r.cleared).toEqual([]);
  });

  it('πραγματική τιμή μητρώου για το ίδιο πεδίο κερδίζει το `clear`', () => {
    const r = planRegistryFill<K>({ registry: { irsData: '1101' }, clear: ['irsData'] });
    expect(r.values).toEqual({ irsData: '1101' });
    expect(r.cleared).toEqual([]);
  });
});
