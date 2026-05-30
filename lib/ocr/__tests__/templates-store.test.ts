// lib/ocr/__tests__/templates-store.test.ts
import { describe, it, expect } from 'vitest';
import { mergeFromTemplatePass } from '../templates-store';

describe('mergeFromTemplatePass', () => {
  it('fills only fields that were missing or invalid in pass1', () => {
    const pass1 = { companyName: 'A', vatNumber: '', customerName: 'B',
      customerVatNumber: '090000045', invoiceNumber: '7', date: '2026-01-01',
      subtotal: 100, vatAmount: 24, totalAmount: 124 };
    const pass2 = { companyName: 'SHOULD-NOT-WIN', vatNumber: '094014201',
      customerVatNumber: '090000045', subtotal: 100, vatAmount: 24, totalAmount: 124 };
    const out = mergeFromTemplatePass(pass1, pass2, 'invoice');
    expect(out.vatNumber).toBe('094014201');   // was empty → filled from pass2
    expect(out.companyName).toBe('A');          // pass1 had it → kept
  });
  it('replaces a present-but-invalid ΑΦΜ from pass1 with a valid one from pass2', () => {
    const pass1 = { vatNumber: '094014202', subtotal: 1, vatAmount: 0, totalAmount: 1 };
    const pass2 = { vatNumber: '094014201' };
    expect(mergeFromTemplatePass(pass1, pass2, 'invoice').vatNumber).toBe('094014201');
  });
});
