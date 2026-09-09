import { describe, it, expect } from 'vitest';
import { projectToInvoice, projectToExcel } from '../mapping';
import type { FieldValue } from '../schema';

const fv = (value: FieldValue['value']): FieldValue =>
  ({ raw: null, value, confidence: null, source: 'vision', page: 0, bbox: null, color: '#000000' });

describe('projectToInvoice', () => {
  it('writes header keys, customFields and nested items columns, deep-merging into existing data', () => {
    const values = {
      no: fv('ΤΙΜ-451'),
      order: fv('PO-77'),
      lines: fv([{ code: 'A1', qty: 2, price: 10 }, { code: 'B2', qty: 1, price: 5.5 }]),
    };
    const rows = [
      { fieldKey: 'no', invoiceKey: 'invoiceNumber' },
      { fieldKey: 'order', invoiceKey: 'customFields.order_no' },
      { fieldKey: 'lines.code', invoiceKey: 'items.code' },
      { fieldKey: 'lines.qty', invoiceKey: 'items.quantity' },
      { fieldKey: 'lines.price', invoiceKey: 'items.price' },
    ];
    const existing = { vatNumber: '123456789', customFields: { keep: 'me' }, items: [{ name: 'old' }] };
    const out = projectToInvoice(values, rows, existing);
    expect(out.vatNumber).toBe('123456789');
    expect(out.invoiceNumber).toBe('ΤΙΜ-451');
    expect(out.customFields).toEqual({ keep: 'me', order_no: 'PO-77' });
    expect(out.items).toEqual([{ code: 'A1', quantity: 2, price: 10 }, { code: 'B2', quantity: 1, price: 5.5 }]);
  });
  it('skips null values and unknown invoice keys, keeps existing items when no line mapping', () => {
    const out = projectToInvoice({ x: fv(null), y: fv('v') }, [{ fieldKey: 'x', invoiceKey: 'invoiceNumber' }, { fieldKey: 'y', invoiceKey: 'nope' }], { items: [{ name: 'old' }] });
    expect(out).toEqual({ items: [{ name: 'old' }] });
  });
  it('ignores a non-object existing customFields', () => {
    const out = projectToInvoice({ o: fv('X') }, [{ fieldKey: 'o', invoiceKey: 'customFields.order_no' }], { customFields: 'junk' });
    expect(out.customFields).toEqual({ order_no: 'X' });
  });
  it('keeps existing items when the mapped table value is missing', () => {
    const out = projectToInvoice({}, [{ fieldKey: 'lines.code', invoiceKey: 'items.code' }], { items: [{ name: 'old' }] });
    expect(out.items).toEqual([{ name: 'old' }]);
  });
  it('does not mutate the input object', () => {
    const existing = { a: 1 };
    projectToInvoice({ n: fv('x') }, [{ fieldKey: 'n', invoiceKey: 'aadeMark' }], existing);
    expect(existing).toEqual({ a: 1 });
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
