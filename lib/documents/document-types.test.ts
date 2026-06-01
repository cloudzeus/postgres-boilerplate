// lib/documents/document-types.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeDocumentTypeInput } from './document-types';

describe('normalizeDocumentTypeInput', () => {
  it('trims name and keeps booleans', () => {
    const r = normalizeDocumentTypeInput({ name: '  Καταστατικό  ', requiresExpiry: false });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe('Καταστατικό');
      expect(r.value.requiresExpiry).toBe(false);
      expect(r.value.notifyExpiry).toBe(true);
      expect(r.value.active).toBe(true);
    }
  });

  it('rejects empty name', () => {
    const r = normalizeDocumentTypeInput({ name: '   ' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/name/i);
  });

  it('coerces description/category empty strings to null', () => {
    const r = normalizeDocumentTypeInput({ name: 'X', description: '', category: '  ' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.description).toBeNull();
      expect(r.value.category).toBeNull();
    }
  });
});
