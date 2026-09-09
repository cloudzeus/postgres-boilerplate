import { describe, it, expect } from 'vitest';
import { applySetFields, buildReviewFlags, canPost, decideOutcome, extrasFrom, itemsToRows, mappingFellBack, pickMapping, requiredMissing, setInvoicePath } from '../run-logic';
import type { FieldDef, FieldValue } from '../schema';

const f = (key: string, over: Partial<FieldDef> = {}): FieldDef => ({ key, label: key, kind: 'SINGLE', valueType: 'TEXT', color: '#0078D4', region: { page: 0, bbox: [0, 0, 0.1, 0.1] }, columns: null, aiHint: null, required: false, order: 0, ...over });
const v = (value: FieldValue['value'], source: FieldValue['source'] = 'vision'): FieldValue => ({ raw: value == null ? null : String(value), value, confidence: 0.8, source, page: 0, bbox: [0, 0, 0.1, 0.1], color: '#0078D4' });

describe('applySetFields', () => {
  it('coerces by the field type and marks the value as written by a rule', () => {
    const out = applySetFields({ total: v('1') }, [f('total', { valueType: 'CURRENCY' })], [{ fieldKey: 'total', value: '1.234,50' }]);
    expect(out.total.value).toBe(1234.5);
    expect(out.total.source).toBe('rule');
    expect(out.total.raw).toBe('1.234,50');
  });
  it('creates a value for a field that had none and ignores unknown keys', () => {
    const out = applySetFields({}, [f('note')], [{ fieldKey: 'note', value: 'x' }, { fieldKey: 'nope', value: 'y' }]);
    expect(out.note.value).toBe('x');
    expect(out.nope).toBeUndefined();
  });
  it('a field with no region and no previous value has no coordinates at all', () => {
    const out = applySetFields({}, [f('note', { region: null })], [{ fieldKey: 'note', value: 'x' }]);
    expect(out.note.page).toBeNull();
    expect(out.note.bbox).toBeNull();
  });
  it('an existing value keeps ITS coordinates, page and bbox together', () => {
    const prev: FieldValue = { ...v('old'), page: 2, bbox: [0.5, 0.5, 0.2, 0.2] };
    const out = applySetFields({ note: prev }, [f('note')], [{ fieldKey: 'note', value: 'x' }]);
    expect(out.note.page).toBe(2);
    expect(out.note.bbox).toEqual([0.5, 0.5, 0.2, 0.2]);  // not the field region's [0,0,0.1,0.1]
  });
});

describe('requiredMissing', () => {
  it('lists required fields whose value is null or empty', () => {
    const fields = [f('a', { required: true }), f('b', { required: true }), f('c', { required: true }), f('d')];
    expect(requiredMissing(fields, { a: v('ok'), b: v(''), c: v(null) })).toEqual([fields[1], fields[2]]);
  });
});

describe('pickMapping', () => {
  const maps = [{ name: 'default', target: 'INVOICE' as const, isDefault: true }, { name: 'credit', target: 'INVOICE' as const, isDefault: false }, { name: 'xls', target: 'EXCEL' as const, isDefault: false }];
  it('prefers the switched name, then the default INVOICE mapping, then the first INVOICE one', () => {
    expect(pickMapping(maps, 'credit')?.name).toBe('credit');
    expect(pickMapping(maps, null)?.name).toBe('default');
    expect(pickMapping(maps.slice(1), null)?.name).toBe('credit');
    expect(pickMapping([maps[2]], null)).toBeNull();
    expect(pickMapping(maps, 'xls')?.name).toBe('default'); // EXCEL mappings never drive the invoice projection
  });
});

describe('mappingFellBack', () => {
  const maps = [{ name: 'default', target: 'INVOICE' as const, isDefault: true }, { name: 'xls', target: 'EXCEL' as const, isDefault: false }];
  it('is true only when a rule named an INVOICE mapping that does not exist', () => {
    expect(mappingFellBack(maps, null)).toBe(false);
    expect(mappingFellBack(maps, 'default')).toBe(false);
    expect(mappingFellBack(maps, 'credit')).toBe(true);
    expect(mappingFellBack(maps, 'xls')).toBe(true);  // an EXCEL mapping can never drive the projection
  });
});

