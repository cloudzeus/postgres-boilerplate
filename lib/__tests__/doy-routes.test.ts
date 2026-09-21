// lib/__tests__/doy-routes.test.ts
// Τα routes που αγγίζουν Δ.Ο.Υ., καλεσμένα ΑΠΕΥΘΕΙΑΣ ως handlers: rbac/prisma mocked, και το
// transport (fetch) mocked τόσο για την ΑΑΔΕ όσο και για το SoftOne. Κανένα setData σε κανένα test.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import iconv from 'iconv-lite';

const { rbac, db, settings } = vi.hoisted(() => ({
  rbac: { requirePermission: vi.fn(), hasPermission: vi.fn() },
  db: {
    softoneTrader: { upsert: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    ocrDocument: { update: vi.fn(async () => null) },
  },
  settings: {
    'integrations.softoneSerial': 'demo',
    'integrations.softoneAppId': 'APP',
    'integrations.softoneUser': 'user',
    'integrations.softonePass': 'pass',
    'integrations.softoneCompany': '1001',
    'integrations.softoneTokenCache': { clientID: 'TEST-CLIENT', at: Date.now() },
  } as Record<string, unknown>,
}));
vi.mock('@/lib/rbac', () => rbac);
vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => null) }));
vi.mock('@/lib/settings', () => ({
  getSetting: async (k: string) => settings[k],
  setSetting: async () => {},
}));
vi.mock('@/lib/ocr/queues', () => ({
  applyTraderToDocs: vi.fn(async () => 0),
  TRADER_KIND_LABEL: { supplier: 'Προμηθευτής', creditor: 'Πιστωτής', debtor: 'Χρεώστης' },
}));

import { POST as createTrader } from '@/app/api/admin/ocr/new-traders/[afm]/create/route';
import { POST as createSupplier } from '@/app/api/admin/ocr/create-supplier/route';
import { POST as preview } from '@/app/api/admin/ocr/supplier-preview/route';

/** Όλες οι κλήσεις SoftOne (service + σώμα) — για να αποδειχθεί ότι δεν έγινε ποτέ setData. */
let s1Calls: Record<string, unknown>[] = [];
/** Απαντήσεις SoftOne ανά service· ό,τι λείπει ⇒ σφάλμα δικτύου. */
let s1: Record<string, unknown> = {};
let aade: unknown = null;

const IRSDATA_OK = {
  success: true, count: 3,
  model: [[{ name: 'IRSDATA' }, { name: 'CODE' }, { name: 'NAME' }, { name: 'ISACTIVE' }]],
  data: [['1101', '1101', 'Α΄ ΑΘΗΝΩΝ', '1'], ['8110', '8110', 'ΗΡΑΚΛΕΙΟΥ', '1'], ['1130', '1130', 'ΚΑΛΛΙΘΕΑΣ', '0']],
};

beforeEach(() => {
  vi.clearAllMocks();
  rbac.requirePermission.mockResolvedValue({ id: 'u1', email: 'a@b.gr' });
  s1Calls = []; s1 = {}; aade = null;
  vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
    if (String(url).includes('afm2info')) return { ok: true, status: 200, json: async () => aade };
    const body = JSON.parse(init.body) as Record<string, unknown>;
    s1Calls.push(body);
    const key = body.service === 'GetTable' ? `GetTable:${String(body.TABLE)}` : String(body.service);
    const payload = s1[key];
    if (payload === undefined) throw new Error(`Απρόσμενη κλήση SoftOne: ${key}`);
    const buf = iconv.encode(JSON.stringify(payload), 'win1253');
    return { headers: { get: () => null }, arrayBuffer: async () => buf };
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

const post = (body: unknown) =>
  new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body) });
const traderCtx = { params: Promise.resolve({ afm: '999082935' }) };
const noSetData = () => expect(s1Calls.some((c) => c.service === 'setData')).toBe(false);

