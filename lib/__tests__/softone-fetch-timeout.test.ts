// Χρονικό όριο / επανάληψη του softoneFetch: οι αναγνώσεις ξαναστέλνονται μία φορά, οι εγγραφές ΠΟΤΕ,
// και πριν από εγγραφή μετά από αδράνεια φεύγει ένα ping για να ανανεωθεί η σύνδεση.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import iconv from 'iconv-lite';

vi.mock('@/lib/settings', () => ({ getSetting: async () => undefined, setSetting: async () => {} }));

import { __setSoftoneLastOkAt, softoneFetch, SoftoneTransportError } from '@/lib/softone';

const ok = (payload: unknown) => ({ status: 200, headers: { get: () => null }, arrayBuffer: async () => iconv.encode(JSON.stringify(payload), 'win1253') });
/** Η πραγματική απάντηση του `ping`: απλό κείμενο, όχι JSON. */
const text = (body: string) => ({ status: 200, headers: { get: () => null }, arrayBuffer: async () => iconv.encode(body, 'win1253') });
const timeout = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });

let services: string[] = [];
let script: Array<() => unknown> = [];
beforeEach(() => {
  services = []; script = [];
  vi.stubGlobal('fetch', async (_u: string, init: { body: string }) => {
    services.push(String(JSON.parse(init.body).service));
    const step = script.shift();
    if (!step) throw new Error('απρόσμενη κλήση');
    return step();
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('softoneFetch — χρονικό όριο και επανάληψη', () => {
  it('ανάγνωση που κόλλησε ξαναστέλνεται μία φορά και πετυχαίνει', async () => {
    script.push(() => { throw timeout(); }, () => ok({ success: true, data: [] }));
    await expect(softoneFetch('https://x/s1services', { service: 'GetTable' })).resolves.toEqual({ success: true, data: [] });
    expect(services).toEqual(['GetTable', 'GetTable']);
  });

  it('δύο αποτυχίες στη σειρά ⇒ σαφές σφάλμα χρόνου', async () => {
    script.push(() => { throw timeout(); }, () => { throw timeout(); });
    await expect(softoneFetch('https://x/s1services', { service: 'getData' })).rejects.toThrow(/δεν απάντησε σε 15″/);
  });

  it('εγγραφή μετά από αδράνεια: πρώτα ping, μετά ΜΙΑ setData', async () => {
    __setSoftoneLastOkAt(0);
    script.push(() => ok({ success: true }), () => ok({ success: true, id: 5 }));
    await expect(softoneFetch('https://x/s1services', { service: 'setData' })).resolves.toMatchObject({ id: 5 });
    expect(services).toEqual(['ping', 'setData']);
  });

  it('εγγραφή που κόλλησε ΔΕΝ ξαναστέλνεται (θα μπορούσε να γράψει δεύτερη εγγραφή)', async () => {
    __setSoftoneLastOkAt(Date.now());
    script.push(() => { throw timeout(); });
    const e = await softoneFetch('https://x/s1services', { service: 'setData' }).catch((x) => x);
    expect(e).toBeInstanceOf(SoftoneTransportError);
    expect(e.phase).toBe('unknown');
    expect(services).toEqual(['setData']);
  });

  it('ping με απάντηση απλού κειμένου («0;serial») = ο host ζει', async () => {
    script.push(() => text('0;011023604205'));
    await expect(softoneFetch('https://x/s1services', { service: 'ping' })).resolves.toEqual({ success: true });
  });

  it('το ζέσταμα πριν από εγγραφή είναι ΜΙΑ προσπάθεια: ping που κόλλησε δεν ξαναστέλνεται', async () => {
    __setSoftoneLastOkAt(0);
    script.push(() => { throw timeout(); }, () => ok({ success: true, id: 7 }));
    await expect(softoneFetch('https://x/s1services', { service: 'setData' })).resolves.toMatchObject({ id: 7 });
    expect(services).toEqual(['ping', 'setData']);
  });

  it('μετά από ping-κείμενο η επόμενη εγγραφή δεν ξαναζεσταίνει', async () => {
    __setSoftoneLastOkAt(0);
    script.push(() => text('0;1'), () => ok({ success: true, id: 1 }), () => ok({ success: true, id: 2 }));
    await softoneFetch('https://x/s1services', { service: 'setData' });
    await softoneFetch('https://x/s1services', { service: 'setData' });
    expect(services).toEqual(['ping', 'setData', 'setData']);
  });
});
