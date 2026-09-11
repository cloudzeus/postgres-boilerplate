import { describe, it, expect } from 'vitest';
import { emptyDocument, setPath, type DocumentJson, type DocumentLine } from '@/lib/ocr/canonical';
import { buildSheets, sheetName, type SheetInput } from '../excel';

const fv = (value: unknown) => ({ raw: null, value, confidence: 1, source: 'vision' as const, page: 0, bbox: null, color: '#000' });
const fields = [
  { key: 'num', label: 'Αριθμός', kind: 'SINGLE' as const, columns: null },
  { key: 'lines', label: 'Γραμμές', kind: 'TABLE' as const, columns: [{ key: 'eidos', label: 'Είδος' }, { key: 'poso', label: 'Ποσό' }] },
];

const blank = (): DocumentJson => emptyDocument('invoice');
const line = (over: Partial<DocumentLine> = {}): DocumentLine =>
  ({ code: null, name: null, unit: null, quantity: null, unitPrice: null, discount: null, net: null, vatRate: null, vatAmount: null, total: null, custom: {}, ...over });

const input = (over: Partial<SheetInput> = {}): SheetInput => ({
  templateSlug: 'a', templateName: 'A', file: 'f1.pdf', fields, excelRows: null, values: {}, document: blank(), ...over,
});

/** The fixed document columns every main sheet starts with, after «Αρχείο». */
const DOC_COLS = ['Τύπος', 'Σειρά', 'Αριθμός', 'Ημερομηνία', 'Εκδότης', 'ΑΦΜ εκδότη', 'Παραλήπτης',
  'Καθαρή αξία', 'Έκπτωση', 'ΦΠΑ', 'Παρακράτηση', 'Επιβαρύνσεις', 'Σύνολο', 'Πληρωτέο', 'ΜΑΡΚ'];
const EMPTY_DOC_CELLS = DOC_COLS.map(() => '');

describe('buildSheets — the main sheet', () => {
  it('starts with the document columns, then the EXCEL mapping columns', () => {
    const doc = setPath(setPath(setPath(blank(), 'type.number', 'ΤΙΜ-451'), 'totals.total', 1240.5), 'issuer.name', 'ΑΦΟΙ Χ');
    const s = buildSheets([input({ excelRows: [{ fieldKey: 'num', column: 'No', order: 0 }], values: { num: fv('9') }, document: doc })]);
    expect(s).toHaveLength(1);
    expect(s[0].columns).toEqual(['Αρχείο', ...DOC_COLS, 'No']);
    expect(s[0].rows).toEqual([['f1.pdf', '', '', 'ΤΙΜ-451', '', 'ΑΦΟΙ Χ', '', '', '', '', '', '', '', 1240.5, '', '', '9']]);
  });

  it('amounts stay numbers — Excel has to be able to sum the column', () => {
    const doc = setPath(setPath(blank(), 'totals.net', 1000), 'totals.vatAmount', 240);
    const [main] = buildSheets([input({ document: doc })]);
    const row = main.rows[0];
    expect(row[main.columns.indexOf('Καθαρή αξία')]).toBe(1000);
    expect(row[main.columns.indexOf('ΦΠΑ')]).toBe(240);
    expect(typeof row[main.columns.indexOf('Καθαρή αξία')]).toBe('number');
  });

  it('without an EXCEL mapping: one column per SINGLE field', () => {
    const s = buildSheets([input({ values: { num: fv(9) } })]);
    expect(s[0].columns).toEqual(['Αρχείο', ...DOC_COLS, 'Αριθμός']);
    expect(s[0].rows).toEqual([['f1.pdf', ...EMPTY_DOC_CELLS, 9]]);
  });

  it('appends a column per custom key present in the group, in first-seen order', () => {
    const a = input({ document: { ...blank(), custom: { kwh: 120 } } });
    const b = input({ file: 'f2.pdf', document: { ...blank(), custom: { meter: 'M-9', kwh: 90 } } });
    const [main] = buildSheets([a, b]);
    expect(main.columns.slice(-3)).toEqual(['Αριθμός', 'kwh', 'meter']);
    expect(main.rows[0].slice(-2)).toEqual([120, '']);
    expect(main.rows[1].slice(-2)).toEqual([90, 'M-9']);
  });

  it('χωρίς EXCEL mapping, ένα SINGLE πεδίο ΔΕΝ βγαίνει και δεύτερη φορά ως custom στήλη', () => {
    // Το `projectToDocument` γράφει κάθε μη αντιστοιχισμένο SINGLE πεδίο στο `custom[fieldKey]`·
    // η στήλη «Αριθμός» και το κλειδί `num` είναι το ΙΔΙΟ πεδίο.
    const [main] = buildSheets([input({ values: { num: fv(9) }, document: { ...blank(), custom: { num: 9, kwh: 120 } } })]);
    expect(main.columns).toEqual(['Αρχείο', ...DOC_COLS, 'Αριθμός', 'kwh']);
    expect(main.rows).toEqual([['f1.pdf', ...EMPTY_DOC_CELLS, 9, 120]]);
  });

  it('με EXCEL mapping το custom κλειδί κρατιέται — οι στήλες εκεί ορίζονται από το mapping', () => {
    const [main] = buildSheets([input({
      excelRows: [{ fieldKey: 'num', column: 'No', order: 0 }],
      values: { num: fv(9) },
      document: { ...blank(), custom: { num: 9 } },
    })]);
    expect(main.columns).toEqual(['Αρχείο', ...DOC_COLS, 'No', 'num']);
  });

  it('groups documents of the same template and keeps the order', () => {
    const one = (file: string) => input({ file, fields: [fields[0]], values: { num: fv(file) } });
    expect(buildSheets([one('1'), { ...one('2'), templateSlug: 'b', templateName: 'B' }, one('3')]).map((s) => [s.name, s.rows.length]))
      .toEqual([['A', 2], ['B', 1]]);
  });

  it('no inputs at all → no sheets', () => {
    expect(buildSheets([])).toEqual([]);
  });

  it('a string array joins into one cell, a plain object does not belong in a cell', () => {
    const s = buildSheets([input({ values: { num: fv(['α', 'β']) } }), input({ file: 'f2.pdf', values: { num: fv({ a: 1 }) } })]);
    expect(s[0].rows.map((r) => r.at(-1))).toEqual(['α, β', '']);
  });

  it('a template with no SINGLE fields still gets the document columns', () => {
    const s = buildSheets([input({ fields: [fields[1]] })]);
    expect(s).toEqual([{ name: 'A', columns: ['Αρχείο', ...DOC_COLS], rows: [['f1.pdf', ...EMPTY_DOC_CELLS]] }]);
  });
});

