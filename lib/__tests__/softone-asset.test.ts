// lib/__tests__/softone-asset.test.ts
// Καλύπτει τη δημιουργία παγίου του lib/softone.ts χωρίς να αγγίζει το ζωντανό SoftOne:
// το transport (fetch) είναι mocked, οπότε ελέγχουμε payloads + τη ροή read-before-write.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import iconv from 'iconv-lite';

const { settings } = vi.hoisted(() => ({
  settings: {
    'integrations.softoneSerial': 'demo',
    'integrations.softoneAppId': 'APP',
    'integrations.softoneUser': 'user',
    'integrations.softonePass': 'pass',
    'integrations.softoneCompany': '1001',
    // Φρέσκο cached token → καμία κλήση login/authenticate στα tests.
    'integrations.softoneTokenCache': { clientID: 'TEST-CLIENT', at: Date.now() },
  } as Record<string, unknown>,
}));

vi.mock('@/lib/settings', () => ({
  getSetting: async (k: string) => settings[k],
  setSetting: async () => {},
}));

import { buildAssetPayload, softoneCreateAsset, type CreateAssetInput } from '@/lib/softone';

type Call = { service: string; body: Record<string, unknown> };
let calls: Call[] = [];
let queue: unknown[] = [];

function respond(payload: unknown) {
  const buf = iconv.encode(JSON.stringify(payload), 'win1253');
  return { headers: { get: () => null }, arrayBuffer: async () => buf };
}

beforeEach(() => {
  calls = [];
  queue = [];
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    calls.push({ service: String(body.service), body });
    const next = queue.shift();
    if (next === undefined) throw new Error(`Απρόσμενη κλήση SoftOne: ${String(body.service)}`);
    return respond(next);
  });
});

const input: CreateAssetInput = {
  code: '14.03.00.0014', name: 'MacBook Pro 14', mtrAcn: 1006, mtrCategory: 1005, vat: '1410', acnmsk: '14.03.00',
  units: { mtrunit1: '101', mtrunit3: '101', mtrunit4: null },
};

describe('buildAssetPayload', () => {
  it('object ASSET, μονάδες από το πρότυπο, λογιστική κατηγορία και λογαριασμός αγορών', () => {
    expect(buildAssetPayload(input)).toEqual({
      OBJECT: 'ASSET', KEY: '',
      DATA: { ASSET: [{
        CODE: '14.03.00.0014', NAME: 'MacBook Pro 14', MTRACN: 1006, VAT: '1410',
        MTRUNIT1: '101', MTRUNIT3: '101', MTRUNIT4: '101', MU31: 1, MU41: 1, ISACTIVE: 1,
        MTRCATEGORY: 1005, ACNMSK: '14.03.00',
      }] },
    });
  });
});

describe('softoneCreateAsset', () => {
  it('επιστρέφει το MTRL όταν το SoftOne το έγραψε ως πάγιο (SODTYPE 54)', async () => {
    queue.push({ success: true, id: '9001' }, { success: true, data: [['9001', '54', '14.03.00.0014']] });
    await expect(softoneCreateAsset(input)).resolves.toBe(9001);
    expect(calls[0].body).toMatchObject({ service: 'setData', OBJECT: 'ASSET' });
  });
  it('πετάει αν το SoftOne έγραψε άλλον τύπο', async () => {
    queue.push({ success: true, id: '9002' }, { success: true, data: [['9002', '51', 'X']] });
    await expect(softoneCreateAsset(input)).rejects.toThrow(/SODTYPE 51 αντί για 54/);
  });
  it('μεταφέρει το μήνυμα του SoftOne σε αποτυχία', async () => {
    queue.push({ success: false, error: 'Δεν έχετε συμπληρώσει Μ.Μ.Αγορών' });
    await expect(softoneCreateAsset(input)).rejects.toThrow(/Μ\.Μ\.Αγορών/);
  });
});
