import { describe, it, expect } from 'vitest';
import { latestPerDocument, runsToSheetInputs, type RunForExport } from '../excel-server';

/** Only the columns the exporter reads are filled in; the rest of the Prisma row is irrelevant here. */
const run = (over: {
  id: string;
  documentId: string;
  mappings?: unknown[];
  fields?: unknown[];
  values?: Record<string, unknown>;
}) =>
  ({
    id: over.id,
    documentId: over.documentId,
    values: over.values ?? {},
    template: {
      slug: 'a', name: 'A',
      fields: over.fields ?? [{ key: 'num', label: 'Αριθμός', kind: 'SINGLE', valueType: 'TEXT', color: '#000', region: null, columns: null, aiHint: null, required: false, order: 0 }],
      mappings: over.mappings ?? [],
    },
    document: { id: over.documentId, fileName: `${over.documentId}.pdf` },
  }) as unknown as RunForExport;

const mapping = (over: Record<string, unknown>) => ({ id: 'm', name: 'default', target: 'EXCEL', isDefault: false, rows: [], ...over });

describe('latestPerDocument', () => {
  it('keeps only the first (newest) run of a document', () => {
    const rows = [run({ id: 'r2', documentId: 'd1' }), run({ id: 'r1', documentId: 'd1' })];
    expect(latestPerDocument(rows).map((r) => r.id)).toEqual(['r2']);
  });

  it('keeps one run per document when the documents are interleaved, in first-seen order', () => {
    const rows = [
      run({ id: 'b2', documentId: 'd2' }),
      run({ id: 'a2', documentId: 'd1' }),
      run({ id: 'b1', documentId: 'd2' }),
      run({ id: 'c1', documentId: 'd3' }),
      run({ id: 'a1', documentId: 'd1' }),
    ];
    expect(latestPerDocument(rows).map((r) => r.id)).toEqual(['b2', 'a2', 'c1']);
  });

  it('is a no-op on an empty list', () => {
    expect(latestPerDocument([])).toEqual([]);
  });
});

describe('runsToSheetInputs', () => {
  it('picks the default EXCEL mapping over an earlier non-default one', () => {
    const [input] = runsToSheetInputs([
      run({
        id: 'r1', documentId: 'd1',
        mappings: [
          mapping({ id: 'm1', name: 'παλιό', rows: [{ fieldKey: 'num', column: 'Παλιό', order: 0 }] }),
          mapping({ id: 'm2', name: 'κανονικό', isDefault: true, rows: [{ fieldKey: 'num', column: 'Νέο', order: 0 }] }),
        ],
      }),
    ]);
    expect(input.excelRows).toEqual([{ fieldKey: 'num', column: 'Νέο', order: 0 }]);
  });

  it('falls back to the first EXCEL mapping when none is default, and ignores INVOICE mappings', () => {
    const [input] = runsToSheetInputs([
      run({
        id: 'r1', documentId: 'd1',
        mappings: [
          mapping({ id: 'm0', name: 'παραστατικό', target: 'INVOICE', isDefault: true, rows: [{ fieldKey: 'num', invoiceKey: 'totalAmount' }] }),
          mapping({ id: 'm1', name: 'πρώτο', rows: [{ fieldKey: 'num', column: 'Πρώτο', order: 0 }] }),
          mapping({ id: 'm2', name: 'δεύτερο', rows: [{ fieldKey: 'num', column: 'Δεύτερο', order: 0 }] }),
        ],
      }),
    ]);
    expect(input.excelRows).toEqual([{ fieldKey: 'num', column: 'Πρώτο', order: 0 }]);
  });

  it('an EXCEL mapping with no rows is the same as having none — a column per SINGLE field', () => {
    const [input] = runsToSheetInputs([run({ id: 'r1', documentId: 'd1', mappings: [mapping({ isDefault: true, rows: [] })] })]);
    expect(input.excelRows).toBeNull();
    expect(input.fields.map((f) => f.label)).toEqual(['Αριθμός']);
    expect(input.file).toBe('d1.pdf');
  });

  it('sorts the fields by their order and carries the run values through', () => {
    const f = (key: string, order: number) => ({ key, label: key.toUpperCase(), kind: 'SINGLE', valueType: 'TEXT', color: '#000', region: null, columns: null, aiHint: null, required: false, order });
    const [input] = runsToSheetInputs([run({ id: 'r1', documentId: 'd1', fields: [f('b', 1), f('a', 0)], values: { a: { value: 1 } } })]);
    expect(input.fields.map((x) => x.key)).toEqual(['a', 'b']);
    expect(input.values.a.value).toBe(1);
  });
});
