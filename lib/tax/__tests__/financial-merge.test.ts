import { describe, it, expect } from 'vitest';
import { buildFinancialUpserts } from '../financial-merge';

const fields = [
  { fieldKey: '500', valueType: 'CURRENCY' as const },
  { fieldKey: '581', valueType: 'CURRENCY' as const },
  { fieldKey: '999', valueType: 'CURRENCY' as const },
];

describe('buildFinancialUpserts', () => {
  it('builds rows with the composite key and OCR/MANUAL source', () => {
    const rows = buildFinancialUpserts({
      companyId: 'c1', templateId: 't1', templateCode: 'E3', year: 2024,
      sourceDocumentId: 'doc1', fields,
      reviewed: { '500': { raw: '1.556.540,27', edited: false }, '581': { raw: '300.000,00', edited: true } },
    });
    expect(rows).toEqual([
      { companyId: 'c1', fieldKey: 'E3.500', templateId: 't1', year: 2024, value: 1556540.27, valueType: 'CURRENCY', source: 'OCR', sourceDocumentId: 'doc1', verified: true },
      { companyId: 'c1', fieldKey: 'E3.581', templateId: 't1', year: 2024, value: 300000, valueType: 'CURRENCY', source: 'MANUAL', sourceDocumentId: 'doc1', verified: true },
    ]);
  });
  it('skips fields with no parseable value', () => {
    const rows = buildFinancialUpserts({
      companyId: 'c1', templateId: 't1', templateCode: 'E3', year: 2024, sourceDocumentId: null, fields,
      reviewed: { '999': { raw: '', edited: false } },
    });
    expect(rows).toEqual([]);
  });
});