describe('decideOutcome', () => {
  it('follows the mode and the blocked flags', () => {
    expect(decideOutcome('MANUAL', { review: [], blocked: [] })).toBe('EXTRACTED');
    expect(decideOutcome('SEMI_AUTO', { review: ['x'], blocked: [] })).toBe('REVIEW');
    expect(decideOutcome('AUTO', { review: [], blocked: ['x'] })).toBe('BLOCKED');
    expect(decideOutcome('AUTO', { review: [], blocked: [] })).toBe('POST');
  });
  it('SEMI_AUTO stays REVIEW even when blocked', () => {
    // The outcome is the mode's; the block is enforced by `canPost` at posting time, so a
    // SEMI_AUTO run with a BLOCK_POSTING reason still cannot be posted from the document page.
    expect(decideOutcome('SEMI_AUTO', { review: [], blocked: ['x'] })).toBe('REVIEW');
  });
});

describe('canPost', () => {
  it('is false whenever something is blocked, in EVERY mode', () => {
    expect(canPost('AUTO', { review: [], blocked: [] })).toBe(true);
    expect(canPost('SEMI_AUTO', { review: ['x'], blocked: [] })).toBe(true);
    expect(canPost('MANUAL', { review: [], blocked: [] })).toBe(true);
    expect(canPost('AUTO', { review: [], blocked: ['x'] })).toBe(false);
    expect(canPost('SEMI_AUTO', { review: [], blocked: ['x'] })).toBe(false);
    expect(canPost('MANUAL', { review: [], blocked: ['x'] })).toBe(false);
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
    expect(setInvoicePath(d, 'invoiceNumber', '9')).toBe(true);
    expect(setInvoicePath(d, 'customFields.po', 'PO-1')).toBe(true);
    expect(setInvoicePath(d, 'items.total', '1')).toBe(false);
    expect(setInvoicePath(d, 'nope', 'x')).toBe(false);
    expect(d).toEqual({ invoiceNumber: '9', customFields: { a: 1, po: 'PO-1' } });
  });
  it('coerces a typed key by its declared type', () => {
    const d: Record<string, unknown> = {};
    expect(setInvoicePath(d, 'totalAmount', '1.234,50')).toBe(true);
    expect(d.totalAmount).toBe(1234.5);
  });
  it('leaves a typed key untouched when the value will not coerce', () => {
    const d: Record<string, unknown> = { totalAmount: 5 };
    expect(setInvoicePath(d, 'totalAmount', 'abc')).toBe(false);
    expect(d.totalAmount).toBe(5);
  });
  it('never writes through a prototype-polluting customFields key', () => {
    const d: Record<string, unknown> = {};
    expect(setInvoicePath(d, 'customFields.__proto__', 'x')).toBe(false);
    expect(setInvoicePath(d, 'customFields.constructor', 'x')).toBe(false);
    expect(setInvoicePath(d, 'customFields.prototype', 'x')).toBe(false);
    expect(d).toEqual({});
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});

describe('itemsToRows', () => {
  it('maps extracted items to OcrInvoiceItem rows with numeric coercion', () => {
    expect(itemsToRows([{ code: 'A', name: 'x', quantity: '2', price: 1.5, total: null }])).toEqual([{ rowIndex: 0, code: 'A', name: 'x', quantity: 2, price: 1.5, discount: null, vatRate: null, total: null }]);
  });
  it('parses Greek-formatted strings the same way the rest of the pipeline does', () => {
    const [row] = itemsToRows([{ name: 'x', total: '1.234,50', price: '1.234', quantity: '2,5', vatRate: '13%', discount: '' }]);
    expect(row.total).toBe(1234.5);
    expect(row.price).toBe(1234);   // whole-euro thousands grouping, not 1.234
    expect(row.quantity).toBe(2.5);
    expect(row.vatRate).toBe(13);
    expect(row.discount).toBeNull();
  });
  it('drops null entries and renumbers the rows that survive', () => {
    expect(itemsToRows([null, { name: 'x' }])).toEqual([{ rowIndex: 0, code: null, name: 'x', quantity: null, price: null, discount: null, vatRate: null, total: null }]);
  });
});

describe('buildReviewFlags', () => {
  it('summarises a run for the document list', () => {
    expect(buildReviewFlags({ slug: 's', name: 'N' }, 'REVIEW', 'r1', { review: ['a'], blocked: [] })).toEqual({ review: ['a'], blocked: [], templateSlug: 's', templateName: 'N', runStatus: 'REVIEW', runId: 'r1' });
  });
});
