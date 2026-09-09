import { describe, it, expect, vi, beforeEach } from 'vitest';

const textItems = vi.fn();
const readValue = vi.fn();
const readTable = vi.fn();
const countPages = vi.fn(async (..._a: unknown[]) => 3);
vi.mock('../pdf-text', () => ({ extractPdfTextItems: (...a: unknown[]) => textItems(...a) }));
vi.mock('../vision', () => ({
  prepareCrop: vi.fn(async () => Buffer.from('crop')),
  readCropValue: (...a: unknown[]) => readValue(...a),
  readCropTable: (...a: unknown[]) => readTable(...a),
}));
vi.mock('@/lib/ocr/rasterize', () => ({
  isPdfBuffer: (b: Buffer) => b.subarray(0, 4).toString() === '%PDF',
  renderPage: vi.fn(async () => Buffer.from('page-png')),
  countPdfPages: (...a: unknown[]) => countPages(...a),
}));

import { extractTemplateFields } from '../extract';
import type { FieldDef } from '../schema';

const field = (over: Partial<FieldDef>): FieldDef => ({
  key: 'no', label: 'Αριθμός', kind: 'SINGLE', valueType: 'TEXT', color: '#0078D4',
  region: { page: 0, bbox: [0.1, 0.1, 0.3, 0.05] }, columns: null, aiHint: null, required: false, order: 0, ...over,
});
const pdf = Buffer.from('%PDF-1.4 fake');
const png = Buffer.from('not a pdf');

beforeEach(() => { textItems.mockReset(); readValue.mockReset(); readTable.mockReset(); countPages.mockReset(); countPages.mockResolvedValue(3); });

