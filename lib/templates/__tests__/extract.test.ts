import { describe, it, expect, vi, beforeEach } from 'vitest';

const textItems = vi.fn();
const readValue = vi.fn();
const readTable = vi.fn();
const readLocated = vi.fn();
const prepare = vi.fn(async (..._a: unknown[]) => Buffer.from('crop'));
const countPages = vi.fn(async (..._a: unknown[]) => 3);
vi.mock('../pdf-text', () => ({ extractPdfTextItems: (...a: unknown[]) => textItems(...a) }));
vi.mock('../vision', () => ({
  prepareCrop: (...a: unknown[]) => prepare(...a),
  readCropValue: (...a: unknown[]) => readValue(...a),
  readCropTable: (...a: unknown[]) => readTable(...a),
  readCropValueLocated: (...a: unknown[]) => readLocated(...a),
}));
// The retry asks for the upgraded model by name; the real module is a heavy server import.
vi.mock('@/lib/ocr/extract', () => ({ UPGRADED_VISION_MODEL: 'gemini-2.5-pro' }));
vi.mock('@/lib/ocr/rasterize', () => ({
  isPdfBuffer: (b: Buffer) => b.subarray(0, 4).toString() === '%PDF',
  renderPage: vi.fn(async () => Buffer.from('page-png')),
  countPdfPages: (...a: unknown[]) => countPages(...a),
}));

import { extractTemplateFields } from '../extract';
import { widenBbox } from '../adaptive';
import { cropBoxToPage } from '../geometry';
import type { Bbox, FieldDef } from '../schema';

const field = (over: Partial<FieldDef>): FieldDef => ({
  key: 'no', label: 'Αριθμός', kind: 'SINGLE', valueType: 'TEXT', color: '#0078D4',
  region: { page: 0, bbox: [0.1, 0.1, 0.3, 0.05] }, columns: null, aiHint: null, required: false, order: 0, ...over,
});
const pdf = Buffer.from('%PDF-1.4 fake');
const png = Buffer.from('not a pdf');

beforeEach(() => {
  textItems.mockReset(); readValue.mockReset(); readTable.mockReset(); countPages.mockReset(); prepare.mockReset(); readLocated.mockReset();
  countPages.mockResolvedValue(3);
  prepare.mockResolvedValue(Buffer.from('crop'));
  // The widened second look finds nothing unless a test says otherwise.
  readLocated.mockResolvedValue({ value: '', box: null, model: 'm', tokensUsed: 0 });
});

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

