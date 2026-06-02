import { describe, it, expect } from 'vitest';
import { resolveBusinessTypeId } from '../business-type';

const catalog = [
  { id: 'bt_ae', code: 'ΑΕ' },
  { id: 'bt_ike', code: 'ΙΚΕ' },
  { id: 'bt_atomiki', code: 'ΑΤΟΜΙΚΗ' },
];

describe('resolveBusinessTypeId', () => {
  it('keeps the existing id when override is set', () => {
    const r = resolveBusinessTypeId({ legalForm: 'Ι.Κ.Ε.', legalTypeDescr: null, businessTypeId: 'bt_ae', businessTypeOverride: true }, catalog);
    expect(r).toBe('bt_ae');
  });
  it('maps free-text legalForm via canonicalLegalForm', () => {
    expect(resolveBusinessTypeId({ legalForm: 'Ιδιωτική Κεφαλαιουχική Εταιρεία', legalTypeDescr: null, businessTypeId: null, businessTypeOverride: false }, catalog)).toBe('bt_ike');
    expect(resolveBusinessTypeId({ legalForm: 'Α.Ε.', legalTypeDescr: null, businessTypeId: null, businessTypeOverride: false }, catalog)).toBe('bt_ae');
  });
  it('falls back to legalTypeDescr when legalForm is empty', () => {
    expect(resolveBusinessTypeId({ legalForm: null, legalTypeDescr: 'Ατομική', businessTypeId: null, businessTypeOverride: false }, catalog)).toBe('bt_atomiki');
  });
  it('returns null when nothing matches the catalog', () => {
    expect(resolveBusinessTypeId({ legalForm: 'Σωματείο', legalTypeDescr: null, businessTypeId: null, businessTypeOverride: false }, catalog)).toBeNull();
  });
});
