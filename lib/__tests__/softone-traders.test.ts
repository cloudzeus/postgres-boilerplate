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
  buildTraderPayload, softoneCreateSupplier, softoneCreateCreditor, softoneCreateDebtor,
  softoneCreateTrader, softoneFindTraderByAfm, isMissingCodeError, isDuplicateCodeError,
  softoneFetchTraderCodes, softoneNextTraderCode, clearTraderCodeCache,
  TRADER_KIND_SODTYPE, ISSUER_SODTYPES,
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
  it('γράφει στο object SUPPLIER/CREDITOR/DEBTOR με κενό KEY — το SODTYPE το βάζει το ίδιο το object', () => {
    expect(buildTraderPayload('supplier', INPUT).OBJECT).toBe('SUPPLIER');
    expect(buildTraderPayload('creditor', INPUT).OBJECT).toBe('CREDITOR');
    expect(buildTraderPayload('debtor', INPUT).OBJECT).toBe('DEBTOR');
    // Ίδια ΑΚΡΙΒΩΣ γραμμή στα τρία objects: το SODTYPE δεν γράφεται ποτέ από εμάς.
    expect(row(buildTraderPayload('debtor', INPUT))).toEqual(row(buildTraderPayload('supplier', INPUT)));
    expect(row(buildTraderPayload('debtor', INPUT))).not.toHaveProperty('SODTYPE');
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

  it('στέλνει LATITUDE/LONGITUDE ως Float όταν υπάρχει έγκυρο ζεύγος', () => {
    const r = row(buildTraderPayload('supplier', { ...INPUT, latitude: 37.9755, longitude: 23.7348 }));
    expect(r).toMatchObject({ LATITUDE: 37.9755, LONGITUDE: 23.7348 });
  });

  it.each([
    ['μισό ζεύγος (μόνο lat)', { latitude: 37.9755, longitude: null }],
    ['μισό ζεύγος (μόνο lng)', { latitude: null, longitude: 23.7348 }],
    ['άγνωστο = (0,0) — ΠΟΤΕ δεν γράφεται ως πραγματικό σημείο', { latitude: 0, longitude: 0 }],
    ['εκτός ορίων', { latitude: 137.9, longitude: 23.7 }],
    ['χωρίς συντεταγμένες', {}],
  ])('παραλείπει και τα δύο πεδία: %s', (_label, coords) => {
    const r = row(buildTraderPayload('creditor', { ...INPUT, ...coords }));
    expect(r).not.toHaveProperty('LATITUDE');
    expect(r).not.toHaveProperty('LONGITUDE');
  });
});

describe('isMissingCodeError', () => {
  it('αναγνωρίζει το ΑΥΤΟΥΣΙΟ μήνυμα του SoftOne (επιβεβαιωμένο ζωντανά σε πιστωτή)', () => {
    expect(isMissingCodeError("Δεν έχετε συμπληρώσει το πεδίο 'Κωδικός'")).toBe(true);
    expect(isMissingCodeError('Δεν εχετε συμπληρωσει το πεδιο «Κωδικος»')).toBe(true);
    expect(isMissingCodeError('Field Code is required')).toBe(true);
  });

  it('ΔΕΝ μπερδεύει άλλο υποχρεωτικό πεδίο με τον κωδικό', () => {
    expect(isMissingCodeError("Δεν έχετε συμπληρώσει το πεδίο 'Επωνυμία'")).toBe(false);
    expect(isMissingCodeError('Ο κωδικός χώρας δεν βρέθηκε στο μητρώο')).toBe(false);
    expect(isMissingCodeError('')).toBe(false);
    expect(isMissingCodeError(null)).toBe(false);
  });
});

describe('isDuplicateCodeError', () => {
  it('αναγνωρίζει τις συνήθεις διατυπώσεις «υπάρχει ήδη»', () => {
    expect(isDuplicateCodeError('Ο κωδικός 53-00002 υπάρχει ήδη')).toBe(true);
    expect(isDuplicateCodeError('Υπάρχει ήδη εγγραφή με αυτόν τον κωδικό')).toBe(true);
    expect(isDuplicateCodeError('Duplicate code')).toBe(true);
  });

  it('δεν συγχέεται με την έλλειψη κωδικού — είναι άλλη ενέργεια για τον χρήστη', () => {
    expect(isDuplicateCodeError("Δεν έχετε συμπληρώσει το πεδίο 'Κωδικός'")).toBe(false);
    expect(isDuplicateCodeError('Το ΑΦΜ υπάρχει ήδη')).toBe(false);
  });
});