describe('typed reading and the one-shot retry', () => {
  it('tells the model how a Greek amount is printed, and how to leave a date alone', async () => {
    readValue.mockResolvedValue({ value: '5', model: 'm', tokensUsed: 1 });
    await extractTemplateFields(png, 'image/png', [field({ key: 'total', valueType: 'CURRENCY' }), field({ key: 'when', valueType: 'DATE' }), field({ key: 'txt' })]);
    expect(readValue.mock.calls[0][0].prompt).toContain('1.234,56');
    expect(readValue.mock.calls[0][0].prompt).toContain('without a currency symbol');
    expect(readValue.mock.calls[1][0].prompt).toContain('exactly as printed');
    expect(readValue.mock.calls[2][0].prompt).not.toContain('1.234,56');
  });

  it('retries an empty CURRENCY read ONCE, with a wider crop and the upgraded model', async () => {
    readValue.mockResolvedValueOnce({ value: '', model: 'gemini-2.5-flash', tokensUsed: 3 });
    readValue.mockResolvedValueOnce({ value: '229,40', model: 'gemini-2.5-pro', tokensUsed: 9 });

    const out = await extractTemplateFields(png, 'image/png', [field({ key: 'total', valueType: 'CURRENCY' })]);

    expect(readValue).toHaveBeenCalledTimes(2);
    expect(readValue.mock.calls[0][0].model).toBeUndefined();
    expect(readValue.mock.calls[1][0].model).toBe('gemini-2.5-pro');
    // The retry crop is cut with MORE padding than the first one.
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(prepare.mock.calls[0][2]).toBeUndefined();
    expect((prepare.mock.calls[1][2] as { pad: number }).pad).toBeGreaterThan(0.012);
    // The retry's reading is the one that is stored, marked down so a human still looks at it.
    expect(out.values.total).toMatchObject({ raw: '229,40', value: 229.4, source: 'vision', confidence: 0.6 });
    expect(out.tokensUsed).toBe(12);
    expect(out.model).toBe('gemini-2.5-flash, gemini-2.5-pro');
  });

  it('retries a reading that will not coerce, and keeps the first one when the retry reads nothing', async () => {
    readValue.mockResolvedValueOnce({ value: 'δεν διαβάζεται', model: 'm', tokensUsed: 1 });
    readValue.mockResolvedValueOnce({ value: '', model: 'gemini-2.5-pro', tokensUsed: 1 });
    const out = await extractTemplateFields(png, 'image/png', [field({ key: 'when', valueType: 'DATE' })]);
    expect(readValue).toHaveBeenCalledTimes(2);
    expect(out.values.when).toMatchObject({ raw: 'δεν διαβάζεται', value: null, confidence: 0.8 });
  });

  it('never retries a TEXT field, however empty it reads', async () => {
    readValue.mockResolvedValueOnce({ value: '', model: 'm', tokensUsed: 1 });
    const out = await extractTemplateFields(png, 'image/png', [field({ key: 'note' })]);
    expect(readValue).toHaveBeenCalledTimes(1);
    expect(out.values.note).toMatchObject({ raw: null, value: null, confidence: null });
  });
});

