import { describe, it, expect } from 'vitest';
import { emptyDocument, setPath } from '@/lib/ocr/canonical';
import { documentOf, documentsToSheetInputs, latestPerDocument, runsToSheetInputs, type DocumentForExport, type RunForExport } from '../excel-server';

/** Only the columns the exporter reads are filled in; the rest of the Prisma row is irrelevant here. */
const run = (over: {
  id: string;
  documentId: string;
  mappings?: unknown[];
  fields?: unknown[];
  values?: Record<string, unknown>;
  output?: unknown;
  document?: Partial<DocumentForExport>;
}) =>
  ({
    id: over.id,
    documentId: over.documentId,
    values: over.values ?? {},
    output: over.output ?? null,
    template: {
      slug: 'a', name: 'A',
      fields: over.fields ?? [{ key: 'num', label: 'Αριθμός', kind: 'SINGLE', valueType: 'TEXT', color: '#000', region: null, columns: null, aiHint: null, required: false, order: 0 }],
      mappings: over.mappings ?? [],
    },
    document: { id: over.documentId, fileName: `${over.documentId}.pdf`, document: null, extractedData: null, docType: 'INVOICE', items: [], ...over.document },
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

describe('documentOf', () => {
  it('reads the canonical column when it is there', () => {
    const doc = setPath(emptyDocument('invoice'), 'totals.total', 229.4);
    expect(documentOf({ id: 'd1', fileName: 'a.pdf', document: doc, extractedData: null, docType: 'INVOICE', items: [] }).totals.total).toBe(229.4);
  });

  it('bridges a row written before the canonical column existed, lines included', () => {
    const out = documentOf({
      id: 'd1', fileName: 'a.pdf', document: null, docType: 'INVOICE',
      extractedData: { companyName: 'ΑΦΟΙ Χ', totalAmount: 229.4, invoiceNumber: 'ΤΙΜ-1' },
      items: [{ code: 'A1', name: 'Α', quantity: 2, price: 10, discount: null, vatRate: 24, total: 20 }],
    });
    expect(out.issuer.name).toBe('ΑΦΟΙ Χ');
    expect(out.totals.total).toBe(229.4);
    expect(out.type.number).toBe('ΤΙΜ-1');
    expect(out.lines).toMatchObject([{ code: 'A1', name: 'Α', quantity: 2, unitPrice: 10, net: 20, vatRate: 24 }]);
  });

  it('a document with nothing read at all is still a valid empty document', () => {
    expect(documentOf({ id: 'd', fileName: 'f', document: null, extractedData: null, docType: 'GENERAL_TEXT', items: [] }).kind).toBe('general');
  });
});

describe('runsToSheetInputs — the document', () => {
  it('prefers the envelope the run froze over the live document', () => {
    const frozen = setPath(emptyDocument('invoice'), 'totals.total', 100);
    const [input] = runsToSheetInputs([run({
      id: 'r1', documentId: 'd1',
      output: { template: 'a', version: 3, extractedAt: '', file: 'd1.pdf', documentId: 'd1', document: frozen },
      document: { extractedData: { totalAmount: 999 } },
    })]);
    expect(input.document.totals.total).toBe(100);
  });

  it('falls back to the live document for a run written before the envelope existed', () => {
    const [input] = runsToSheetInputs([run({ id: 'r1', documentId: 'd1', document: { extractedData: { totalAmount: 999 } } })]);
    expect(input.document.totals.total).toBe(999);
  });
});

describe('documentsToSheetInputs', () => {
  it('puts every template-less document in one «Έγγραφα» group with no template columns', () => {
    const docs: DocumentForExport[] = [
      { id: 'd1', fileName: 'a.pdf', document: null, extractedData: { totalAmount: 10 }, docType: 'INVOICE', items: [] },
      { id: 'd2', fileName: 'b.pdf', document: null, extractedData: { totalAmount: 20 }, docType: 'INVOICE', items: [] },
    ];
    const inputs = documentsToSheetInputs(docs);
    expect(inputs.map((i) => [i.templateSlug, i.templateName, i.file])).toEqual([
      ['_document', 'Έγγραφα', 'a.pdf'], ['_document', 'Έγγραφα', 'b.pdf'],
    ]);
    expect(inputs[0].fields).toEqual([]);
    expect(inputs[0].excelRows).toBeNull();
    expect(inputs[1].document.totals.total).toBe(20);
  });
});
