// lib/__tests__/softone-token.test.ts
// Η ακύρωση του cached SoftOne token. ΚΑΜΙΑ ζωντανή κλήση: το `fetch` είναι stubbed και οι
// ρυθμίσεις ζουν σε ένα object στη μνήμη.
//
// Το επίμαχο σημείο: το token δεν ζει μόνο στη μνήμη — είναι και γραμμή `AppSetting`, ώστε να
// το μοιράζονται τα αιτήματα. Αν ο καθαρισμός της γραμμής είναι «fire-and-forget», ένα αίτημα
// που θα έπεφτε μέσα στο παράθυρο ξαναδιαβάζει το ΙΔΙΟ `clientID` — δεμένο στην ΠΡΟΗΓΟΥΜΕΝΗ
// εταιρία. Αυτό ακριβώς θα έπρεπε να είχε διορθώσει η αλλαγή ρυθμίσεων.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import iconv from 'iconv-lite';

const TOKEN_KEY = 'integrations.softoneTokenCache';

const { store, writes, SETTING_WRITE_MS } = vi.hoisted(() => ({
  store: {} as Record<string, unknown>,
  writes: [] as string[],
  SETTING_WRITE_MS: 10,
}));

vi.mock('@/lib/settings', () => ({
  // Η γραφή ΑΡΓΕΙ επίτηδες: έτσι το «fire-and-forget» ξεχωρίζει από το «await».
  setSetting: async (key: string, value: unknown) => {
    await new Promise((r) => setTimeout(r, SETTING_WRITE_MS));
    store[key] = value;
    writes.push(key);
  },
  getSetting: async (key: string) => store[key],
}));

import { clearCachedToken, getCachedToken, softoneGetToken } from '@/lib/softone';

function respond(payload: unknown) {
  const buf = iconv.encode(JSON.stringify(payload), 'win1253');
  return { headers: { get: () => null }, arrayBuffer: async () => buf };
}

let queue: unknown[] = [];
let services: string[] = [];

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  writes.length = 0;
  queue = [];
  services = [];
  Object.assign(store, {
    'integrations.softoneSerial': 'demo',
    'integrations.softoneAppId': 'APP',
    'integrations.softoneUser': 'user',
    'integrations.softonePass': 'pass',
    'integrations.softoneCompany': '1001',
  });
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    services.push(String(body.service));
    const next = queue.shift();
    if (next === undefined) throw new Error(`Απρόσμενη κλήση SoftOne: ${String(body.service)}`);
    return respond(next);
  });
});

describe('clearCachedToken', () => {
  it('η αποθηκευμένη γραμμή έχει ΗΔΗ καθαριστεί όταν επιστρέφει η συνάρτηση', async () => {
    store[TOKEN_KEY] = { clientID: 'OLD-COMPANY-SESSION', at: Date.now() };

    await clearCachedToken();

    // Χωρίς `await` στη γραφή, εδώ θα υπήρχε ακόμη το παλιό token.
    expect(store[TOKEN_KEY]).toBeNull();
    expect(writes).toContain(TOKEN_KEY);
    expect(getCachedToken()).toBeNull();
  });

  it('αμέσως μετά, κανένα αίτημα δεν ξαναπιάνει το token της παλιάς εταιρίας', async () => {
    store[TOKEN_KEY] = { clientID: 'OLD-COMPANY-SESSION', at: Date.now() };
    // Προθέρμανση: το token υιοθετείται από τη γραμμή `AppSetting`.
    expect(await softoneGetToken()).toBe('OLD-COMPANY-SESSION');

    await clearCachedToken();

    queue = [
      { success: true, clientID: 'TMP', objs: [{ COMPANY: '1003', BRANCH: '1000', REFID: 'R' }] },
      { success: true, clientID: 'NEW-COMPANY-SESSION' },
    ];
    expect(await softoneGetToken()).toBe('NEW-COMPANY-SESSION');
    expect(services).toEqual(['login', 'authenticate']);
  });

  it('η αποτυχία της γραφής δεν καταπίνεται — ο caller πρέπει να μάθει ότι δεν καθαρίστηκε', async () => {
    const mod = await import('@/lib/settings');
    const spy = vi.spyOn(mod, 'setSetting').mockRejectedValueOnce(new Error('DB down'));
    await expect(clearCachedToken()).rejects.toThrow('DB down');
    spy.mockRestore();
  });
});
