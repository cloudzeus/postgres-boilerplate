import { describe, it, expect } from 'vitest';
import { buildFinancialWrites } from '../financial-merge';

const base = { companyId: 'c1', templateId: 't1', templateCode: 'E3', fiscalYear: 2024 };

describe('buildFinancialWrites', () => {
  it('SINGLE → one row keyed {code}.{fieldKey} at fiscalYear', () => {
    const rows = buildFinancialWrites({ ...base, fields: [
      { kind: 'SINGLE', fieldKey: '047', valueType: 'CURRENCY', raw: '1.750.828,53', edited: false },
    ] });
    expect(rows).toEqual([{
      companyId: 'c1', fieldKey: 'E3.047', templateId: 't1', year: 2024,
      kind: 'SINGLE', valueType: 'CURRENCY', value: 1750828.53, valueText: null, valueJson: null, source: 'OCR',
    }]);
  });

  it('SINGLE DATE → stored as valueText, value null', () => {
    const rows = buildFinancialWrites({ ...base, fields: [
      { kind: 'SINGLE', fieldKey: 'd', valueType: 'DATE', raw: '31/12/2024', edited: true },
    ] });
    expect(rows[0]).toMatchObject({ kind: 'SINGLE', valueText: '31/12/2024', value: null, source: 'MANUAL' });
  });

  it('SERIES → one row per year, skips null years/values', () => {
    const rows = buildFinancialWrites({ ...base, fields: [
      { kind: 'SERIES', fieldKey: '500', valueType: 'CURRENCY', edited: false, series: [
        { year: 2016, raw: '1.399.428,00' }, { year: 2017, raw: '1.534.997,25' }, { year: null, raw: '5' }, { year: 2018, raw: '' },
      ] },
    ] });
    expect(rows.map((r) => [r.fieldKey, r.year, r.value])).toEqual([
      ['E3.500', 2016, 1399428], ['E3.500', 2017, 1534997.25],
    ]);
  });

  it('TABLE → one row with valueJson records at fiscalYear', () => {
    const rows = buildFinancialWrites({ ...base, fields: [
      { kind: 'TABLE', fieldKey: '040', edited: false, records: [
        { 'Επωνυμία': 'ΤΡΑΠΕΖΑ ΠΕΙΡΑΙΩΣ Α.Ε.', 'ΤΙD': '01698990' }, { 'Επωνυμία': '', 'ΤΙD': '' },
      ] },
    ] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fieldKey: 'E3.040', year: 2024, kind: 'TABLE', value: null });
    expect(rows[0].valueJson).toEqual([{ 'Επωνυμία': 'ΤΡΑΠΕΖΑ ΠΕΙΡΑΙΩΣ Α.Ε.', 'ΤΙD': '01698990' }]); // empty record dropped
  });
});
