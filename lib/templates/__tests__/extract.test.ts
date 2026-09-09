import { describe, it, expect, vi, beforeEach } from 'vitest';

const textItems = vi.fn();
const readValue = vi.fn();
const readTable = vi.fn();
vi.mock('../pdf-text', () => ({ extractPdfTextItems: (...a: unknown[]) => textItems(...a) }));
vi.mock('../vision', () => ({
  prepareCrop: vi.fn(async () => Buffer.from('crop')),
  readCropValue: (...a: unknown[]) => readValue(...a),
  readCropTable: (...a: unknown[]) => readTable(...a),
}));
vi.mock('@/lib/ocr/rasterize', () => ({
  isPdfBuffer: (b: Buffer) => b.subarray(0, 4).toString() === '%PDF',
  renderPage: vi.fn(async () => Buffer.from('page-png')),
}));

import { extractTemplateFields } from '../extract';
import type { FieldDef } from '../schema';

const field = (over: Partial<FieldDef>): FieldDef => ({
  key: 'no', label: 'Αριθμός', kind: 'SINGLE', valueType: 'TEXT', color: '#0078D4',
  region: { page: 0, bbox: [0.1, 0.1, 0.3, 0.05] }, columns: null, aiHint: null, required: false, order: 0, ...over,
});
const pdf = Buffer.from('%PDF-1.4 fake');
const png = Buffer.from('not a pdf');

beforeEach(() => { textItems.mockReset(); readValue.mockReset(); readTable.mockReset(); });

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
    expect(textItems).not.toHaveBeenCalled();
  });
  it('fields without a region are returned as null without any call; per-field errors do not abort the batch', async () => {
    readValue.mockRejectedValueOnce(new Error('boom'));
    const out = await extractTemplateFields(png, 'image/png', [field({ key: 'a', region: null }), field({ key: 'b' })]);
    expect(out.values.a).toMatchObject({ value: null, source: 'vision', bbox: null });
    expect(out.values.b).toMatchObject({ value: null });
    expect(out.errors).toEqual([{ fieldKey: 'b', message: 'boom' }]);
  });
});
