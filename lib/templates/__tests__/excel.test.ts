import { describe, it, expect } from 'vitest';
import { buildSheets, sheetName } from '../excel';
const fv = (value: unknown) => ({ raw: null, value, confidence: 1, source: 'vision' as const, page: 0, bbox: null, color: '#000' });
const fields = [{ key: 'num', label: 'Αριθμός', kind: 'SINGLE' as const, columns: null }, { key: 'lines', label: 'Γραμμές', kind: 'TABLE' as const, columns: [{ key: 'eidos', label: 'Είδος' }, { key: 'poso', label: 'Ποσό' }] }];
describe('buildSheets', () => {
  it('one sheet per template, columns from the EXCEL mapping when present', () => {
    const s = buildSheets([{ templateSlug: 'a', templateName: 'A', file: 'f1.pdf', documentId: 'd1', fields, excelRows: [{ fieldKey: 'num', column: 'No', order: 0 }], values: { num: fv('9') } }]);
    expect(s).toEqual([{ name: 'A', columns: ['Αρχείο', 'No'], rows: [['f1.pdf', '9']] }]);
  });
  it('without a mapping: one column per SINGLE field, TABLE fields go to a lines sheet', () => {
    const s = buildSheets([{ templateSlug: 'a', templateName: 'A', file: 'f1.pdf', documentId: 'd1', fields, excelRows: null, values: { num: fv(9), lines: fv([{ eidos: 'x', poso: 1 }, { eidos: 'y', poso: 2 }]) } }]);
    expect(s[0]).toEqual({ name: 'A', columns: ['Αρχείο', 'Αριθμός'], rows: [['f1.pdf', 9]] });
    expect(s[1]).toEqual({ name: 'A — Γραμμές', columns: ['Αρχείο', 'Πεδίο', 'Είδος', 'Ποσό'], rows: [['f1.pdf', 'Γραμμές', 'x', 1], ['f1.pdf', 'Γραμμές', 'y', 2]] });
  });
  it('groups documents of the same template and keeps the order', () => {
    const one = (file: string) => ({ templateSlug: 'a', templateName: 'A', file, documentId: file, fields: [fields[0]], excelRows: null, values: { num: fv(file) } });
    expect(buildSheets([one('1'), { ...one('2'), templateSlug: 'b', templateName: 'B' }, one('3')]).map((s) => [s.name, s.rows.length])).toEqual([['A', 2], ['B', 1]]);
  });
});
describe('sheetName', () => {
  it('strips forbidden characters and caps at 31, deduping', () => {
    expect(sheetName('A/B:C*D?[E]', new Set())).toBe('A-B-C-D-E');
    expect(sheetName('x'.repeat(40), new Set(['x'.repeat(31)]))).toMatch(/^x{29}_2$/);
  });
});
