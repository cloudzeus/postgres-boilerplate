import { describe, it, expect } from 'vitest';
import { emptyDocument, type DocumentJson } from '@/lib/ocr/canonical';
import { projectToDocument, projectToExcel } from '../mapping';
import type { FieldDef, FieldValue } from '../schema';

const fv = (value: FieldValue['value']): FieldValue =>
  ({ raw: null, value, confidence: null, source: 'vision', page: 0, bbox: null, color: '#000000' });

const doc = (over: Partial<DocumentJson> = {}): DocumentJson => ({ ...emptyDocument('invoice'), ...over });

const field = (key: string, kind: FieldDef['kind'] = 'SINGLE'): FieldDef =>
  ({ key, label: key, kind, valueType: 'TEXT', color: '#000', region: null, columns: null, aiHint: null, required: false, order: 0 });

describe('projectToDocument', () => {
  it('writes header paths, custom keys and rebuilds the lines from the mapped table', () => {
    const values = {
      no: fv('ΤΙΜ-451'),
      order: fv('PO-77'),
      lines: fv([{ code: 'A1', qty: 2, price: 10 }, { code: 'B2', qty: 1, price: 5.5 }]),
    };
    const rows = [
      { fieldKey: 'no', invoiceKey: 'type.number' },
      { fieldKey: 'order', invoiceKey: 'custom.order_no' },
      { fieldKey: 'lines.code', invoiceKey: 'lines.code' },
      { fieldKey: 'lines.qty', invoiceKey: 'lines.quantity' },
      { fieldKey: 'lines.price', invoiceKey: 'lines.unitPrice' },
    ];
    const existing = doc({ issuer: { ...emptyDocument('invoice').issuer, vat: '123456789' }, custom: { keep: 'me' } });
    const out = projectToDocument(values, rows, existing);
    expect(out.issuer.vat).toBe('123456789');
    expect(out.type.number).toBe('ΤΙΜ-451');
    expect(out.custom).toEqual({ keep: 'me', order_no: 'PO-77' });
    expect(out.lines.map((l) => [l.code, l.quantity, l.unitPrice])).toEqual([['A1', 2, 10], ['B2', 1, 5.5]]);
    // Every line is a complete canonical line, not a sparse object.
    expect(out.lines[0].net).toBeNull();
    expect(out.lines[0].custom).toEqual({});
  });

  it('accepts a mapping saved with legacy invoice keys and writes the canonical path', () => {
    const out = projectToDocument(
      { t: fv(229.4), o: fv('PO-1'), lines: fv([{ p: 3 }]) },
      [
        { fieldKey: 't', invoiceKey: 'totalAmount' },
        { fieldKey: 'o', invoiceKey: 'customFields.order_no' },
        { fieldKey: 'lines.p', invoiceKey: 'items.price' },
      ],
      doc(),
    );
    expect(out.totals.total).toBe(229.4);
    expect(out.custom.order_no).toBe('PO-1');
    expect(out.lines[0].unitPrice).toBe(3);
  });

  it('a blank template value never overwrites a value the base OCR already read', () => {
    // The region missed the total on THIS document — that is not evidence the invoice has none.
    const existing = doc({ totals: { ...emptyDocument('invoice').totals, total: 229.4 }, type: { label: null, series: null, number: 'ΤΙΜ-451', myDataType: null } });
    const out = projectToDocument(
      { t: fv(null), n: fv('   ') },
      [{ fieldKey: 't', invoiceKey: 'totals.total' }, { fieldKey: 'n', invoiceKey: 'type.number' }],
      existing,
    );
    expect(out.totals.total).toBe(229.4);
    expect(out.type.number).toBe('ΤΙΜ-451');
  });

  it('skips unknown keys and keeps the existing lines when no line mapping ran', () => {
    const existing = doc({ lines: [{ code: null, name: 'old', unit: null, quantity: null, unitPrice: null, discount: null, net: null, vatRate: null, vatAmount: null, total: null, custom: {} }] });
    const out = projectToDocument({ x: fv(null), y: fv('v') }, [{ fieldKey: 'x', invoiceKey: 'type.number' }, { fieldKey: 'y', invoiceKey: 'nope' }], existing);
    expect(out).toBe(existing);
    // Same array reference → the caller knows the OcrInvoiceItem rows need not be rebuilt.
    expect(out.lines).toBe(existing.lines);
  });

  it('keeps the existing lines when the mapped table value is missing', () => {
    const existing = doc({ lines: [{ code: 'A', name: 'old', unit: null, quantity: null, unitPrice: null, discount: null, net: null, vatRate: null, vatAmount: null, total: null, custom: {} }] });
    const out = projectToDocument({}, [{ fieldKey: 'lines.code', invoiceKey: 'lines.code' }], existing);
    expect(out.lines).toBe(existing.lines);
  });

  it('keeps the table columns nobody mapped in the line custom bag', () => {
    const out = projectToDocument(
      { lines: fv([{ code: 'A1', kwh: 120, meter: 'M-9' }]) },
      [{ fieldKey: 'lines.code', invoiceKey: 'lines.code' }],
      doc(),
    );
    expect(out.lines[0].code).toBe('A1');
    expect(out.lines[0].custom).toEqual({ kwh: 120, meter: 'M-9' });
  });

  it('every unmapped SINGLE field lands in custom — nothing the template read is lost', () => {
    const out = projectToDocument(
      { no: fv('ΤΙΜ-1'), kwh: fv(120), empty: fv(null), lines: fv([{ a: 1 }]) },
      [{ fieldKey: 'no', invoiceKey: 'type.number' }],
      doc(),
      [field('no'), field('kwh'), field('empty'), field('lines', 'TABLE')],
    );
    expect(out.type.number).toBe('ΤΙΜ-1');
    expect(out.custom).toEqual({ kwh: 120, empty: null });
  });

  it('a SINGLE field the mapping consumed is not duplicated into custom', () => {
    const out = projectToDocument({ no: fv('ΤΙΜ-1') }, [{ fieldKey: 'no', invoiceKey: 'type.number' }], doc(), [field('no')]);
    expect(out.custom).toEqual({});
  });

  it('does not mutate the input document', () => {
    const existing = doc();
    projectToDocument({ n: fv('x') }, [{ fieldKey: 'n', invoiceKey: 'digital.mark' }], existing);
    expect(existing.digital.mark).toBeNull();
  });
});

describe('projectToExcel', () => {
  it('orders columns and stringifies values; lists join with ", "', () => {
    const values = { no: fv('ΤΙΜ-451'), total: fv(1240.5), serials: fv(['A', 'B']), miss: fv(null) };
    const rows = [
      { fieldKey: 'total', column: 'Σύνολο', order: 2 },
      { fieldKey: 'no', column: 'Αριθμός', order: 1 },
      { fieldKey: 'serials', column: 'Serials', order: 3 },
      { fieldKey: 'miss', column: 'Κενό', order: 4 },
    ];
    expect(projectToExcel(values, rows)).toEqual({
      columns: ['Αριθμός', 'Σύνολο', 'Serials', 'Κενό'],
      row: ['ΤΙΜ-451', 1240.5, 'A, B', ''],
    });
  });
  it('projectToExcel renders TABLE values as empty cells', () => {
    expect(projectToExcel({ t: fv([{ a: 1 }]) }, [{ fieldKey: 't', column: 'T', order: 1 }])).toEqual({ columns: ['T'], row: [''] });
  });
});
