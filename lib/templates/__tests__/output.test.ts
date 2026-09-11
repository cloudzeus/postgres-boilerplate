import { describe, it, expect } from 'vitest';
import { emptyDocument, setPath } from '@/lib/ocr/canonical';
import { asEnvelope, toOutputJson, toRunOutput } from '../output';
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
  const document = setPath(setPath(emptyDocument('invoice'), 'type.number', 'ΤΙΜ-1'), 'totals.total', 229.4);

  it('wraps the canonical document in a v3 envelope stamped with the run time', () => {
    const out = toRunOutput({ slug: 's', file: 'a.pdf', documentId: 'd1', createdAt: new Date('2026-09-10T10:00:00Z'), document });
    expect(out).toEqual({ template: 's', version: 3, extractedAt: '2026-09-10T10:00:00.000Z', file: 'a.pdf', documentId: 'd1', document });
    // The document goes in by reference — no copy that could drift from what was persisted.
    expect(out.document).toBe(document);
  });

  it('a run with no template (a plain document export) has a null template slug', () => {
    expect(toRunOutput({ slug: null, file: 'f', documentId: 'd', createdAt: new Date(0), document }).template).toBeNull();
  });
});

describe('asEnvelope', () => {
  it('recognises a stored envelope and rejects everything else', () => {
    const env = toRunOutput({ slug: 's', file: 'f', documentId: 'd', createdAt: new Date(0), document: emptyDocument('invoice') });
    expect(asEnvelope(env)).toBe(env);
    expect(asEnvelope(JSON.parse(JSON.stringify(env)))).not.toBeNull();
    // The pre-v3 shape carried `values`, not `document` — it must not be served as an envelope.
    expect(asEnvelope({ template: 's', version: 2, values: {} })).toBeNull();
    expect(asEnvelope(null)).toBeNull();
    expect(asEnvelope([])).toBeNull();
    expect(asEnvelope('x')).toBeNull();
  });
});
