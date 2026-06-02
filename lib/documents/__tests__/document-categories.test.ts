import { describe, it, expect } from 'vitest';
import { normalizeNamedCatalogInput } from '../document-categories';

describe('normalizeNamedCatalogInput', () => {
  it('trims name and defaults order/active', () => {
    expect(normalizeNamedCatalogInput({ name: '  Νομιμοποιητικά  ' })).toEqual({ ok: true, value: { name: 'Νομιμοποιητικά', order: 0, active: true } });
  });
  it('rejects empty name', () => {
    expect(normalizeNamedCatalogInput({ name: '   ' })).toEqual({ ok: false, error: 'name is required' });
  });
  it('coerces order and active', () => {
    expect(normalizeNamedCatalogInput({ name: 'X', order: '3', active: false })).toEqual({ ok: true, value: { name: 'X', order: 3, active: false } });
  });
});
