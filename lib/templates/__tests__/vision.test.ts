import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/settings', () => ({ getSetting: vi.fn(async (k: string) => ({
  'ai.visionApiKey': 'key', 'ai.visionUrl': 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  'ai.visionModel': 'gemini-2.5-flash', 'ai.visionFallbackModels': 'gemini-2.5-pro',
} as Record<string, string>)[k] ?? null) }));
vi.mock('@/lib/ai/usage', () => ({ logAiUsage: vi.fn(async () => {}), providerFromUrl: () => 'gemini' }));
const fetchMock = vi.fn();
vi.mock('@/lib/ocr/fetch-retry', () => ({ fetchWithRetry: (...a: unknown[]) => fetchMock(...a) }));

import { readCropValue, readCropValueLocated, readCropTable, cropBoxToPage, prepareCrop, resetVisionConfigCache } from '../vision';
import sharp from 'sharp';
import { logAiUsage } from '@/lib/ai/usage';

const png = Buffer.from('89504e470d0a1a0a', 'hex');

beforeEach(() => { fetchMock.mockReset(); (logAiUsage as any).mockClear(); resetVisionConfigCache(); });

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

describe('callVision resilience', () => {
  it('treats a non-JSON 200 body as a failed attempt and tries the next model', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => { throw new SyntaxError('Unexpected token <'); } });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: 'OK' } }] }) });
    const r = await readCropValue({ crop: png, prompt: 'p', operation: 'x' });
    expect(r.model).toBe('gemini-2.5-pro');
    expect(r.value).toBe('OK');
  });

  it('treats a 200 carrying a provider error as a failed attempt (not an empty reading)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ error: { message: 'quota' } }) });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: 'OK' } }] }) });
    const r = await readCropValue({ crop: png, prompt: 'p', operation: 'x' });
    expect(r.model).toBe('gemini-2.5-pro');
    expect(r.value).toBe('OK');
  });

  it('keeps a well-formed empty content as a legitimate empty value (no fallback)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: '' } }] }) });
    const r = await readCropValue({ crop: png, prompt: 'p', operation: 'x' });
    expect(r.value).toBe('');
    expect(r.model).toBe('gemini-2.5-flash');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps a REJECTED fetch inside the attempt and falls back to the next model', async () => {
    // A transport failure (fetchWithRetry exhausting its retries and re-throwing
    // ECONNRESET) used to escape tryModels and abort the whole chain — the exact
    // situation the fallback exists for.
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: 'OK' } }] }) });
    const r = await readCropValue({ crop: png, prompt: 'p', operation: 'x' });
    expect(r.model).toBe('gemini-2.5-pro');
    expect(r.value).toBe('OK');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces the transport error when every model fails to connect', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    fetchMock.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    await expect(readCropValue({ crop: png, prompt: 'p', operation: 'x' })).rejects.toThrow(/ECONNRESET/);
  });

  it('throws the FIRST error when every model fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'primary is busy' });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ error: { message: 'quota' } }) });
    await expect(readCropValue({ crop: png, prompt: 'p', operation: 'x' })).rejects.toThrow(/503.*primary is busy/);
  });

  it('truncates the upstream body in the surfaced error', async () => {
    const huge = 'x'.repeat(5000);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => huge });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => huge });
    await expect(readCropValue({ crop: png, prompt: 'p', operation: 'x' }))
      .rejects.toThrow(expect.objectContaining({ message: expect.stringMatching(/^vision 500: x{200}$/) }));
  });

  it('forwards the usage ref to logAiUsage', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: 'V' } }], usage: { total_tokens: 3 } }) });
    await readCropValue({ crop: png, prompt: 'p', operation: 'x', ref: { refType: 'ExtractionTemplate', refId: 't1' } });
    expect(logAiUsage).toHaveBeenCalledWith(expect.objectContaining({ refType: 'ExtractionTemplate', refId: 't1' }));
  });

  it('readCropTable returns no rows when the content is not JSON', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: 'Sorry, I cannot read this table.' } }] }) });
    const r = await readCropTable({ crop: png, columns: [{ key: 'code', label: 'Κωδ' }], operation: 'x' });
    expect(r.rows).toEqual([]);
    expect(r.model).toBe('gemini-2.5-flash');
  });
});

