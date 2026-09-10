import { describe, it, expect } from 'vitest';
import { applySetFields, buildReviewFlags, canPost, crossCheckOcr, decideOutcome, extrasFrom, itemsToRows, mappingFellBack, pickMapping, requiredMissing, setInvoicePath, tableFellThrough } from '../run-logic';
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
    expect(decideOutcome('MANUAL', { blocked: [] })).toBe('EXTRACTED');
    expect(decideOutcome('SEMI_AUTO', { blocked: [] })).toBe('REVIEW');
    expect(decideOutcome('AUTO', { blocked: ['x'] })).toBe('BLOCKED');
    expect(decideOutcome('AUTO', { blocked: [] })).toBe('POST');
  });
  it('SEMI_AUTO stays REVIEW even when blocked', () => {
    // The outcome is the mode's; the block is enforced by `canPost` at posting time, so a
    // SEMI_AUTO run with a BLOCK_POSTING reason still cannot be posted from the document page.
    expect(decideOutcome('SEMI_AUTO', { blocked: ['x'] })).toBe('REVIEW');
  });
});

describe('canPost', () => {
  it('is false whenever something is blocked, in EVERY mode', () => {
    expect(canPost('AUTO', { blocked: [] })).toBe(true);
    expect(canPost('SEMI_AUTO', { blocked: [] })).toBe(true);
    expect(canPost('MANUAL', { blocked: [] })).toBe(true);
    expect(canPost('AUTO', { blocked: ['x'] })).toBe(false);
    expect(canPost('SEMI_AUTO', { blocked: ['x'] })).toBe(false);
    expect(canPost('MANUAL', { blocked: ['x'] })).toBe(false);
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

describe('crossCheckOcr', () => {
  const label = (k: string) => ({ total: 'Σύνολο', no: 'Αριθμός', when: 'Ημερομηνία' } as Record<string, string>)[k] ?? k;
  const rows = [
    { fieldKey: 'total', invoiceKey: 'totalAmount' },
    { fieldKey: 'no', invoiceKey: 'invoiceNumber' },
    { fieldKey: 'when', invoiceKey: 'date' },
    { fieldKey: 'note', invoiceKey: 'customFields.note' },
  ];

  it('names the fields where the template and the base OCR disagree', () => {
    const out = crossCheckOcr(rows, { total: v(229.4), no: v('ΤΙΜ-451'), when: v('2026-03-05'), note: v('x') },
      { totalAmount: 22.94, invoiceNumber: 'ΤΙΜ-451', date: '2026-03-05', note: 'y' }, label);
    expect(out).toEqual([{ fieldKey: 'total', reason: 'Ασυμφωνία «Σύνολο»: πρότυπο 229.4 · OCR 22.94' }]);
  });

  it('lets amounts agree within half a cent, and reads Greek amounts on the OCR side', () => {
    expect(crossCheckOcr(rows, { total: v(1234.5) }, { totalAmount: 1234.502 }, label)).toEqual([]);
    expect(crossCheckOcr(rows, { total: v(1234.5) }, { totalAmount: '1.234,50' }, label)).toEqual([]);
    expect(crossCheckOcr(rows, { total: v(1234.5) }, { totalAmount: '1.234,56' }, label)).toHaveLength(1);
  });

  it('compares dates by calendar day, not by the string they were printed as', () => {
    expect(crossCheckOcr(rows, { when: v('2026-03-05') }, { date: '05/03/2026' }, label)).toEqual([]);
    expect(crossCheckOcr(rows, { when: v('2026-03-05') }, { date: '06/03/2026' }, label)).toHaveLength(1);
  });

  it('normalises whitespace and case before calling a text value a mismatch', () => {
    expect(crossCheckOcr(rows, { no: v(' ΤΙΜ  451 ') }, { invoiceNumber: 'ΤΙΜ 451' }, label)).toEqual([]);
  });

  it('says nothing when either side is blank, or the key is not worth checking', () => {
    expect(crossCheckOcr(rows, { total: v(null) }, { totalAmount: 10 }, label)).toEqual([]);
    expect(crossCheckOcr(rows, { total: v(10) }, {}, label)).toEqual([]);
    expect(crossCheckOcr(rows, { note: v('a') }, { note: 'b' }, label)).toEqual([]);
  });
});

describe('tableFellThrough', () => {
  const rows = [{ fieldKey: 'lines.desc', invoiceKey: 'items.name' }, { fieldKey: 'total', invoiceKey: 'totalAmount' }];

  it('names the table when it read nothing and the OCR did read lines', () => {
    expect(tableFellThrough(rows, { lines: v([]) }, { items: [{ name: 'Α' }] })).toBe('lines');
    expect(tableFellThrough(rows, {}, { items: [{ name: 'Α' }] })).toBe('lines');
  });

  it('is null when the table read rows, when the OCR has none either, or with no line mapping', () => {
    expect(tableFellThrough(rows, { lines: v([{ name: 'Β' }]) }, { items: [{ name: 'Α' }] })).toBeNull();
    expect(tableFellThrough(rows, { lines: v([]) }, { items: [] })).toBeNull();
    expect(tableFellThrough(rows, { lines: v([]) }, {})).toBeNull();
    expect(tableFellThrough([{ fieldKey: 'total', invoiceKey: 'totalAmount' }], {}, { items: [{ name: 'Α' }] })).toBeNull();
  });
});
