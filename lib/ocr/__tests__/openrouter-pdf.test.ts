// lib/ocr/__tests__/openrouter-pdf.test.ts
// PDF ολόκληρο προς το OpenRouter: σχήμα αιτήματος (file part + εγγενής επεξεργασία), ονόματα
// μοντέλων `google/…`, εφεδρικό μοντέλο όταν το πρώτο αποτύχει.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { net, usage } = vi.hoisted(() => ({
  net: { fetchWithRetry: vi.fn() },
  usage: { logAiUsage: vi.fn(), providerFromUrl: () => 'openrouter' },
}));
vi.mock('@/lib/ocr/fetch-retry', () => net);
vi.mock('@/lib/ai/usage', () => usage);
vi.mock('@/lib/settings', () => ({ getSetting: vi.fn(async () => undefined) }));

import { callPdfNative, resolveCfg } from '../extract';

const ok = (content: string) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }),
});

beforeEach(async () => {
  vi.clearAllMocks();
  process.env.OPENROUTER_API_KEY = 'or-test';
  delete process.env.GEMINI_API_KEY;
  (await import('@/lib/ai/vision-config')).resetProviderDown();
});

describe('callPdfNative μέσω OpenRouter', () => {
  it('στέλνει το PDF ως file part με εγγενή επεξεργασία και μοντέλο google/…', async () => {
    net.fetchWithRetry.mockResolvedValueOnce(ok('{"a":1}'));
    const cfg = await resolveCfg();
    const r = await callPdfNative(cfg, 'SYSTEM', Buffer.from('%PDF-1.4 test'));
    expect(r).toMatchObject({ content: '{"a":1}', tokens: 15, model: 'google/gemini-2.5-flash' });

    const [url, init] = net.fetchWithRetry.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer or-test');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('google/gemini-2.5-flash');
    expect(body.plugins).toEqual([{ id: 'file-parser', pdf: { engine: 'native' } }]);
    const file = body.messages[1].content[0];
    expect(file.type).toBe('file');
    expect(file.file.file_data.startsWith('data:application/pdf;base64,')).toBe(true);
  });

  it('το «HQ» (gemini-2.5-pro) γίνεται google/gemini-2.5-pro· σε αποτυχία πάει στο εφεδρικό', async () => {
    net.fetchWithRetry
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'overloaded' })
      .mockResolvedValueOnce(ok('{"b":2}'));
    const cfg = await resolveCfg();
    const r = await callPdfNative(cfg, 'SYSTEM', Buffer.from('%PDF'), 'gemini-2.5-pro');
    const models = net.fetchWithRetry.mock.calls.map((c) => JSON.parse(c[1].body).model);
    expect(models[0]).toBe('google/gemini-2.5-pro');
    expect(models[1]).toMatch(/^google\//);
    expect(r.content).toBe('{"b":2}');
  });
});

describe('OpenRouter χωρίς credits → Google Gemini', () => {
  it('402 σε όλα τα μοντέλα του OpenRouter ⇒ το PDF διαβάζεται από το native API της Google', async () => {
    process.env.GEMINI_API_KEY = 'g-test';
    net.fetchWithRetry.mockImplementation(async (url: string) => {
      if (url.includes('openrouter.ai')) return { ok: false, status: 402, text: async () => '{"error":{"message":"Insufficient credits"}}' };
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"c":3}' }] } }], usageMetadata: { totalTokenCount: 9 } }) };
    });
    const cfg = await resolveCfg();
    const r = await callPdfNative(cfg, 'SYSTEM', Buffer.from('%PDF'));
    expect(r).toMatchObject({ content: '{"c":3}', model: 'gemini-2.5-flash' });
    const urls = net.fetchWithRetry.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => u.includes('openrouter.ai')).length).toBe(3); // όλα τα μοντέλα του πρώτου παρόχου
    expect(urls.at(-1)).toContain('generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
  });
});