describe('buildSheets — the lines and VAT sheets', () => {
  const withLines = (lines: DocumentLine[]) => input({ document: { ...blank(), lines } });

  it('reads the lines from the canonical document, numbered, numbers kept as numbers', () => {
    const s = buildSheets([withLines([
      line({ code: 'A1', name: 'Είδος Α', unit: 'τεμ', quantity: 2, unitPrice: 10, net: 20, vatRate: 24, vatAmount: 4.8, total: 24.8 }),
      line({ code: 'B2', name: 'Είδος Β' }),
    ])]);
    expect(s[1].name).toBe('A — Γραμμές');
    expect(s[1].columns).toEqual(['Αρχείο', 'Α/Α', 'Κωδικός', 'Περιγραφή', 'Μονάδα', 'Ποσότητα', 'Τιμή μονάδας', 'Έκπτωση', 'Καθαρή αξία', 'ΦΠΑ %', 'ΦΠΑ', 'Σύνολο']);
    expect(s[1].rows).toEqual([
      ['f1.pdf', 1, 'A1', 'Είδος Α', 'τεμ', 2, 10, '', 20, 24, 4.8, 24.8],
      ['f1.pdf', 2, 'B2', 'Είδος Β', '', '', '', '', '', '', '', ''],
    ]);
  });

  it('appends the custom columns the lines of the group carry', () => {
    const s = buildSheets([withLines([line({ code: 'A1', custom: { kwh: 120 } }), line({ code: 'B2', custom: { meter: 'M-9' } })])]);
    expect(s[1].columns.slice(-2)).toEqual(['kwh', 'meter']);
    expect(s[1].rows.map((r) => r.slice(-2))).toEqual([[120, ''], ['', 'M-9']]);
  });

  it('no lines anywhere in the group → no lines sheet', () => {
    expect(buildSheets([input()]).map((s) => s.name)).toEqual(['A']);
  });

  it('a VAT breakdown becomes its own sheet, one row per rate per document', () => {
    const doc = { ...blank(), vatBreakdown: [{ rate: 24, net: 1000, vat: 240 }, { rate: 13, net: 100, vat: 13 }] };
    const s = buildSheets([input({ document: doc })]);
    expect(s.at(-1)).toEqual({
      name: 'A — ΦΠΑ',
      columns: ['Αρχείο', 'Συντελεστής', 'Καθαρή αξία', 'ΦΠΑ'],
      rows: [['f1.pdf', 24, 1000, 240], ['f1.pdf', 13, 100, 13]],
    });
  });

  it('a name already at the 31-char cap still gets distinct lines and VAT sheets', () => {
    const name = 'Π'.repeat(31);
    const doc = { ...blank(), lines: [line({ code: 'A1' })], vatBreakdown: [{ rate: 24, net: 1, vat: 0.24 }] };
    const s = buildSheets([input({ templateName: name, document: doc })]);
    expect(s.map((x) => x.name)).toEqual([name, 'Π'.repeat(21) + ' — Γραμμές', 'Π'.repeat(25) + ' — ΦΠΑ']);
    expect(new Set(s.map((x) => x.name)).size).toBe(3);
    for (const x of s) expect(x.name.length).toBeLessThanOrEqual(31);
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