describe('extractTemplateFields', () => {
  it('uses the PDF text layer when it yields text (no vision call)', async () => {
    textItems.mockResolvedValueOnce([{ str: 'ΤΙΜ-451', x: 0.12, y: 0.11, w: 0.1, h: 0.02 }]);
    const out = await extractTemplateFields(pdf, 'application/pdf', [field({})]);
    expect(out.values.no).toMatchObject({ raw: 'ΤΙΜ-451', value: 'ΤΙΜ-451', source: 'text', page: 0, color: '#0078D4' });
    expect(readValue).not.toHaveBeenCalled();
    expect(out.tokensUsed).toBe(0);
  });
  it('falls back to vision when the text layer is empty, coercing by type', async () => {
    textItems.mockResolvedValueOnce([]);
    readValue.mockResolvedValueOnce({ value: '1.240,00', model: 'm', tokensUsed: 7 });
    const out = await extractTemplateFields(pdf, 'application/pdf', [field({ key: 'total', valueType: 'CURRENCY' })]);
    expect(out.values.total).toMatchObject({ raw: '1.240,00', value: 1240, source: 'vision' });
    expect(out.model).toBe('m'); expect(out.tokensUsed).toBe(7);
    expect(readValue.mock.calls[0][0].prompt).toContain('Αριθμός');
  });
  it('images always go through vision; TABLE fields use readCropTable and coerce columns', async () => {
    readTable.mockResolvedValueOnce({ rows: [{ code: 'A1', qty: '2,5' }], model: 'm', tokensUsed: 3 });
    const f = field({ key: 'lines', kind: 'TABLE', valueType: 'TEXT', columns: [{ key: 'code', label: 'Κωδ', valueType: 'TEXT' }, { key: 'qty', label: 'Ποσ', valueType: 'NUMBER' }] });
    const out = await extractTemplateFields(png, 'image/png', [f]);
    expect(out.values.lines.value).toEqual([{ code: 'A1', qty: 2.5 }]);
    expect(out.values.lines.confidence).toBe(0.8);
    expect(textItems).not.toHaveBeenCalled();
  });
  it('falls through to vision when the text-layer hit is too short to be a value', async () => {
    textItems.mockResolvedValueOnce([{ str: 'X', x: 0.12, y: 0.11, w: 0.02, h: 0.02 }]);
    readValue.mockResolvedValueOnce({ value: 'ΤΙΜ-451', model: 'm', tokensUsed: 4 });
    const out = await extractTemplateFields(pdf, 'application/pdf', [field({})]);
    expect(out.values.no).toMatchObject({ raw: 'ΤΙΜ-451', source: 'vision', confidence: 0.8 });
    expect(readValue).toHaveBeenCalledTimes(1);
  });

  it('falls through to vision when a typed field\'s text-layer hit will not coerce', async () => {
    // "abc" sits in the NUMBER field's box (a stray label, or the region is off) —
    // storing it as source 'text' with confidence 1 would be a confident null.
    textItems.mockResolvedValueOnce([{ str: 'abc', x: 0.12, y: 0.11, w: 0.05, h: 0.02 }]);
    readValue.mockResolvedValueOnce({ value: '42', model: 'm', tokensUsed: 2 });
    const out = await extractTemplateFields(pdf, 'application/pdf', [field({ key: 'qty', valueType: 'NUMBER' })]);
    expect(out.values.qty).toMatchObject({ raw: '42', value: 42, source: 'vision' });
    expect(readValue).toHaveBeenCalledTimes(1);
  });

  it('keeps a typed text-layer hit that does coerce', async () => {
    textItems.mockResolvedValueOnce([{ str: '1.240,00', x: 0.12, y: 0.11, w: 0.08, h: 0.02 }]);
    const out = await extractTemplateFields(pdf, 'application/pdf', [field({ key: 'total', valueType: 'CURRENCY' })]);
    expect(out.values.total).toMatchObject({ raw: '1.240,00', value: 1240, source: 'text', confidence: 1 });
    expect(readValue).not.toHaveBeenCalled();
  });

  it('TABLE fields skip the text layer even on a digital PDF (structure is not recoverable from it)', async () => {
    readTable.mockResolvedValueOnce({ rows: [{ code: 'A1' }], model: 'm', tokensUsed: 3 });
    const f = field({ key: 'lines', kind: 'TABLE', columns: [{ key: 'code', label: 'Κωδ', valueType: 'TEXT' }] });
    const out = await extractTemplateFields(pdf, 'application/pdf', [f]);
    expect(readTable).toHaveBeenCalledTimes(1);
    expect(textItems).not.toHaveBeenCalled();
    expect(out.values.lines.value).toEqual([{ code: 'A1' }]);
  });

  it('joins the distinct models used across fields', async () => {
    textItems.mockResolvedValue([]);
    readValue.mockResolvedValueOnce({ value: 'a', model: 'gemini-flash', tokensUsed: 1 });
    readValue.mockResolvedValueOnce({ value: 'b', model: 'gemini-pro', tokensUsed: 1 });
    readValue.mockResolvedValueOnce({ value: 'c', model: 'gemini-flash', tokensUsed: 1 });
    const out = await extractTemplateFields(pdf, 'application/pdf', [field({ key: 'a' }), field({ key: 'b' }), field({ key: 'c' })]);
    expect(out.model).toBe('gemini-flash, gemini-pro');
    expect(out.tokensUsed).toBe(3);
  });

  it('reports model null when nothing was read by a model', async () => {
    const out = await extractTemplateFields(png, 'image/png', [field({ region: null })]);
    expect(out.model).toBeNull();
  });

  it('reports the PDF page count, and 1 for an image (never counting a non-PDF)', async () => {
    textItems.mockResolvedValue([{ str: 'ΤΙΜ-451', x: 0.12, y: 0.11, w: 0.1, h: 0.02 }]);
    const pdfOut = await extractTemplateFields(pdf, 'application/pdf', [field({})]);
    expect(pdfOut.pageCount).toBe(3);

    readValue.mockResolvedValueOnce({ value: 'v', model: 'm', tokensUsed: 1 });
    const pngOut = await extractTemplateFields(png, 'image/png', [field({})]);
    expect(pngOut.pageCount).toBe(1);
    expect(countPages).toHaveBeenCalledTimes(1);
  });

  it('threads the usage ref through to both readers', async () => {
    textItems.mockResolvedValueOnce([]);
    readValue.mockResolvedValueOnce({ value: 'v', model: 'm', tokensUsed: 1 });
    await extractTemplateFields(pdf, 'application/pdf', [field({})], { ref: { refType: 'TemplateRun', refId: 'r1' } });
    expect(readValue.mock.calls[0][0].ref).toEqual({ refType: 'TemplateRun', refId: 'r1' });
  });

  it('degrades to vision when the PDF text layer cannot be parsed, once per page', async () => {
    // A malformed/encrypted text layer must not fail the field — and must not be
    // re-attempted for every field on the same page.
    textItems.mockRejectedValue(new Error('bad pdf'));
    readValue.mockResolvedValue({ value: 'v', model: 'm', tokensUsed: 1 });
    const out = await extractTemplateFields(pdf, 'application/pdf', [field({ key: 'a' }), field({ key: 'b' })]);
    expect(readValue).toHaveBeenCalledTimes(2);
    expect(textItems).toHaveBeenCalledTimes(1);
    expect(out.errors).toEqual([]);
    expect(out.values.a).toMatchObject({ raw: 'v', source: 'vision' });
    expect(out.values.b).toMatchObject({ raw: 'v', source: 'vision' });
  });

  it('fields without a region are returned as null without any call; per-field errors do not abort the batch', async () => {
    readValue.mockRejectedValueOnce(new Error('boom'));
    const out = await extractTemplateFields(png, 'image/png', [field({ key: 'a', region: null }), field({ key: 'b' })]);
    expect(out.values.a).toMatchObject({ value: null, source: 'none', bbox: null });
    expect(out.values.b).toMatchObject({ value: null });
    expect(out.errors).toEqual([{ fieldKey: 'b', message: 'boom' }]);
  });
});
