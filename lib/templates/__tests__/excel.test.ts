import { describe, it, expect } from 'vitest';
import { buildSheets, sheetName } from '../excel';
const fv = (value: unknown) => ({ raw: null, value, confidence: 1, source: 'vision' as const, page: 0, bbox: null, color: '#000' });
const fields = [{ key: 'num', label: 'Αριθμός', kind: 'SINGLE' as const, columns: null }, { key: 'lines', label: 'Γραμμές', kind: 'TABLE' as const, columns: [{ key: 'eidos', label: 'Είδος' }, { key: 'poso', label: 'Ποσό' }] }];
describe('buildSheets', () => {
  it('one sheet per template, columns from the EXCEL mapping when present', () => {
    const s = buildSheets([{ templateSlug: 'a', templateName: 'A', file: 'f1.pdf', fields, excelRows: [{ fieldKey: 'num', column: 'No', order: 0 }], values: { num: fv('9') } }]);
    expect(s).toEqual([{ name: 'A', columns: ['Αρχείο', 'No'], rows: [['f1.pdf', '9']] }]);
  });
  it('without a mapping: one column per SINGLE field, TABLE fields go to a lines sheet', () => {
    const s = buildSheets([{ templateSlug: 'a', templateName: 'A', file: 'f1.pdf', fields, excelRows: null, values: { num: fv(9), lines: fv([{ eidos: 'x', poso: 1 }, { eidos: 'y', poso: 2 }]) } }]);
    expect(s[0]).toEqual({ name: 'A', columns: ['Αρχείο', 'Αριθμός'], rows: [['f1.pdf', 9]] });
    expect(s[1]).toEqual({ name: 'A — Γραμμές', columns: ['Αρχείο', 'Πεδίο', 'Είδος', 'Ποσό'], rows: [['f1.pdf', 'Γραμμές', 'x', 1], ['f1.pdf', 'Γραμμές', 'y', 2]] });
  });
  it('groups documents of the same template and keeps the order', () => {
    const one = (file: string) => ({ templateSlug: 'a', templateName: 'A', file, fields: [fields[0]], excelRows: null, values: { num: fv(file) } });
    expect(buildSheets([one('1'), { ...one('2'), templateSlug: 'b', templateName: 'B' }, one('3')]).map((s) => [s.name, s.rows.length])).toEqual([['A', 2], ['B', 1]]);
  });
});
describe('buildSheets — cells and edge cases', () => {
  const one = (over: Record<string, unknown>) => ({ templateSlug: 'a', templateName: 'A', file: 'f1.pdf', fields, excelRows: null, values: {}, ...over });

  it('no inputs at all → no sheets', () => {
    expect(buildSheets([])).toEqual([]);
  });

  it('a string array joins into one cell, a plain object does not belong in a cell', () => {
    const s = buildSheets([one({ values: { num: fv(['α', 'β']) } }), { ...one({ values: { num: fv({ a: 1 }) } }), file: 'f2.pdf' }]);
    expect(s[0].rows).toEqual([['f1.pdf', 'α, β'], ['f2.pdf', '']]);
  });

  it('a template with no SINGLE fields still gets a main sheet — the file column alone', () => {
    const s = buildSheets([one({ fields: [fields[1]], values: {} })]);
    expect(s).toEqual([{ name: 'A', columns: ['Αρχείο'], rows: [['f1.pdf']] }]);
  });

  it('the lines sheet unions the columns of every TABLE field that produced rows', () => {
    const two = [
      { key: 't1', label: 'Π1', kind: 'TABLE' as const, columns: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }] },
      { key: 't2', label: 'Π2', kind: 'TABLE' as const, columns: [{ key: 'b', label: 'B' }, { key: 'c', label: 'C' }] },
    ];
    const s = buildSheets([one({ fields: two, values: { t1: fv([{ a: 1, b: 2 }]), t2: fv([{ b: 3, c: 4 }]) } })]);
    expect(s[1].columns).toEqual(['Αρχείο', 'Πεδίο', 'A', 'B', 'C']);
    // A column the row's own table does not have stays empty rather than shifting the row.
    expect(s[1].rows).toEqual([['f1.pdf', 'Π1', 1, 2, ''], ['f1.pdf', 'Π2', '', 3, 4]]);
  });

  it('a name already at the 31-char cap still gets a distinct lines sheet', () => {
    const name = 'Π'.repeat(31);
    const s = buildSheets([one({ templateName: name, values: { lines: fv([{ eidos: 'x', poso: 1 }]) } })]);
    expect(s[0].name).toBe(name);
    expect(s[1].name).toBe('Π'.repeat(21) + ' — Γραμμές');
    expect(s[1].name).toHaveLength(31);
    expect(s[1].name).not.toBe(s[0].name);
  });
});

describe('sheetName', () => {
  it('strips forbidden characters and caps at 31, deduping', () => {
    expect(sheetName('A/B:C*D?[E]', new Set())).toBe('A-B-C-D-E');
    expect(sheetName('x'.repeat(40), new Set(['x'.repeat(31)]))).toMatch(/^x{29}_2$/);
  });
  it('a name made only of forbidden characters falls back to «Φύλλο»', () => {
    expect(sheetName('[]:*?/\\', new Set())).toBe('Φύλλο');
  });
});
