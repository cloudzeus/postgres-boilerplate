import { describe, it, expect } from 'vitest';
import { emptyDocument, setPath, type DocumentJson, type DocumentLine } from '@/lib/ocr/canonical';
import { applySetFields, baseOcrSnapshot, buildReviewFlags, canPost, crossCheckOcr, decideOutcome, extrasFrom, mappingFellBack, pickMapping, requiredMissing, setDocumentPath, tableFellThrough } from '../run-logic';

const blankDoc = (): DocumentJson => emptyDocument('invoice');
const line = (over: Partial<DocumentLine> = {}): DocumentLine =>
  ({ code: null, name: null, unit: null, quantity: null, unitPrice: null, discount: null, net: null, vatRate: null, vatAmount: null, total: null, custom: {}, ...over });
const withLines = (lines: DocumentLine[]): DocumentJson => ({ ...blankDoc(), lines });
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
  it('reads $total/$itemsCount/$pageCount from the canonical document', () => {
    expect(extrasFrom(setPath(blankDoc(), 'totals.total', 12.5), 3, 2)).toEqual({ $total: 12.5, $itemsCount: 3, $pageCount: 2 });
    expect(extrasFrom(blankDoc(), 0, 1).$total).toBeNull();
  });
});

describe('setDocumentPath', () => {
  it('writes header paths and custom.<k>, ignores lines.*', () => {
    let d: DocumentJson = { ...blankDoc(), custom: { a: 1 } };
    d = setDocumentPath(d, 'type.number', '9')!;
    d = setDocumentPath(d, 'custom.po', 'PO-1')!;
    expect(setDocumentPath(d, 'lines.total', '1')).toBeNull();
    expect(setDocumentPath(d, 'nope', 'x')).toBeNull();
    expect(d.type.number).toBe('9');
    expect(d.custom).toEqual({ a: 1, po: 'PO-1' });
  });
  it('accepts the legacy invoice keys a saved mapping still holds', () => {
    const d = setDocumentPath(blankDoc(), 'invoiceNumber', '9')!;
    expect(d.type.number).toBe('9');
    expect(setDocumentPath(blankDoc(), 'customFields.po', 'PO-1')!.custom.po).toBe('PO-1');
    expect(setDocumentPath(blankDoc(), 'items.total', '1')).toBeNull();
  });
  it('coerces a typed path by its declared type', () => {
    expect(setDocumentPath(blankDoc(), 'totals.total', '1.234,50')!.totals.total).toBe(1234.5);
  });
  it('leaves a typed path untouched when the value will not coerce', () => {
    const d = setPath(blankDoc(), 'totals.total', 5);
    expect(setDocumentPath(d, 'totals.total', 'abc')).toBeNull();
    expect(d.totals.total).toBe(5);
  });
  it('never writes through a prototype-polluting custom key', () => {
    for (const k of ['custom.__proto__', 'custom.constructor', 'custom.prototype', 'customFields.__proto__']) {
      expect(setDocumentPath(blankDoc(), k, 'x')).toBeNull();
    }
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
  it('does not mutate the document it was handed', () => {
    const d = blankDoc();
    setDocumentPath(d, 'type.number', '9');
    expect(d.type.number).toBeNull();
  });
});

describe('baseOcrSnapshot', () => {
  it('keeps exactly the cross-checked paths, keyed by path', () => {
    const d = setPath(setPath(blankDoc(), 'totals.total', 10), 'type.number', 'ΤΙΜ-1');
    expect(baseOcrSnapshot(d)).toEqual({ 'totals.total': 10, 'totals.net': null, 'totals.vatAmount': null, 'type.number': 'ΤΙΜ-1', date: null });
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
    { fieldKey: 'total', invoiceKey: 'totals.total' },
    { fieldKey: 'no', invoiceKey: 'type.number' },
    { fieldKey: 'when', invoiceKey: 'date' },
    { fieldKey: 'note', invoiceKey: 'custom.note' },
  ];

  it('names the fields where the template and the base OCR disagree', () => {
    const out = crossCheckOcr(rows, { total: v(229.4), no: v('ΤΙΜ-451'), when: v('2026-03-05'), note: v('x') },
      { 'totals.total': 22.94, 'type.number': 'ΤΙΜ-451', date: '2026-03-05', 'custom.note': 'y' }, label);
    expect(out).toEqual([{ fieldKey: 'total', reason: 'Ασυμφωνία «Σύνολο»: πρότυπο 229.4 · OCR 22.94' }]);
  });

  it('lets amounts agree within half a cent, and reads Greek amounts on the OCR side', () => {
    expect(crossCheckOcr(rows, { total: v(1234.5) }, { 'totals.total': 1234.502 }, label)).toEqual([]);
    expect(crossCheckOcr(rows, { total: v(1234.5) }, { 'totals.total': '1.234,50' }, label)).toEqual([]);
    expect(crossCheckOcr(rows, { total: v(1234.5) }, { 'totals.total': '1.234,56' }, label)).toHaveLength(1);
  });

  it('compares dates by calendar day, not by the string they were printed as', () => {
    expect(crossCheckOcr(rows, { when: v('2026-03-05') }, { date: '05/03/2026' }, label)).toEqual([]);
    expect(crossCheckOcr(rows, { when: v('2026-03-05') }, { date: '06/03/2026' }, label)).toHaveLength(1);
  });

  it('normalises whitespace and case before calling a text value a mismatch', () => {
    expect(crossCheckOcr(rows, { no: v(' ΤΙΜ  451 ') }, { 'type.number': 'ΤΙΜ 451' }, label)).toEqual([]);
  });

  it('says nothing when either side is blank, or the key is not worth checking', () => {
    expect(crossCheckOcr(rows, { total: v(null) }, { 'totals.total': 10 }, label)).toEqual([]);
    expect(crossCheckOcr(rows, { total: v(10) }, {}, label)).toEqual([]);
    expect(crossCheckOcr(rows, { note: v('a') }, { 'custom.note': 'b' }, label)).toEqual([]);
  });

  it('reads a snapshot written before the canonical paths existed', () => {
    // A run stored under the old flat keys must still find its second opinion.
    const legacy = [{ fieldKey: 'total', invoiceKey: 'totalAmount' }];
    expect(crossCheckOcr(legacy, { total: v(229.4) }, { totalAmount: 22.94 }, label))
      .toEqual([{ fieldKey: 'total', reason: 'Ασυμφωνία «Σύνολο»: πρότυπο 229.4 · OCR 22.94' }]);
    expect(crossCheckOcr(legacy, { total: v(229.4) }, { totalAmount: 229.4 }, label)).toEqual([]);
  });
});

describe('tableFellThrough', () => {
  const rows = [{ fieldKey: 'lines.desc', invoiceKey: 'lines.name' }, { fieldKey: 'total', invoiceKey: 'totals.total' }];
  const ocrLines = withLines([line({ name: 'Α' })]);

  it('names the table when it read nothing and the OCR did read lines', () => {
    expect(tableFellThrough(rows, { lines: v([]) }, ocrLines)).toBe('lines');
    expect(tableFellThrough(rows, {}, ocrLines)).toBe('lines');
    // A mapping saved with the legacy `items.*` keys still points at the lines.
    expect(tableFellThrough([{ fieldKey: 'lines.desc', invoiceKey: 'items.name' }], {}, ocrLines)).toBe('lines');
  });

  it('is null when the table read rows, when the OCR has none either, or with no line mapping', () => {
    expect(tableFellThrough(rows, { lines: v([{ name: 'Β' }]) }, ocrLines)).toBeNull();
    expect(tableFellThrough(rows, { lines: v([]) }, blankDoc())).toBeNull();
    expect(tableFellThrough([{ fieldKey: 'total', invoiceKey: 'totals.total' }], {}, ocrLines)).toBeNull();
  });
});
