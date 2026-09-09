import { describe, it, expect } from 'vitest';
import { FieldsBody, MappingsBody, ConditionsBody } from '../validate';

describe('FieldsBody', () => {
  it('accepts fields, auto-derives key from label when missing, rejects duplicate keys', () => {
    const ok = FieldsBody.safeParse({ fields: [{ label: 'Αριθμός', color: '#0078D4' }, { key: 'x', label: 'X', color: '#047857', kind: 'TABLE', columns: [{ key: 'c', label: 'C', valueType: 'TEXT' }] }] });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.fields[0].key).toBe('arithmos');
    const dup = FieldsBody.safeParse({ fields: [{ key: 'a', label: 'A', color: '#0078D4' }, { key: 'a', label: 'B', color: '#047857' }] });
    expect(dup.success).toBe(false);
  });
  it('rejects invalid bbox and non-hex colour', () => {
    expect(FieldsBody.safeParse({ fields: [{ key: 'a', label: 'A', color: 'red' }] }).success).toBe(false);
    expect(FieldsBody.safeParse({ fields: [{ key: 'a', label: 'A', color: '#0078D4', region: { page: 0, bbox: [0, 0, 2, 1] } }] }).success).toBe(false);
  });
  it('rejects a TABLE field with no columns', () => {
    expect(FieldsBody.safeParse({ fields: [{ key: 'lines', label: 'Γραμμές', color: '#0078D4', kind: 'TABLE' }] }).success).toBe(false);
    expect(FieldsBody.safeParse({ fields: [{ key: 'lines', label: 'Γραμμές', color: '#0078D4', kind: 'TABLE', columns: [] }] }).success).toBe(false);
  });
  it('rejects a table column key that is not a slug', () => {
    const table = (key: string) => ({ fields: [{ key: 'lines', label: 'Γραμμές', color: '#0078D4', kind: 'TABLE', columns: [{ key, label: 'Ποσότητα', valueType: 'NUMBER' }] }] });
    const bad = FieldsBody.safeParse(table('Qty.1'));
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues.some((i) => i.message === 'Κλειδί στήλης: μόνο a-z, 0-9, _')).toBe(true);
    expect(FieldsBody.safeParse(table('qty_1')).success).toBe(true);
  });
  it('rejects two fields sharing a colour regardless of case', () => {
    const dup = FieldsBody.safeParse({ fields: [{ key: 'a', label: 'A', color: '#0078D4' }, { key: 'b', label: 'B', color: '#0078d4' }] });
    expect(dup.success).toBe(false);
    if (!dup.success) expect(dup.error.issues.some((i) => i.message === 'Διπλό χρώμα πεδίου')).toBe(true);
  });
});

describe('MappingsBody', () => {
  it('validates INVOICE rows against the invoice schema and EXCEL rows shape', () => {
    expect(MappingsBody.safeParse({ mappings: [{ name: 'default', target: 'INVOICE', isDefault: true, rows: [{ fieldKey: 'no', invoiceKey: 'invoiceNumber' }] }] }).success).toBe(true);
    expect(MappingsBody.safeParse({ mappings: [{ name: 'default', target: 'INVOICE', isDefault: true, rows: [{ fieldKey: 'no', invoiceKey: 'bogus' }] }] }).success).toBe(false);
    expect(MappingsBody.safeParse({ mappings: [{ name: 'x', target: 'EXCEL', isDefault: false, rows: [{ fieldKey: 'no', column: 'A', order: 1 }] }] }).success).toBe(true);
  });
  it('requires unique mapping names', () => {
    expect(MappingsBody.safeParse({ mappings: [{ name: 'a', target: 'EXCEL', isDefault: true, rows: [] }, { name: 'a', target: 'EXCEL', isDefault: false, rows: [] }] }).success).toBe(false);
  });
});

describe('ConditionsBody', () => {
  it('validates clauses and typed actions', () => {
    const ok = ConditionsBody.safeParse({ conditions: [{ name: 'R', order: 0, isActive: true, logic: 'AND', clauses: [{ fieldKey: 'total', op: 'gt', value: '1000' }], actions: [{ type: 'FLAG_REVIEW', params: { reason: 'x' } }, { type: 'SWITCH_MAPPING', params: { mappingName: 'credit' } }] }] });
    expect(ok.success).toBe(true);
    expect(ConditionsBody.safeParse({ conditions: [{ name: 'R', order: 0, isActive: true, logic: 'AND', clauses: [], actions: [{ type: 'NOPE', params: {} }] }] }).success).toBe(false);
  });
});
