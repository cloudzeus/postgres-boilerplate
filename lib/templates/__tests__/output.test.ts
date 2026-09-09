import { describe, it, expect } from 'vitest';
import { toOutputJson, toRunOutput } from '../output';
import type { FieldValue } from '../schema';

const fv = (value: FieldValue['value']): FieldValue => ({ raw: String(value), value, confidence: 1, source: 'text', page: 0, bbox: [0, 0, 0.1, 0.1], color: '#0078D4' });

describe('toOutputJson', () => {
  it('keys coerced values by field key, with slug/version/timestamp', () => {
    const at = new Date('2026-09-09T18:00:00.000Z');
    const out = toOutputJson({ slug: 'kapaline', version: 3 }, { arithmos: fv('309'), poso: fv(229.4), lines: fv([{ eidos: 'x', poso: 185 }]) }, at);
    expect(out).toEqual({ template: 'kapaline', version: 3, extractedAt: '2026-09-09T18:00:00.000Z', values: { arithmos: '309', poso: 229.4, lines: [{ eidos: 'x', poso: 185 }] } });
  });
  it('keeps null for fields that were not read', () => {
    expect(toOutputJson({ slug: 's', version: 1 }, { a: { ...fv(null), source: 'none' } }).values).toEqual({ a: null });
  });
  it('omits keys absent from values entirely', () => {
    const out = toOutputJson({ slug: 's', version: 1 }, { a: fv('x') });
    expect(out.values).toEqual({ a: 'x' });
    expect(Object.prototype.hasOwnProperty.call(out.values, 'b')).toBe(false);
  });
});

describe('toRunOutput', () => {
  it('merges classic invoice keys with template values, template wins', () => {
    const out = toRunOutput({ slug: 's', version: 2, file: 'a.pdf', documentId: 'd1', createdAt: new Date('2026-09-10T10:00:00Z'), extractedData: { invoiceNumber: '1', totalAmount: 5, companyName: 'X', items: [{ name: 'n' }], rawJunk: 1 }, values: { totalAmount: fv(7), kwh: fv(3) } });
    expect(out).toEqual({ template: 's', version: 2, extractedAt: '2026-09-10T10:00:00.000Z', file: 'a.pdf', documentId: 'd1', values: { invoiceNumber: '1', companyName: 'X', totalAmount: 7, kwh: 3 } });
  });
  it('omits classic keys that are null/empty and skips items', () => {
    expect(toRunOutput({ slug: 's', version: 1, file: 'f', documentId: 'd', createdAt: new Date(0), extractedData: { invoiceNumber: '', date: null, items: [] }, values: {} }).values).toEqual({});
  });
});
