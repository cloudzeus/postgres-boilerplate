// lib/__tests__/softone-lineitem.test.ts
// Το read-back της δημιουργίας χρεοπίστωσης, με mocked transport (καμία επαφή με ζωντανό SoftOne).
// Εδώ κρίνεται ότι `success: true` ΔΕΝ αρκεί: ελέγχουμε ότι η εγγραφή έμεινε ως χρεοπίστωση, με
// τον λογαριασμό που στείλαμε και με την ΚΑΤΗΓΟΡΙΑ ΤΙΜΟΛΟΓΗΣΗΣ ακέραιη — το πεδίο για το οποίο
// υπάρχει όλη η αντιγραφή προτύπου.
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

import { softoneCreateLineItem, SoftoneOrphanError } from '@/lib/softone';

type Call = { service: string; body: Record<string, unknown> };
let calls: Call[] = [];
let queue: unknown[] = [];

const respond = (payload: unknown) => {
  const buf = iconv.encode(JSON.stringify(payload), 'win1253');
  return { headers: { get: () => null }, arrayBuffer: async () => buf };
};

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

const INPUT = { code: '585099', name: 'Δοκιμή', templateMtrl: 1695, acnmsk: '64.02.06.0099' };

/** Πρότυπο: MTRL,CODE,NAME,MTRTYPE,MTRTYPE1,KEPYO,LISOURCETYPE,MTRUNIT1,VAT,MTRCATEGORY,ACNMSK */
const template = (lisource: string) =>
  ({ success: true, data: [['1695', '585005', 'Πρότυπο', '0', '1', '0', lisource, '101', '1424', '', '64.02.06.0099']] });

/** Read-back: το ίδιο με μια στήλη SODTYPE μετά το NAME. */
const readBack = (opts: { sodtype?: string; lisource: string; acnmsk?: string }) =>
  ({ success: true, data: [[
    '4711', '585099', 'Δοκιμή', opts.sodtype ?? '53',
    '0', '1', '0', opts.lisource, '101', '1424', '', opts.acnmsk ?? '64.02.06.0099',
  ]] });

describe('softoneCreateLineItem — read-back', () => {
  it('περνά όταν η κατηγορία τιμολόγησης γύρισε ακέραιη', async () => {
    queue = [template('12,13,14,15,16'), { success: true, id: '4711' }, readBack({ lisource: '12,13,14,15,16' })];
    const res = await softoneCreateLineItem(INPUT);
    expect(calls.map((c) => c.service)).toEqual(['GetTable', 'setData', 'GetTable']);
    expect(res).toMatchObject({ mtrl: 4711, code: '585099', acnmsk: '64.02.06.0099', lisourceType: '12,13,14,15,16' });
  });

  it('ανέχεται ΔΙΑΦΟΡΕΤΙΚΗ ΣΕΙΡΑ και κενά — δεν συγκρίνει κείμενο αλλά σύνολα', async () => {
    queue = [template('12,16'), { success: true, id: '4711' }, readBack({ lisource: '16, 12' })];
    await expect(softoneCreateLineItem(INPUT)).resolves.toMatchObject({ mtrl: 4711 });
  });

  it('ανέχεται ΕΠΙΠΛΕΟΝ τύπους: πιο επιτρεπτικό δεν βλάπτει τη γραμμή', async () => {
    queue = [template('12,16'), { success: true, id: '4711' }, readBack({ lisource: '12,13,16' })];
    await expect(softoneCreateLineItem(INPUT)).resolves.toMatchObject({ mtrl: 4711 });
  });

  it('πέφτει όταν ΛΕΙΠΕΙ τύπος — η χρεοπίστωση δεν θα δεχόταν τη γραμμή', async () => {
    queue = [template('12,16'), { success: true, id: '4711' }, readBack({ lisource: '12' })];
    await expect(softoneCreateLineItem(INPUT)).rejects.toThrow(/κατηγορία τιμολόγησης.*λείπει 16/s);
  });

  it('το σφάλμα κουβαλά το MTRL της ορφανής εγγραφής, δομημένα', async () => {
    queue = [template('12,16'), { success: true, id: '4711' }, readBack({ lisource: '12' })];
    await softoneCreateLineItem(INPUT).then(
      () => { throw new Error('έπρεπε να πέσει'); },
      (e: unknown) => {
        expect(e).toBeInstanceOf(SoftoneOrphanError);
        expect((e as SoftoneOrphanError).mtrl).toBe(4711);
      },
    );
  });

  it('πέφτει όταν η εγγραφή δεν έμεινε χρεοπίστωση (SODTYPE ≠ 53)', async () => {
    queue = [template('12,16'), { success: true, id: '4711' }, readBack({ sodtype: '51', lisource: '12,16' })];
    await expect(softoneCreateLineItem(INPUT)).rejects.toBeInstanceOf(SoftoneOrphanError);
  });

  it('πέφτει όταν ο λογαριασμός γενικής γύρισε αλλαγμένος', async () => {
    queue = [template('12,16'), { success: true, id: '4711' }, readBack({ lisource: '12,16', acnmsk: '64.02.06.0000' })];
    await expect(softoneCreateLineItem(INPUT)).rejects.toThrow(/λογαριασμό γενικής/);
  });
});
