// lib/__tests__/softone-expenses.test.ts
// Καλύπτει τα helpers εξόδων του lib/softone.ts χωρίς να αγγίζει το ζωντανό SoftOne:
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

import {
  buildExpensePayload, softoneCreateExpense, softoneFetchExpenses, EXPENSE_FLAG_FIELDS,
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

describe('buildExpensePayload', () => {
  it('γράφει στο object EXPENSES με κενό KEY και κρατά τα flags του προτύπου', () => {
    const p = buildExpensePayload({ code: 'ΕΞ01', name: 'Μεταφορικά', vat: '1300' }, { CLCMD: 1, KEPYOFLAG: 0 });
    expect(p.OBJECT).toBe('EXPENSES');
    expect(p.KEY).toBe('');
    expect(p.DATA.EXPENSES[0]).toMatchObject({ CODE: 'ΕΞ01', NAME: 'Μεταφορικά', ISACTIVE: 1, VAT: '1300', CLCMD: 1, KEPYOFLAG: 0 });
  });
  it('παραλείπει το VAT όταν δεν δίνεται', () => {
    const p = buildExpensePayload({ code: 'Χ', name: 'Ψ' }, {});
    expect(p.DATA.EXPENSES[0]).not.toHaveProperty('VAT');
  });
});

describe('softoneFetchExpenses', () => {
  it('διαβάζει τα ενεργά έξοδα από τον πίνακα EXPN', async () => {
    queue = [{ success: true, data: [['3', 'ΕΞ03', 'Ναύλοι', '1300', '1'], ['0', '', '', '', '1']] }];
    const rows = await softoneFetchExpenses();
    expect(calls[0].body).toMatchObject({ service: 'GetTable', TABLE: 'EXPN', FIELDS: 'EXPN,CODE,NAME,VAT,ISACTIVE', FILTER: 'ISACTIVE=1' });
    // EXPN=0 δεν είναι υπαρκτό κλειδί αλλά είναι πεπερασμένος αριθμός — κρατιέται όπως στα είδη.
    expect(rows[0]).toEqual({ expn: 3, code: 'ΕΞ03', name: 'Ναύλοι', vat: '1300', isActive: true });
  });
});

describe('softoneCreateExpense', () => {
  it('αντιγράφει τα required flags από υπάρχον έξοδο πριν γράψει και διαβάζει πίσω τη γραμμή', async () => {
    queue = [
      // 1. ποιο έξοδο θα χρησιμοποιηθεί ως πρότυπο
      { success: true, data: [['7'], ['9']] },
      // 2. getData στο πρότυπο (KEPYOFLAG=0 ≠ default 1 → αποδεικνύει ότι αντιγράφηκε)
      { success: true, data: { EXPN: [{ CLCMD: 2, INCLMD: 1, VATMODE: 1, ISSTOCK: 1, STOCKMD: 3, SOVAL: 0, INVOICEFLAG: 1, KEPYOFLAG: 0 }] } },
      // 3. setData
      { success: true, id: '42' },
      // 4. read-back
      { success: true, data: [['42', 'ΕΞ42', 'Μεταφορικά', '1300', '1']] },
    ];

    const res = await softoneCreateExpense({ code: 'ΕΞ42', name: 'Μεταφορικά', vat: '1300' });

    expect(calls.map((c) => c.service)).toEqual(['GetTable', 'getData', 'setData', 'GetTable']);
    expect(calls[1].body).toMatchObject({ OBJECT: 'EXPENSES', KEY: '7', LOCATEINFO: `EXPN:${EXPENSE_FLAG_FIELDS.join(',')}` });
    const row = (calls[2].body.DATA as { EXPENSES: Record<string, unknown>[] }).EXPENSES[0];
    expect(row).toMatchObject({ CODE: 'ΕΞ42', NAME: 'Μεταφορικά', ISACTIVE: 1, VAT: '1300', CLCMD: 2, KEPYOFLAG: 0, STOCKMD: 3 });
    for (const f of EXPENSE_FLAG_FIELDS) expect(row).toHaveProperty(f);
    expect(calls[3].body).toMatchObject({ TABLE: 'EXPN', FILTER: 'EXPN=42' });
    expect(res).toEqual({ expn: 42, code: 'ΕΞ42', name: 'Μεταφορικά', templateExpn: 7 });
  });

  it('πέφτει όταν το setData επιστρέψει σφάλμα', async () => {
    queue = [
      { success: true, data: [['7']] },
      { success: true, data: { EXPN: [{ CLCMD: 0 }] } },
      { success: false, error: 'Δεν επιτρέπεται', errorcode: 101 },
    ];
    await expect(softoneCreateExpense({ code: 'Α', name: 'Β' })).rejects.toThrow('Δεν επιτρέπεται');
  });

  it('πέφτει όταν η γραμμή δεν επιβεβαιώνεται μετά το setData (success ≠ persisted)', async () => {
    queue = [
      { success: true, data: [['7']] },
      { success: true, data: { EXPN: [{ CLCMD: 0 }] } },
      { success: true, id: '55' },
      { success: true, data: [] },
    ];
    await expect(softoneCreateExpense({ code: 'Α', name: 'Β' })).rejects.toThrow(/δεν βρέθηκε/);
  });
});
