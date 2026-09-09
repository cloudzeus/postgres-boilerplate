import { describe, it, expect } from 'vitest';
import { applySetFields, requiredMissing, pickMapping, decideStatus, extrasFrom, itemsToRows, setInvoicePath, buildReviewFlags } from '../run-logic';
import type { FieldDef, FieldValue } from '../schema';

const f = (key: string, over: Partial<FieldDef> = {}): FieldDef => ({ key, label: key, kind: 'SINGLE', valueType: 'TEXT', color: '#0078D4', region: { page: 0, bbox: [0, 0, 0.1, 0.1] }, columns: null, aiHint: null, required: false, order: 0, ...over });
const v = (value: FieldValue['value'], source: FieldValue['source'] = 'vision'): FieldValue => ({ raw: value == null ? null : String(value), value, confidence: 0.8, source, page: 0, bbox: [0, 0, 0.1, 0.1], color: '#0078D4' });

describe('applySetFields', () => {
  it('coerces by the field type and marks the value manual', () => {
    const out = applySetFields({ total: v('1') }, [f('total', { valueType: 'CURRENCY' })], [{ fieldKey: 'total', value: '1.234,50' }]);
    expect(out.total.value).toBe(1234.5);
    expect(out.total.source).toBe('manual');
    expect(out.total.raw).toBe('1.234,50');
  });
  it('creates a value for a field that had none and ignores unknown keys', () => {
    const out = applySetFields({}, [f('note')], [{ fieldKey: 'note', value: 'x' }, { fieldKey: 'nope', value: 'y' }]);
    expect(out.note.value).toBe('x');
    expect(out.nope).toBeUndefined();
  });
});

describe('requiredMissing', () => {
  it('lists required fields whose value is null or empty', () => {
    const fields = [f('a', { required: true }), f('b', { required: true }), f('c', { required: true }), f('d')];
    expect(requiredMissing(fields, { a: v('ok'), b: v(''), c: v(null) })).toEqual([fields[1], fields[2]]);
  });
});

describe('pickMapping', () => {
  const maps = [{ name: 'default', target: 'INVOICE' as const, isDefault: true, rows: [] }, { name: 'credit', target: 'INVOICE' as const, isDefault: false, rows: [] }, { name: 'xls', target: 'EXCEL' as const, isDefault: false, rows: [] }];
  it('prefers the switched name, then the default INVOICE mapping, then the first INVOICE one', () => {
    expect(pickMapping(maps, 'credit')?.name).toBe('credit');
    expect(pickMapping(maps, null)?.name).toBe('default');
    expect(pickMapping(maps.slice(1), null)?.name).toBe('credit');
    expect(pickMapping([maps[2]], null)).toBeNull();
    expect(pickMapping(maps, 'xls')?.name).toBe('default'); // EXCEL mappings never drive the invoice projection
  });
});

describe('decideStatus', () => {
  it('follows the mode and the blocked flags', () => {
    expect(decideStatus('MANUAL', { review: [], blocked: [] })).toBe('EXTRACTED');
    expect(decideStatus('SEMI_AUTO', { review: ['x'], blocked: [] })).toBe('REVIEW');
    expect(decideStatus('AUTO', { review: [], blocked: ['x'] })).toBe('BLOCKED');
    expect(decideStatus('AUTO', { review: [], blocked: [] })).toBe('POST');
  });
});

describe('extrasFrom', () => {
  it('reads $total/$itemsCount/$pageCount from the base OCR result', () => {
    expect(extrasFrom({ totalAmount: 12.5 }, 3, 2)).toEqual({ $total: 12.5, $itemsCount: 3, $pageCount: 2 });
    expect(extrasFrom({}, 0, 1).$total).toBeNull();
  });
});

describe('setInvoicePath', () => {
  it('writes header keys and customFields.<k>, ignores items.*', () => {
    const d: Record<string, unknown> = { customFields: { a: 1 } };
    setInvoicePath(d, 'invoiceNumber', '9');
    setInvoicePath(d, 'customFields.po', 'PO-1');
    setInvoicePath(d, 'items.total', '1');
    expect(d).toEqual({ invoiceNumber: '9', customFields: { a: 1, po: 'PO-1' } });
  });
});

describe('itemsToRows', () => {
  it('maps extracted items to OcrInvoiceItem rows with numeric coercion', () => {
    expect(itemsToRows([{ code: 'A', name: 'x', quantity: '2', price: 1.5, total: null }])).toEqual([{ rowIndex: 0, code: 'A', name: 'x', quantity: 2, price: 1.5, discount: null, vatRate: null, total: null }]);
  });
});

describe('buildReviewFlags', () => {
  it('summarises a run for the document list', () => {
    expect(buildReviewFlags({ slug: 's', name: 'N' }, 'REVIEW', 'r1', { review: ['a'], blocked: [] })).toEqual({ review: ['a'], blocked: [], templateSlug: 's', templateName: 'N', runStatus: 'REVIEW', runId: 'r1' });
  });
});
