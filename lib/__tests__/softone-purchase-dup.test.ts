// lib/__tests__/softone-purchase-dup.test.ts
// Ο έλεγχος διπλοεγγραφής (`softoneCheckPurchaseDoc`) ψάχνει στα ΦΟΡΟΛΟΓΙΚΑ πεδία — εκεί ακριβώς
// που η καταχώριση γράφει τον αριθμό του εκδότη. Το transport είναι mocked: κανένα ζωντανό SoftOne.
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

import { softoneCheckPurchaseDoc } from '@/lib/softone';

type Call = { service: string; body: Record<string, unknown> };
let calls: Call[] = [];
let queue: unknown[] = [];

const respond = (payload: unknown) => {
  const buf = iconv.encode(JSON.stringify(payload), 'win1253');
  return { headers: { get: () => null }, arrayBuffer: async () => buf };
};

/** Μία σειρά του FINDOC, με τη σειρά πεδίων που ζητά η `softoneCheckPurchaseDoc`. */
const findoc = (fincode: string, taxSeries: string, taxNum: string, id = '1042') =>
  [id, fincode, taxSeries, taxNum, '2026-03-14'];

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

describe('softoneCheckPurchaseDoc', () => {
  it('ζητά τα ΦΟΡΟΛΟΓΙΚΑ πεδία και ΟΧΙ το SERIESNUM — αυτός είναι ο δικός μας αύξων', async () => {
    queue = [{ success: true, data: [] }];
    await softoneCheckPurchaseDoc(12345, { number: '2455' }, '2026-03-14');
    const fields = String(calls[0].body.FIELDS).split(',');
    expect(fields).toContain('TAXSERIESNUM');
    expect(fields).toContain('FINCODE');
    expect(fields).not.toContain('SERIESNUM');
    expect(calls[0].body.FILTER).toBe('TRDR=12345 AND TRNDATE=2026-03-14');
  });

  it('βρίσκει το υπάρχον παραστατικό από τον «Φορ/κό αριθμό» και επιστρέφει την πλήρη ταυτότητα', async () => {
    queue = [{ success: true, data: [findoc('ΤΙΜ-AA-2455', 'ΤΙΜ-AA', '2455')] }];
    expect(await softoneCheckPurchaseDoc(12345, { number: '2455', fincode: 'ΤΙΜ AA 2455' }, '2026-03-14'))
      .toEqual({ exists: true, ref: 'ΤΙΜ-AA-2455' });
  });

  it('η πλήρης ταυτότητα ταιριάζει κι όταν διαφέρουν τα διαχωριστικά', async () => {
    queue = [{ success: true, data: [findoc('ΔΠ-0035656', 'ΔΠ', '0035656')] }];
    expect(await softoneCheckPurchaseDoc(12345, { number: '0035656', fincode: 'ΔΠ 0035656' }, null))
      .toEqual({ exists: true, ref: 'ΔΠ-0035656' });
  });

  it('ΔΕΝ βγάζει ψεύτικη διπλοεγγραφή από τον δικό μας αύξοντα: αριθμός «1» σε παραστατικό με άλλη αναφορά', async () => {
    // Πριν τη διόρθωση η σύγκριση περιλάμβανε το SERIESNUM, οπότε ένα τιμολόγιο προμηθευτή με
    // αριθμό «1» «ταίριαζε» με κάθε πρώτο παραστατικό της σειράς.
    queue = [{ success: true, data: [findoc('ΤΙΜ-AA-2455', 'ΤΙΜ-AA', '2455')] }];
    expect(await softoneCheckPurchaseDoc(12345, { number: '1', fincode: 'ΔΠ 1' }, '2026-03-14'))
      .toEqual({ exists: false, ref: null });
  });

  it('η χαλαρή σύγκριση (περιέχει) ισχύει μόνο από 3 χαρακτήρες και πάνω', async () => {
    queue = [{ success: true, data: [findoc('ΤΙΜ-AA-2455', 'ΤΙΜ-AA', '2455')] }];
    // «455» περιέχεται στο «2455» → πιθανή διπλοεγγραφή, την αναφέρουμε.
    expect((await softoneCheckPurchaseDoc(12345, { number: '455' }, null)).exists).toBe(true);
    queue = [{ success: true, data: [findoc('ΤΙΜ-AA-2455', 'ΤΙΜ-AA', '2455')] }];
    // «45» είναι πολύ κοντό για να σημαίνει κάτι — ακριβής ταύτιση μόνο.
    expect((await softoneCheckPurchaseDoc(12345, { number: '45' }, null)).exists).toBe(false);
  });

  it('χωρίς αριθμό ή χωρίς TRDR δεν ρωτάει καν το SoftOne', async () => {
    expect(await softoneCheckPurchaseDoc(12345, { number: '' }, null)).toEqual({ exists: false, ref: null });
    expect(await softoneCheckPurchaseDoc(Number.NaN, { number: '17' }, null)).toEqual({ exists: false, ref: null });
    expect(calls).toHaveLength(0);
  });

  it('αποτυχία του GetTable δεν σκάει τη ροή — απαντά «δεν ξέρω»', async () => {
    queue = [{ success: false, error: 'boom', errorcode: 13 }];
    expect(await softoneCheckPurchaseDoc(12345, { number: '2455' }, null)).toEqual({ exists: false, ref: null });
  });
});
