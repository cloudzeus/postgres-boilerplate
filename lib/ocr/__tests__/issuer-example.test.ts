// lib/ocr/__tests__/issuer-example.test.ts
// Το παράδειγμα του ίδιου εκδότη φτάνει ΟΝΤΩΣ μέχρι το system prompt — και, όταν δεν υπάρχει, το
// prompt μένει byte-προς-byte αυτό που ήταν πριν το χαρακτηριστικό.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { net, usage, own } = vi.hoisted(() => ({
  net: { fetchWithRetry: vi.fn() },
  usage: { logAiUsage: vi.fn(), providerFromUrl: () => 'gemini' },
  own: { resolveOwnAfm: vi.fn() },
}));

vi.mock('@/lib/ocr/fetch-retry', () => net);
vi.mock('@/lib/ai/usage', () => usage);
vi.mock('@/lib/ocr/own-afm', () => own);
vi.mock('@/lib/settings', () => ({
  getSetting: vi.fn(async (key: string) => (key.endsWith('ApiKey') ? 'test-key' : undefined)),
}));

import { extractDocument } from '../extract';
import { buildSystemPrompt } from '../templates';
import { trimExample } from '../example';
import { fromLegacy } from '../canonical';

const ANSWER = {
  kind: 'invoice',
  type: { number: '18' }, date: '2026-07-01',
  issuer: { name: 'ΚΑΠΑΛΙΝΕ ΑΕ', vat: '999863881' },
  recipient: { name: 'DGESPA ΑΕ', vat: '094014201' },
  totals: { net: 100, vatAmount: 24, total: 124 },
};

const EXAMPLE = trimExample(fromLegacy({
  companyName: 'ΚΑΠΑΛΙΝΕ ΑΕ', vatNumber: '999863881', invoiceNumber: '17',
  date: '2026-06-22', subtotal: 100, vatAmount: 24, totalAmount: 124, customerName: 'DGESPA ΑΕ',
}, [], 'invoice'));

const systemOf = (call: unknown[]) => JSON.parse(String((call[1] as { body: string }).body)).messages[0].content;

beforeEach(() => {
  vi.clearAllMocks();
  own.resolveOwnAfm.mockResolvedValue(null);
  net.fetchWithRetry.mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(ANSWER) } }], usage: {} }),
  });
});

const run = (example?: unknown) => extractDocument({
  buffer: Buffer.from('x'), mimeType: 'image/png', docType: 'auto', language: 'el', example,
});

describe('few-shot από τον ίδιο εκδότη', () => {
  it('το παράδειγμα μπαίνει στο system prompt, με ρητή απαγόρευση αντιγραφής', async () => {
    await run(EXAMPLE);
    const system = systemOf(net.fetchWithRetry.mock.calls[0]);
    expect(system).toContain('ΚΑΠΑΛΙΝΕ ΑΕ');
    expect(system).toMatch(/Reference example/);
    expect(system).toMatch(/do NOT copy|μην αντιγρ/i);
  });

  it('χωρίς παράδειγμα, το prompt είναι ακριβώς το σκέτο prompt του τύπου', async () => {
    await run(undefined);
    const system = systemOf(net.fetchWithRetry.mock.calls[0]);
    expect(system).toBe(buildSystemPrompt('auto', 'el'));
    expect(system).not.toMatch(/Reference example/);
  });

  it('το παράδειγμα δεν αλλοιώνει την ανάγνωση: μετράει ό,τι επέστρεψε το μοντέλο', async () => {
    const res = await run(EXAMPLE);
    expect(res.document.type.number).toBe('18');   // όχι το «17» του παραδείγματος
  });
});
