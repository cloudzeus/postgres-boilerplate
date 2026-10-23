import { describe, it, expect, vi } from 'vitest';
vi.mock('@/lib/settings', () => ({ getSetting: async () => undefined, setSetting: async () => {} }));
import { buildItemPayload } from '@/lib/softone';

const base = { code: '978960605', name: 'ΕΛΑΣΤΙΚΟ 205/55-16', isService: false, vat: '1410', unit: '101' };

describe('buildItemPayload — κωδικοί αγοράς', () => {
  it('EAN → CODE1, κωδ. κατασκευαστή → CODE2, κωδικός προμηθευτή → MTRSUP + MTRSUPCODE', () => {
    const p = buildItemPayload({
      ...base, code1: '5201234567894', code2: 'PCY5-205', supplier: { trdr: 2791, code: 'M-99-41034', name: '205/55-16 91V PCY5' },
    });
    expect(p.OBJECT).toBe('ITEM');
    expect(p.DATA).toMatchObject({
      ITEM: [expect.objectContaining({ CODE: '978960605', CODE1: '5201234567894', CODE2: 'PCY5-205', MTRSUP: 2791 })],
      MTRSUPCODE: [{ TRDR: 2791, MTRSUPCODE: 'M-99-41034', MTRSUPNAME: '205/55-16 91V PCY5' }],
    });
  });
  it('χωρίς τίποτα από αυτά: ίδιο payload με πριν (κανένα CODE1/CODE2/MTRSUPCODE)', () => {
    const p = buildItemPayload(base);
    expect(p.DATA).not.toHaveProperty('MTRSUPCODE');
    expect((p.DATA as { ITEM: Record<string, unknown>[] }).ITEM[0]).not.toHaveProperty('CODE1');
  });
  it('προμηθευτής χωρίς κωδικό: συνήθης προμηθευτής, χωρίς γραμμή εναλλακτικού κωδικού', () => {
    const p = buildItemPayload({ ...base, supplier: { trdr: 2791, code: null, name: null } });
    expect((p.DATA as { ITEM: Record<string, unknown>[] }).ITEM[0].MTRSUP).toBe(2791);
    expect(p.DATA).not.toHaveProperty('MTRSUPCODE');
  });
});

describe('buildItemPayload — Περιγραφή 2 (NAME1)', () => {
  it('η αρχική ξένη περιγραφή πάει στο NAME1, σε είδος και σε υπηρεσία', () => {
    const p = buildItemPayload({ ...base, name: 'ΣΩΛΗΝΑΣ ΛΕΙΟΣ', name2: 'TUBO SMOOTH' });
    expect((p.DATA as { ITEM: Record<string, unknown>[] }).ITEM[0]).toMatchObject({ NAME: 'ΣΩΛΗΝΑΣ ΛΕΙΟΣ', NAME1: 'TUBO SMOOTH' });
    const s = buildItemPayload({ ...base, isService: true, name2: 'Service fee' });
    expect((s.DATA as { SERVICE: Record<string, unknown>[] }).SERVICE[0].NAME1).toBe('Service fee');
  });
  it('χωρίς αρχική: κανένα NAME1 (δεν σβήνουμε τίποτα)', () => {
    expect((buildItemPayload(base).DATA as { ITEM: Record<string, unknown>[] }).ITEM[0]).not.toHaveProperty('NAME1');
  });
});

describe('υπηρεσία με χαρακτηρισμό myDATA', () => {
  it('myDataCode ⇒ MYDATACODE στο payload (αλλιώς η υπηρεσία μένει αχαρακτήριστη)', () => {
    const p = buildItemPayload({ code: 'ΥΠΗΡ-9999', name: 'Δοκιμή', isService: true, vat: '1410', unit: '101', myDataCode: '7' });
    expect((p.DATA as { SERVICE: Record<string, unknown>[] }).SERVICE[0]).toMatchObject({ MYDATACODE: '7', VAT: '1410' });
  });
});