describe('prepareCrop', () => {
  const PNG_SIG = Buffer.from('89504e470d0a1a0a', 'hex');
  const white = (w: number, h: number) =>
    sharp({ create: { width: w, height: h, channels: 3, background: '#fff' } }).png().toBuffer();

  it('crops a normalized bbox and returns a PNG', async () => {
    const out = await prepareCrop(await white(100, 100), [0.5, 0.5, 0.4, 0.4], { pad: 0 });
    expect(out.subarray(0, 8).equals(PNG_SIG)).toBe(true);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBeGreaterThan(0);
  });

  it('caps the upscaled crop at 2000x2600 so full-page bboxes stay a sane payload', async () => {
    const out = await prepareCrop(await white(3000, 4000), [0, 0, 1, 1]);
    const meta = await sharp(out).metadata();
    expect(meta.width!).toBeLessThanOrEqual(2000);
    expect(meta.height!).toBeLessThanOrEqual(2600);
  });

  it('pads the bbox by default, and by `opts.pad` when asked', async () => {
    const page = await white(1000, 1000);
    const exact = await sharp(await prepareCrop(page, [0.4, 0.4, 0.2, 0.2], { pad: 0 })).metadata();
    const padded = await sharp(await prepareCrop(page, [0.4, 0.4, 0.2, 0.2])).metadata();
    const wide = await sharp(await prepareCrop(page, [0.4, 0.4, 0.2, 0.2], { pad: 0.03 })).metadata();
    // Same page, same box: more padding → more source pixels → a taller crop (the width is capped).
    expect(padded.height!).toBeGreaterThan(exact.height!);
    expect(wide.height!).toBeGreaterThan(padded.height!);
  });
});

describe('model override', () => {
  it('tries the override FIRST and still falls back down the configured chain', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'busy' });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: 'V' } }] }) });
    const r = await readCropValue({ crop: png, prompt: 'p', operation: 'x', model: 'gemini-3-ultra' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('gemini-3-ultra');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).model).toBe('gemini-2.5-flash');
    expect(r.model).toBe('gemini-2.5-flash');
    expect(r.value).toBe('V');
  });

  it('does not ask the same model twice when the override IS the configured model', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: 'V' } }] }) });
    await readCropValue({ crop: png, prompt: 'p', operation: 'x', model: 'gemini-2.5-flash' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('gemini-2.5-flash');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('readCropValueLocated', () => {
  const answer = (content: string) => ({ ok: true, json: async () => ({ choices: [{ message: { content } }], usage: { total_tokens: 9 } }) });

  it('returns the value and the box the model drew inside the crop', async () => {
    fetchMock.mockResolvedValueOnce(answer('{"value":"1.240,00","box_2d":[100,200,300,800]}'));
    const r = await readCropValueLocated({ crop: png, label: 'Σύνολο', valueType: 'CURRENCY', operation: 'template.field.adaptive' });
    expect(r.value).toBe('1.240,00');
    expect(r.box).toEqual([0.2, 0.1, 0.6, 0.2]);
    expect(r.tokensUsed).toBe(9);
  });
  it('names the label and the hint in the prompt', async () => {
    fetchMock.mockResolvedValueOnce(answer('{"value":null}'));
    await readCropValueLocated({ crop: png, label: 'Σύνολο', aiHint: 'κάτω δεξιά', valueType: 'CURRENCY', operation: 'x' });
    const system = JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content;
    expect(system).toContain('Σύνολο');
    expect(system).toContain('κάτω δεξιά');
    expect(system).toContain('box_2d');
  });
  it('reads a value the model located nowhere', async () => {
    fetchMock.mockResolvedValueOnce(answer('{"value":"ΤΙΜ-451"}'));
    const r = await readCropValueLocated({ crop: png, label: 'Αριθμός', valueType: 'TEXT', operation: 'x' });
    expect(r).toMatchObject({ value: 'ΤΙΜ-451', box: null });
  });
  it('a null / nullish answer is an empty value, not the word "null"', async () => {
    fetchMock.mockResolvedValueOnce(answer('{"value":null,"box_2d":[0,0,10,10]}'));
    expect((await readCropValueLocated({ crop: png, label: 'L', valueType: 'TEXT', operation: 'x' })).value).toBe('');
    fetchMock.mockResolvedValueOnce(answer('{"value":"—"}'));
    expect((await readCropValueLocated({ crop: png, label: 'L', valueType: 'TEXT', operation: 'x' })).value).toBe('');
  });
  it('an answer that is not JSON reads as nothing (never as prose)', async () => {
    fetchMock.mockResolvedValueOnce(answer('Δεν μπορώ να βρω την ετικέτα σε αυτή την εικόνα.'));
    expect(await readCropValueLocated({ crop: png, label: 'L', valueType: 'TEXT', operation: 'x' }))
      .toMatchObject({ value: '', box: null });
  });
  it('drops a box the page cannot hold', async () => {
    fetchMock.mockResolvedValueOnce(answer('{"value":"X","box_2d":[500,500,100,100]}'));
    expect((await readCropValueLocated({ crop: png, label: 'L', valueType: 'TEXT', operation: 'x' })).box).toBeNull();
  });
});

describe('cropBoxToPage', () => {
  it('maps a box inside the crop back onto the page', () => {
    expect(cropBoxToPage([0.2, 0.3, 0.4, 0.2], [0.5, 0.5, 0.25, 0.5])).toEqual([0.4, 0.4, 0.1, 0.1]);
  });
  it('a whole-page crop changes nothing', () => {
    expect(cropBoxToPage([0, 0, 1, 1], [0.25, 0.25, 0.5, 0.5])).toEqual([0.25, 0.25, 0.5, 0.5]);
  });
  it('is null without a box to map', () => {
    expect(cropBoxToPage([0.2, 0.3, 0.4, 0.2], null)).toBeNull();
  });
});
