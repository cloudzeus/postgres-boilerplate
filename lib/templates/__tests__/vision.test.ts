import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/settings', () => ({ getSetting: vi.fn(async (k: string) => ({
  'ai.visionApiKey': 'key', 'ai.visionUrl': 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  'ai.visionModel': 'gemini-2.5-flash', 'ai.visionFallbackModels': 'gemini-2.5-pro',
} as Record<string, string>)[k] ?? null) }));
vi.mock('@/lib/ai/usage', () => ({ logAiUsage: vi.fn(async () => {}), providerFromUrl: () => 'gemini' }));
const fetchMock = vi.fn();
vi.mock('@/lib/ocr/fetch-retry', () => ({ fetchWithRetry: (...a: unknown[]) => fetchMock(...a) }));

import { readCropValue, readCropTable, prepareCrop } from '../vision';
import { logAiUsage } from '@/lib/ai/usage';

const png = Buffer.from('89504e470d0a1a0a', 'hex');

beforeEach(() => { fetchMock.mockReset(); (logAiUsage as any).mockClear(); });

describe('readCropValue', () => {
  it('returns the trimmed content, model and tokens, and logs usage', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: ' ΤΙΜ-451 \n' } }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }) });
    const r = await readCropValue({ crop: png, prompt: 'Read the invoice number', operation: 'template.field' });
    expect(r).toEqual({ value: 'ΤΙΜ-451', model: 'gemini-2.5-flash', tokensUsed: 12 });
    expect(logAiUsage).toHaveBeenCalledWith(expect.objectContaining({ scope: 'OCR_VISION', model: 'gemini-2.5-flash', operation: 'template.field', totalTokens: 12 }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe('gemini-2.5-flash');
    expect(body.messages[1].content[0].image_url.url.startsWith('data:image/png;base64,')).toBe(true);
  });
  it('falls back to the next model when the primary fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'busy' });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: 'X' } }], usage: {} }) });
    const r = await readCropValue({ crop: png, prompt: 'p', operation: 'template.field' });
    expect(r.model).toBe('gemini-2.5-pro');
    expect(r.value).toBe('X');
  });
  it('normalises "null"/"—" answers to empty string', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: 'null' } }] }) });
    expect((await readCropValue({ crop: png, prompt: 'p', operation: 'x' })).value).toBe('');
  });
});

describe('readCropTable', () => {
  it('parses a JSON rows answer (tolerating code fences)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: '```json\n{"rows":[{"code":"A1","qty":"2"}]}\n```' } }], usage: { total_tokens: 5 } }) });
    const r = await readCropTable({ crop: png, columns: [{ key: 'code', label: 'Κωδικός' }, { key: 'qty', label: 'Ποσότητα' }], operation: 'template.table' });
    expect(r.rows).toEqual([{ code: 'A1', qty: '2' }]);
    expect(r.tokensUsed).toBe(5);
  });
});

describe('prepareCrop', () => {
  it('is exported (sharp pipeline exercised in route/manual tests)', () => {
    expect(typeof prepareCrop).toBe('function');
  });
});
