// lib/__tests__/softone-traders.test.ts
// Καλύπτει τα helpers συναλλασσομένων του lib/softone.ts χωρίς να αγγίξει το ζωντανό SoftOne:
// το transport (fetch) είναι mocked, οπότε ελέγχουμε payloads + τη ροή read-back.
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

import {
  buildTraderPayload, softoneCreateSupplier, softoneCreateCreditor, TRADER_KIND_SODTYPE,
} from '@/lib/softone';

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

const INPUT = { name: 'ΑΛΦΑ ΑΕ', afm: '094073495' };
const row = (p: { OBJECT: string; DATA: Record<string, Record<string, unknown>[]> }) => p.DATA[p.OBJECT][0];

describe('buildTraderPayload', () => {
  it('γράφει στο object SUPPLIER/CREDITOR με κενό KEY — το SODTYPE το βάζει το ίδιο το object', () => {
    expect(buildTraderPayload('supplier', INPUT).OBJECT).toBe('SUPPLIER');
    expect(buildTraderPayload('creditor', INPUT).OBJECT).toBe('CREDITOR');
    expect(buildTraderPayload('supplier', INPUT).KEY).toBe('');
    expect(row(buildTraderPayload('supplier', INPUT))).toEqual({ NAME: 'ΑΛΦΑ ΑΕ', AFM: '094073495', ISACTIVE: 1 });
  });

  it('στέλνει τηλέφωνο/email ως PHONE01/EMAIL όταν δίνονται', () => {
    const r = row(buildTraderPayload('creditor', { ...INPUT, phone: '2101234567', email: 'a@b.gr' }));
    expect(r).toMatchObject({ PHONE01: '2101234567', EMAIL: 'a@b.gr' });
  });

  it('παραλείπει τα κενά προαιρετικά πεδία αντί να στείλει κενά strings', () => {
    const r = row(buildTraderPayload('supplier', { ...INPUT, phone: null, email: '', city: undefined }));
    expect(r).not.toHaveProperty('PHONE01');
    expect(r).not.toHaveProperty('EMAIL');
    expect(r).not.toHaveProperty('CITY');
  });
});

describe('softoneCreateTrader', () => {
  it('διαβάζει ΠΑΝΤΑ πίσω τη γραμμή (TRDR/CODE/SODTYPE) και επιστρέφει το CODE του SoftOne', async () => {
    queue = [
      { success: true, id: '5001' },
      { success: true, data: [['5001', 'Π.0042', '12']] },
    ];

    const res = await softoneCreateSupplier({ ...INPUT, phone: '2101234567', email: 'a@b.gr' });

    expect(calls.map((c) => c.service)).toEqual(['setData', 'GetTable']);
    expect(row(calls[0].body as never)).toMatchObject({ NAME: 'ΑΛΦΑ ΑΕ', PHONE01: '2101234567', EMAIL: 'a@b.gr' });
    expect(calls[1].body).toMatchObject({ TABLE: 'TRDR', FIELDS: 'TRDR,CODE,SODTYPE', FILTER: 'TRDR=5001' });
    expect(res).toEqual({ trdr: 5001, code: 'Π.0042' });
  });

  it('διαβάζει πίσω ΚΑΙ όταν ο κωδικός δόθηκε από τον χρήστη (success ≠ persisted)', async () => {
    queue = [
      { success: true, id: '5002' },
      { success: true, data: [['5002', 'ΔΙΚΟΣ.1', '16']] },
    ];
    const res = await softoneCreateCreditor({ ...INPUT, code: 'ΔΙΚΟΣ.1' });
    expect(calls.map((c) => c.service)).toEqual(['setData', 'GetTable']);
    expect(res).toEqual({ trdr: 5002, code: 'ΔΙΚΟΣ.1' });
  });

  it('πέφτει όταν η γραμμή δεν βρίσκεται μετά το setData', async () => {
    queue = [{ success: true, id: '5003' }, { success: true, data: [] }];
    await expect(softoneCreateSupplier(INPUT)).rejects.toThrow('Η εγγραφή δεν επιβεβαιώθηκε στο SoftOne');
  });

  it('πέφτει όταν το SODTYPE δεν είναι αυτό που δίνει το object', async () => {
    // Πελάτης (13) αντί για προμηθευτή (12): κάτι έγραψε λάθος γραμμή — δεν το καθρεφτίζουμε.
    queue = [{ success: true, id: '5004' }, { success: true, data: [['5004', 'Π.0001', '13']] }];
    await expect(softoneCreateSupplier(INPUT)).rejects.toThrow('Η εγγραφή δεν επιβεβαιώθηκε στο SoftOne');

    queue = [{ success: true, id: '5005' }, { success: true, data: [['5005', 'Π.0002', '12']] }];
    // Ο πιστωτής περιμένει 16: γραμμή με 12 είναι εξίσου λάθος.
    await expect(softoneCreateCreditor(INPUT)).rejects.toThrow('Η εγγραφή δεν επιβεβαιώθηκε στο SoftOne');
    expect(TRADER_KIND_SODTYPE).toEqual({ supplier: 12, creditor: 16 });
  });

  it('πέφτει όταν το setData επιστρέψει σφάλμα — χωρίς read-back', async () => {
    queue = [{ success: false, error: 'Δεν επιτρέπεται', errorcode: 101 }];
    await expect(softoneCreateSupplier(INPUT)).rejects.toThrow('Δεν επιτρέπεται');
    expect(calls.map((c) => c.service)).toEqual(['setData']);
  });
});