describe('POST /api/admin/ocr/new-traders/[afm]/create — Δ.Ο.Υ.', () => {
  it('ανύπαρκτο κλειδί IRSDATA ⇒ 422 invalid_doy στο πεδίο, κανένα setData', async () => {
    s1['GetTable:IRSDATA'] = IRSDATA_OK;
    const res = await createTrader(post({ kind: 'supplier', name: 'Χ', irsData: '1190', dryRun: true }), traderCtx);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      error: 'invalid_doy', field: 'irsData',
      message: 'Η Δ.Ο.Υ. με κλειδί 1190 δεν υπάρχει στο μητρώο Δ.Ο.Υ. του SoftOne.',
    });
    noSetData();
  });

  it('ανενεργή Δ.Ο.Υ. ⇒ 422 με το όνομα και τον κωδικό της', async () => {
    s1['GetTable:IRSDATA'] = IRSDATA_OK;
    const res = await createTrader(post({ kind: 'supplier', name: 'Χ', irsData: '1130', dryRun: true }), traderCtx);
    expect(res.status).toBe(422);
    expect((await res.json()).message).toContain('ΚΑΛΛΙΘΕΑΣ (κωδ. 1130) είναι ανενεργή');
  });

  it('υπαρκτό, ενεργό κλειδί ⇒ περνά (dry-run) και γράφεται ως TRDR.IRSDATA', async () => {
    s1['GetTable:IRSDATA'] = IRSDATA_OK;
    const res = await createTrader(post({ kind: 'supplier', name: 'Χ', irsData: '8110', dryRun: true }), traderCtx);
    expect(res.status).toBe(200);
    expect((await res.json()).payload.DATA.SUPPLIER[0]).toMatchObject({ IRSDATA: '8110' });
    noSetData();
  });

  it('ΠΑΛΙΑ σελίδα που στέλνει `doyCode` ⇒ 400 με οδηγία ανανέωσης, πριν από οτιδήποτε άλλο', async () => {
    const res = await createTrader(post({ kind: 'supplier', name: 'Χ', doyCode: '8110' }), traderCtx);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'stale_client', field: 'irsData' });
    expect(s1Calls).toHaveLength(0);
  });
});

describe('POST /api/admin/ocr/create-supplier — Δ.Ο.Υ.', () => {
  it('ανύπαρκτο κλειδί IRSDATA ⇒ 422 invalid_doy, κανένα setData', async () => {
    s1['GetTable:IRSDATA'] = IRSDATA_OK;
    const res = await createSupplier(post({ name: 'Χ', afm: '999082935', irsData: '1190', dryRun: true }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: 'invalid_doy', field: 'irsData' });
    noSetData();
  });

  it('υπαρκτό κλειδί ⇒ περνά στο dry-run', async () => {
    s1['GetTable:IRSDATA'] = IRSDATA_OK;
    const res = await createSupplier(post({ name: 'Χ', afm: '999082935', irsData: '8110', dryRun: true }));
    expect(res.status).toBe(200);
    expect((await res.json()).payload.DATA.SUPPLIER[0]).toMatchObject({ IRSDATA: '8110' });
    noSetData();
  });

  it('ΠΑΛΙΟΣ διάλογος με `doyCode` ⇒ 400', async () => {
    const res = await createSupplier(post({ name: 'Χ', afm: '999082935', doyCode: '8110' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'stale_client' });
    expect(s1Calls).toHaveLength(0);
  });
});

describe('POST /api/admin/ocr/supplier-preview — softoneDoy', () => {
  const DGSOFT = { basic_rec: { afm: '997939640', onomasia: 'DGSOFT ΕΕ', doy: '1190', doy_descr: 'ΚΕΦΟΔΕ ΑΤΤΙΚΗΣ', deactivation_flag: '1' } };

  it('κωδικός ΑΑΔΕ που λείπει από το IRSDATA ⇒ missing με σημείωση', async () => {
    aade = DGSOFT;
    s1['GetTable:IRSDATA'] = IRSDATA_OK;
    const d = await (await preview(post({ afm: '997939640' }))).json();
    expect(d).toMatchObject({ doyCode: '1190', softoneDoy: { status: 'missing', office: null } });
    expect(d.softoneDoy.note).toBe('Η Δ.Ο.Υ. ΚΕΦΟΔΕ ΑΤΤΙΚΗΣ (κωδ. 1190) δεν υπάρχει στο μητρώο Δ.Ο.Υ. του SoftOne.');
  });

  it('κωδικός που υπάρχει ⇒ matched με τη γραμμή IRSDATA', async () => {
    aade = { basic_rec: { afm: '999082935', onomasia: 'ENARTIA', doy: '8110', doy_descr: 'ΗΡΑΚΛΕΙΟΥ' } };
    s1['GetTable:IRSDATA'] = IRSDATA_OK;
    const d = await (await preview(post({ afm: '999082935' }))).json();
    expect(d.softoneDoy).toMatchObject({ status: 'matched', by: 'code', office: { key: '8110' } });
  });

  it('απάντηση IRSDATA που δεν αναλύεται (λείπει CODE) ⇒ unavailable, ΟΧΙ «δεν υπάρχει»', async () => {
    aade = DGSOFT;
    s1['GetTable:IRSDATA'] = { success: true, model: [[{ name: 'IRSDATA' }, { name: 'NAME' }]], data: [['1101', 'Α΄ ΑΘΗΝΩΝ']] };
    const d = await (await preview(post({ afm: '997939640' }))).json();
    expect(d.softoneDoy).toMatchObject({ status: 'unavailable', office: null });
    expect(d.softoneDoy.note).toContain('Δεν ήταν δυνατή η ανάγνωση');
  });

  it('SoftOne εκτός ⇒ unavailable', async () => {
    aade = DGSOFT; // καμία απάντηση SoftOne ⇒ σφάλμα δικτύου
    const d = await (await preview(post({ afm: '997939640' }))).json();
    expect(d.softoneDoy.status).toBe('unavailable');
  });
});