describe('softoneFetchTraderCodes / softoneNextTraderCode', () => {
  beforeEach(() => clearTraderCodeCache());

  it('διαβάζει ΜΟΝΟ τους κωδικούς του SODTYPE του τύπου (read-only GetTable)', async () => {
    queue = [{ success: true, data: [['53-00001'], ['53-00002']] }];
    await expect(softoneFetchTraderCodes('creditor')).resolves.toEqual(['53-00001', '53-00002']);
    expect(calls[0].body).toMatchObject({ TABLE: 'TRDR', FIELDS: 'CODE', FILTER: 'SODTYPE=16' });
  });

  it('cache-άρει: δεύτερη κλήση μέσα στο παράθυρο δεν ξαναρωτά το SoftOne', async () => {
    queue = [{ success: true, data: [['0001']] }];
    await softoneFetchTraderCodes('supplier');
    await softoneFetchTraderCodes('supplier');
    expect(calls).toHaveLength(1);
  });

  it('προτείνει τον επόμενο ελεύθερο από τα ΦΡΕΣΚΑ δεδομένα του ERP', async () => {
    queue = [{ success: true, data: [['53-00001']] }];
    await expect(softoneNextTraderCode('creditor')).resolves
      .toMatchObject({ code: '53-00002', source: 'pattern', stale: false });
  });

  it('SoftOne εκτός: πέφτει στον τοπικό καθρέφτη και το ΔΗΛΩΝΕΙ (stale)', async () => {
    queue = [{ success: false, error: 'down' }];
    await expect(softoneNextTraderCode('creditor', { fallbackCodes: ['53-00004'] })).resolves
      .toMatchObject({ code: '53-00005', stale: true });
  });

  it('χωρίς κανένα δεδομένο και χωρίς μάσκα δεν προτείνει τίποτα', async () => {
    queue = [{ success: true, data: [] }];
    await expect(softoneNextTraderCode('debtor')).resolves.toMatchObject({ code: null, source: 'none' });
  });
});

describe('softoneCreateTrader', () => {
  it('διαβάζει ΠΑΝΤΑ πίσω τη γραμμή (TRDR/CODE/SODTYPE) και επιστρέφει το CODE του SoftOne', async () => {
    queue = [
      { success: true, id: '5001' },
      { success: true, data: [['5001', 'Π.0042', '12']] },
    ];

    clearTraderCodeCache();
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
    queue = [{ success: true, id: '5006' }, { success: true, data: [['5006', 'Χ.0001', '16']] }];
    // Ο χρεώστης περιμένει 15: γραμμή με 16 είναι εξίσου λάθος.
    await expect(softoneCreateDebtor(INPUT)).rejects.toThrow('Η εγγραφή δεν επιβεβαιώθηκε στο SoftOne');
    expect(TRADER_KIND_SODTYPE).toEqual({ supplier: 12, creditor: 16, debtor: 15 });
  });

  it.each([
    ['supplier', 'SUPPLIER', 12],
    ['creditor', 'CREDITOR', 16],
    ['debtor', 'DEBTOR', 15],
  ] as const)('%s → object %s, read-back απαιτεί SODTYPE %i', async (kind, object, sodtype) => {
    queue = [{ success: true, id: '5100' }, { success: true, data: [['5100', 'X.1', String(sodtype)]] }];
    const res = await softoneCreateTrader(kind, INPUT);
    expect(calls[0].body.OBJECT).toBe(object);
    expect(res).toEqual({ trdr: 5100, code: 'X.1' });

    // Κάθε ΑΛΛΟ SODTYPE στη γραμμή = ανεπιβεβαίωτη εγγραφή, ό,τι κι αν είπε το `success`.
    for (const wrong of [12, 13, 14, 15, 16].filter((v) => v !== sodtype)) {
      queue = [{ success: true, id: '5101' }, { success: true, data: [['5101', 'X.2', String(wrong)]] }];
      await expect(softoneCreateTrader(kind, INPUT)).rejects.toThrow(`SODTYPE ${wrong} ≠ ${sodtype}`);
    }
  });

  it('πέφτει όταν το setData επιστρέψει σφάλμα — χωρίς read-back', async () => {
    queue = [{ success: false, error: 'Δεν επιτρέπεται', errorcode: 101 }];
    await expect(softoneCreateSupplier(INPUT)).rejects.toThrow('Δεν επιτρέπεται');
    expect(calls.map((c) => c.service)).toEqual(['setData']);
  });
});

describe('softoneFindTraderByAfm — προτίμηση τύπου', () => {
  /** Ένα GetTable που γυρίζει τις δοσμένες γραμμές TRDR/CODE/NAME/SODTYPE. */
  const rows = (...r: [number, string, string, number][]) =>
    ({ success: true, data: r.map(([trdr, code, name, sod]) => [String(trdr), code, name, String(sod)]) });

  it('ρωτά και για τους τρεις τύπους, με τη σειρά προτίμησης 12 → 16 → 15', async () => {
    expect([...ISSUER_SODTYPES]).toEqual([12, 16, 15]);
    queue = [rows([1, 'Χ.1', 'ΑΛΦΑ', 15])];
    const m = await softoneFindTraderByAfm('094073495');
    expect(String(calls[0].body.FILTER)).toContain('SODTYPE IN (12,16,15)');
    // Ένα ΑΦΜ που υπάρχει ΜΟΝΟ ως χρεώστης βρίσκεται πλέον — πριν επέστρεφε null.
    expect(m).toMatchObject({ trdr: 1, sodtype: 15, kind: 'Χρεώστης' });
  });

  it('η υπάρχουσα προτίμηση ΔΕΝ αλλάζει: προμηθευτής πριν από πιστωτή, πιστωτής πριν από χρεώστη', async () => {
    queue = [rows([3, 'Χ.3', 'ΓΑΜΑ', 15], [2, 'Π.2', 'ΒΗΤΑ', 16], [1, 'Α.1', 'ΑΛΦΑ', 12])];
    expect(await softoneFindTraderByAfm('094073495')).toMatchObject({ trdr: 1, sodtype: 12 });

    queue = [rows([3, 'Χ.3', 'ΓΑΜΑ', 15], [2, 'Π.2', 'ΒΗΤΑ', 16])];
    expect(await softoneFindTraderByAfm('094073495')).toMatchObject({ trdr: 2, sodtype: 16 });
  });
});
