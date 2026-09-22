// lib/__tests__/softone-tax-offices.test.ts
// Το IRSDATA διαβάζεται ΚΑΤΑ ΟΝΟΜΑ στήλης και η Δ.Ο.Υ. γράφεται στο TRDR ως ΚΛΕΙΔΙ IRSDATA.
// Transport mocked — κανένα ζωντανό SoftOne.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import iconv from 'iconv-lite';

const { settings } = vi.hoisted(() => ({
  settings: {
    'integrations.softoneSerial': 'demo',
    'integrations.softoneAppId': 'APP',
    'integrations.softoneUser': 'user',
    'integrations.softonePass': 'pass',
    'integrations.softoneCompany': '1001',
    'integrations.softoneTokenCache': { clientID: 'TEST-CLIENT', at: Date.now() },
  } as Record<string, unknown>,
}));

vi.mock('@/lib/settings', () => ({
  getSetting: async (k: string) => settings[k],
  setSetting: async () => {},
}));

import { softoneFetchTaxOffices, buildTraderPayload } from '@/lib/softone';

let calls: Record<string, unknown>[] = [];
let queue: unknown[] = [];

beforeEach(() => {
  calls = [];
  queue = [];
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    calls.push(JSON.parse(init.body) as Record<string, unknown>);
    const next = queue.shift();
    if (next === undefined) throw new Error('Απρόσμενη κλήση SoftOne');
    const buf = iconv.encode(JSON.stringify(next), 'win1253');
    return { headers: { get: () => null }, arrayBuffer: async () => buf };
  });
});

describe('softoneFetchTaxOffices', () => {
  it('ζητά IRSDATA, CODE, NAME, ISACTIVE με GetTable (μόνο ανάγνωση)', async () => {
    queue.push({
      success: true, count: 1,
      model: [[{ name: 'IRSDATA' }, { name: 'CODE' }, { name: 'NAME' }, { name: 'ISACTIVE' }]],
      data: [['1101', '1101', 'Α΄ ΑΘΗΝΩΝ', '1']],
    });
    const r = await softoneFetchTaxOffices();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ service: 'GetTable', TABLE: 'IRSDATA', FIELDS: 'IRSDATA,CODE,NAME,ISACTIVE' });
    expect(r).toEqual([{ key: '1101', code: '1101', name: 'Α΄ ΑΘΗΝΩΝ', isActive: true }]);
  });

  it('χαρτογραφεί ΚΑΤΑ ΟΝΟΜΑ: το SoftOne αλλάζει σειρά / προσθέτει στήλες και τίποτα δεν μετακινείται', async () => {
    queue.push({
      success: true, count: 2,
      model: [[{ name: 'NAME' }, { name: 'CODE1' }, { name: 'ISACTIVE' }, { name: 'CODE' }, { name: 'IRSDATA' }]],
      data: [
        ['ΙΖ ΑΘΗΝΩΝ', 'x', '1', '1117', '1117'],
        ['ΚΑΛΛΙΘΕΑΣ', 'y', '0', '1130', '42'],
      ],
    });
    expect(await softoneFetchTaxOffices()).toEqual([
      { key: '1117', code: '1117', name: 'ΙΖ ΑΘΗΝΩΝ', isActive: true },
      { key: '42', code: '1130', name: 'ΚΑΛΛΙΘΕΑΣ', isActive: false },
    ]);
  });

  it('απάντηση χωρίς στήλη CODE ⇒ σφάλμα, όχι σιωπηλά λάθος αντιστοίχιση', async () => {
    queue.push({ success: true, model: [[{ name: 'IRSDATA' }, { name: 'NAME' }]], data: [['1', 'Χ']] });
    await expect(softoneFetchTaxOffices()).rejects.toThrow(/CODE/);
  });
});

describe('TRDR.IRSDATA στο payload', () => {
  it('γράφει το ΚΛΕΙΔΙ IRSDATA που δόθηκε — τίποτα άλλο', () => {
    const p = buildTraderPayload('supplier', { name: 'Α', afm: '094073495', irsData: '42' });
    expect(p.DATA.SUPPLIER[0]).toMatchObject({ IRSDATA: '42' });
  });

  it('χωρίς Δ.Ο.Υ. ⇒ το πεδίο λείπει (ποτέ «ΑΓΝΩΣΤΗ ΔΟΥ» / 1)', () => {
    const p = buildTraderPayload('supplier', { name: 'Α', afm: '094073495', irsData: null });
    expect(p.DATA.SUPPLIER[0]).not.toHaveProperty('IRSDATA');
  });
});
