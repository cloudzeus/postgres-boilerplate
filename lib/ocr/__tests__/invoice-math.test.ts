import { describe, it, expect } from 'vitest';
import { analyzeLine, reconcileInvoice } from '../invoice-math';

describe('analyzeLine — discount handling', () => {
  it('detects a percentage discount (total = q·p·(1 − d/100))', () => {
    const a = analyzeLine({ quantity: 2, price: 100, discount: 10, vatRate: 24, total: 180 });
    expect(a.gross).toBe(200);
    expect(a.net).toBe(180);
    expect(a.discountKind).toBe('percent');
    expect(a.consistent).toBe(true);
  });
  it('detects an amount discount (total = q·p − d)', () => {
    const a = analyzeLine({ quantity: 2, price: 100, discount: 10, vatRate: 24, total: 190 });
    expect(a.discountKind).toBe('amount');
    expect(a.consistent).toBe(true);
  });
  it('flags an inconsistent line', () => {
    expect(analyzeLine({ quantity: 2, price: 100, discount: 10, total: 150 }).consistent).toBe(false);
  });
  it('no discount: consistent when total equals q·p', () => {
    expect(analyzeLine({ quantity: 1, price: 50, total: 50 }).consistent).toBe(true);
  });
  it('does not flag when quantity/price are unknown', () => {
    expect(analyzeLine({ total: 29.1, vatRate: 24 }).consistent).toBe(true);
  });
  it('parses comma decimals', () => {
    const a = analyzeLine({ quantity: '1', price: '29,10', total: '29,10', vatRate: '24' });
    expect(a.net).toBeCloseTo(29.1, 2);
  });
});

describe('reconcileInvoice — single rate', () => {
  it('reconciles lines→subtotal, VAT, and grand total', () => {
    const r = reconcileInvoice({
      items: [{ total: 100, vatRate: 24 }, { total: 50, vatRate: 24 }],
      subtotal: 150, vatAmount: 36, totalAmount: 186,
    });
    expect(r.sumNet).toBe(150);
    expect(r.linesVsSubtotal?.ok).toBe(true);
    expect(r.vatComputed).toBe(36);
    expect(r.vatOk).toBe(true);
    expect(r.totalOk).toBe(true);
    expect(r.hasMultipleRates).toBe(false);
  });
});

describe('reconcileInvoice — multiple VAT rates', () => {
  it('groups lines by rate and sums VAT per group', () => {
    const r = reconcileInvoice({
      items: [{ total: 100, vatRate: 24 }, { total: 100, vatRate: 13 }, { total: 50, vatRate: 24 }],
      subtotal: 250, vatAmount: 49, totalAmount: 299,
    });
    expect(r.hasMultipleRates).toBe(true);
    expect(r.vatGroups).toEqual([
      { rate: 13, net: 100, vat: 13 },
      { rate: 24, net: 150, vat: 36 },
    ]);
    expect(r.vatComputed).toBe(49);
    expect(r.vatOk).toBe(true);
    expect(r.totalOk).toBe(true);
  });
});

describe('reconcileInvoice — mismatches', () => {
  it('flags a wrong subtotal', () => {
    const r = reconcileInvoice({ items: [{ total: 100, vatRate: 24 }], subtotal: 120, vatAmount: 24, totalAmount: 144 });
    expect(r.linesVsSubtotal?.ok).toBe(false);
  });
  it('flags a wrong VAT', () => {
    const r = reconcileInvoice({ items: [{ total: 100, vatRate: 24 }], subtotal: 100, vatAmount: 13, totalAmount: 113 });
    expect(r.vatOk).toBe(false);
  });
  it('returns null checks when fields are absent', () => {
    const r = reconcileInvoice({ items: [{ total: 100, vatRate: 24 }] });
    expect(r.linesVsSubtotal).toBeNull();
    expect(r.vatOk).toBeNull();
    expect(r.totalOk).toBeNull();
  });
});