describe('the adaptive second look (spec §17.2)', () => {
  const REGION_BBOX: Bbox = [0.1, 0.1, 0.3, 0.05];
  const lastGood = (bbox: Bbox, page = 0) => ({ page, bbox, at: '2026-09-10T10:00:00.000Z', n: 3 });

  it('re-reads a blank field in a widened box and stores where it actually found the value', async () => {
    readValue.mockResolvedValueOnce({ value: '', model: 'm', tokensUsed: 1 });
    readLocated.mockResolvedValueOnce({ value: 'ΤΙΜ-451', box: [0.5, 0.4, 0.2, 0.3], model: 'gemini-2.5-flash', tokensUsed: 6 });

    const out = await extractTemplateFields(png, 'image/png', [field({})]);

    const wide = widenBbox(REGION_BBOX);
    expect(readLocated).toHaveBeenCalledTimes(1);
    expect(readLocated.mock.calls[0][0]).toMatchObject({ label: 'Αριθμός', valueType: 'TEXT' });
    // The widened crop is cut EXACTLY — the box is already the padding.
    expect(prepare.mock.calls[1][1]).toEqual(wide);
    expect(prepare.mock.calls[1][2]).toEqual({ pad: 0 });
    expect(out.values.no).toMatchObject({
      raw: 'ΤΙΜ-451', value: 'ΤΙΜ-451', source: 'vision', confidence: 0.5, adaptive: true,
      page: 0, bbox: cropBoxToPage(wide, [0.5, 0.4, 0.2, 0.3]),
    });
    expect(out.adaptive).toEqual(['no']);
    expect(out.tokensUsed).toBe(7);
  });

  it('searches around lastGood — and on ITS page — once the field has drifted', async () => {
    readValue.mockResolvedValueOnce({ value: '', model: 'm', tokensUsed: 0 });
    readLocated.mockResolvedValueOnce({ value: 'X', box: null, model: 'm', tokensUsed: 1 });
    const lg = lastGood([0.12, 0.3, 0.3, 0.05], 2);

    const out = await extractTemplateFields(png, 'image/png', [field({ lastGood: lg })]);

    expect(prepare.mock.calls[1][1]).toEqual(widenBbox(lg.bbox));
    // No box from the model → the value is recorded at the box that was searched.
    expect(out.values.no).toMatchObject({ page: 2, bbox: widenBbox(lg.bbox), adaptive: true });
  });

  it('comes after the one-shot retry, and only when that retry also read nothing', async () => {
    readValue.mockResolvedValueOnce({ value: '', model: 'm', tokensUsed: 1 });
    readValue.mockResolvedValueOnce({ value: '229,40', model: 'gemini-2.5-pro', tokensUsed: 9 });
    const out = await extractTemplateFields(png, 'image/png', [field({ key: 'total', valueType: 'CURRENCY' })]);
    expect(readLocated).not.toHaveBeenCalled();
    expect(out.values.total).toMatchObject({ value: 229.4, confidence: 0.6 });
    expect(out.values.total.adaptive).toBeUndefined();
    expect(out.adaptive).toEqual([]);
  });

  it('runs for a CURRENCY field the retry could not rescue either', async () => {
    readValue.mockResolvedValueOnce({ value: '', model: 'm', tokensUsed: 1 });
    readValue.mockResolvedValueOnce({ value: '', model: 'gemini-2.5-pro', tokensUsed: 1 });
    readLocated.mockResolvedValueOnce({ value: '1.240,00', box: null, model: 'm', tokensUsed: 2 });
    const out = await extractTemplateFields(png, 'image/png', [field({ key: 'total', valueType: 'CURRENCY' })]);
    expect(readValue).toHaveBeenCalledTimes(2);
    expect(out.values.total).toMatchObject({ value: 1240, confidence: 0.5, adaptive: true });
  });

  it('a text-layer hit never triggers it (the free reader was right)', async () => {
    textItems.mockResolvedValueOnce([{ str: 'ΤΙΜ-451', x: 0.12, y: 0.11, w: 0.1, h: 0.02 }]);
    await extractTemplateFields(pdf, 'application/pdf', [field({})]);
    expect(readLocated).not.toHaveBeenCalled();
  });

  it('asks at most ONCE per field, however blank the answer', async () => {
    readValue.mockResolvedValue({ value: '', model: 'm', tokensUsed: 0 });
    const out = await extractTemplateFields(png, 'image/png', [field({ key: 'a' }), field({ key: 'b' })]);
    expect(readLocated).toHaveBeenCalledTimes(2);   // once per field, not once per box
    expect(out.adaptive).toEqual([]);
    expect(out.values.a).toMatchObject({ raw: null, value: null, source: 'vision' });
  });

  it('keeps the reading the model would not coerce rather than an adaptive null', async () => {
    readValue.mockResolvedValueOnce({ value: 'δεν διαβάζεται', model: 'm', tokensUsed: 1 });
    readValue.mockResolvedValueOnce({ value: '', model: 'gemini-2.5-pro', tokensUsed: 1 });
    readLocated.mockResolvedValueOnce({ value: 'κι αυτό όχι', box: null, model: 'm', tokensUsed: 1 });
    const out = await extractTemplateFields(png, 'image/png', [field({ key: 'when', valueType: 'DATE' })]);
    expect(out.values.when).toMatchObject({ raw: 'δεν διαβάζεται', value: null, confidence: 0.8 });
    expect(out.adaptive).toEqual([]);
  });

  it('never runs for a TABLE field, or for a field with no region at all', async () => {
    readTable.mockResolvedValueOnce({ rows: [], model: 'm', tokensUsed: 1 });
    const table = field({ key: 'lines', kind: 'TABLE', columns: [{ key: 'c', label: 'C', valueType: 'TEXT' }] });
    await extractTemplateFields(png, 'image/png', [table, field({ key: 'none', region: null })]);
    expect(readLocated).not.toHaveBeenCalled();
  });

  it('a widened read that blows up leaves the field as the first read left it', async () => {
    readValue.mockResolvedValueOnce({ value: '', model: 'm', tokensUsed: 1 });
    readLocated.mockRejectedValueOnce(new Error('page out of range'));
    const out = await extractTemplateFields(png, 'image/png', [field({})]);
    expect(out.values.no).toMatchObject({ raw: null, value: null, source: 'vision' });
    expect(out.errors).toEqual([]);      // the field did not fail — it just found nothing
    expect(out.adaptive).toEqual([]);
  });
});
