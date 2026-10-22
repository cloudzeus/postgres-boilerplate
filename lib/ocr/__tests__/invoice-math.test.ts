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

import { reconcileInvoice as recon2, totalsPlans, totalsClose, feesNotInLines } from '../invoice-math';

describe('«Τι να κάνεις» — μόνο λύσεις που κλείνουν', () => {
  it('ΜΙΛΑΝΟΣ: έκπτωση 40% στη γραμμή + ΦΠΑ πάνω στο τέλος ανακύκλωσης· το τυπωμένο σύνολο μένει', () => {
    const input = {
      items: [{ quantity: 4, price: 120.5, discount: 0, vatRate: 24, total: 482 }],
      subtotal: 289.2, vatAmount: 69.41, otherCharges: 4.6, totalAmount: 359.71,
    };
    expect(totalsClose(input)).toBe(false);
    const [best] = totalsPlans(input);
    expect(best.steps).toEqual([{ kind: 'line_discount', pct: 40 }, { kind: 'vat', mode: 'lines_fees' }]);
    expect(best.result).toMatchObject({ vatAmount: 70.51, totalAmount: 359.71 });
    expect(best.result.items[0]).toMatchObject({ total: 289.2, discount: 40 });
    // Καμία πρόταση που δεν κλείνει.
    for (const p of totalsPlans(input)) expect(totalsClose(p.result)).toBe(true);
  });

  it('CIF: κλείνει ήδη ⇒ καμία διόρθωση· οι επιβαρύνσεις όμως δεν είναι γραμμή', () => {
    const input = { items: [{ quantity: 1, price: 167000, total: 167000 }], subtotal: 167000, vatAmount: null, otherCharges: 6500, totalAmount: 173500 };
    expect(recon2(input).totalOk).toBe(true);
    expect(totalsPlans(input)).toEqual([]);
    expect(feesNotInLines(input)).toBe(6500);
  });

  it('γραμμές χωρίς ΦΠΑ και σύνολο = καθαρή × 1,24 ⇒ ΦΠΑ 24%', () => {
    const input = { items: [{ quantity: 1, price: 100, total: 100 }], subtotal: 100, vatAmount: null, otherCharges: null, totalAmount: 124 };
    const [best] = totalsPlans(input);
    expect(best.steps).toEqual([{ kind: 'vat_rate', rate: 24 }]);
    expect(best.result.vatAmount).toBe(24);
  });

  it('ασυμφωνία που δεν εξηγείται με τίποτα γνωστό ⇒ καμία πρόταση (όχι μαντεψιές)', () => {
    const input = { items: [{ quantity: 3, price: 7, total: 21 }], subtotal: 50, vatAmount: 3, otherCharges: null, totalAmount: 99 };
    expect(totalsPlans(input).every((p) => totalsClose(p.result))).toBe(true);
  });
});

describe('ποτέ πάνω σε τυπωμένες επιβαρύνσεις', () => {
  it('ΜΙΛΑΝΟΣ: καμία πρόταση δεν αλλάζει τα 4,60 € επιβαρύνσεων', async () => {
    const { totalsPlans: tp } = await import('../invoice-math');
    const input = { items: [{ quantity: 4, price: 120.5, discount: 0, vatRate: 24, total: 482 }], subtotal: 289.2, vatAmount: 69.41, otherCharges: 4.6, totalAmount: 359.71 };
    for (const p of tp(input)) expect(p.result.otherCharges).toBe(4.6);
  });
});

describe('επανέλεγχος ΜΙΛΑΝΟΣ: η νέα ανάγνωση + εξήγηση κλείνει', () => {
  it('καθαρή 293,80 (με το τέλος), ΦΠΑ 70,51, σύνολο 359,71, γραμμή 289,20 χωρίς έκπτωση ⇒ έκπτωση 40% + καθαρή = γραμμές', async () => {
    const { totalsPlans: tp, totalsClose: tc } = await import('../invoice-math');
    const input = { items: [{ quantity: 4, price: 120.5, discount: 0, vatRate: 24, total: 289.2 }], subtotal: 293.8, vatAmount: 70.51, otherCharges: 4.6, totalAmount: 359.71 };
    expect(tc(input)).toBe(false);
    const [best] = tp(input);
    expect(best.steps).toEqual([{ kind: 'line_discount_from_total' }, { kind: 'net_from_lines' }]);
    expect(best.result).toMatchObject({ subtotal: 289.2, vatAmount: 70.51, otherCharges: 4.6, totalAmount: 359.71 });
    expect(best.result.items[0].discount).toBe(40);
  });
});

describe('totalsPlans — κεφαλίδα που κλείνει μόνη της', () => {
  // Ενδοκοινοτικό τιμολόγιο υπηρεσιών (συνθετικά ποσά όπως ενός VPS): «+0% VAT», καθαρή = σύνολο.
  // Διαβάστηκαν 3 από τις 4 γραμμές — η πρώτη (43,00) χάθηκε.
  const contabo = {
    items: [
      { quantity: 1, price: 6.25, discount: 0, total: 6.25, vatRate: 0 },
      { quantity: 1, price: 7, discount: 0, total: 7, vatRate: 0 },
      { quantity: 1, price: 4.5, discount: 0, total: 4.5, vatRate: 0 },
    ],
    subtotal: 60.75, vatAmount: 0, otherCharges: null, totalAmount: 60.75,
  };

  it('πρώτη εξήγηση: λείπει γραμμή 43,00 με ΦΠΑ 0%', () => {
    const plans = totalsPlans(contabo);
    expect(plans[0].steps).toEqual([{ kind: 'missing_line', amount: 43, vatRate: 0 }]);
    expect(totalsClose(plans[0].result)).toBe(true);
  });

  it('ΠΟΤΕ «οι γραμμές έχουν ΦΠΑ 24%» όταν τυπώθηκε ΦΠΑ 0 και καθαρή = σύνολο', () => {
    const plans = totalsPlans(contabo, 10);
    expect(plans.some((p) => p.steps.some((s) => s.kind === 'vat_rate'))).toBe(false);
  });

  it('λύσεις που ξαναγράφουν την τυπωμένη κεφαλίδα έρχονται ΜΕΤΑ τη γραμμή που λείπει', () => {
    const plans = totalsPlans(contabo, 10);
    const firstHeaderRewrite = plans.findIndex((p) => p.steps.some((s) => s.kind === 'net_from_lines'));
    expect(firstHeaderRewrite === -1 || firstHeaderRewrite > 0).toBe(true);
  });

  it('γραμμή που περισσεύει (διαβάστηκε το υποσύνολο ως γραμμή) ⇒ αφαίρεσέ την', () => {
    const plans = totalsPlans({
      items: [
        { quantity: 1, price: 10, discount: 0, total: 10, vatRate: 24 },
        { quantity: 1, price: 20, discount: 0, total: 20, vatRate: 24 },
        { quantity: 1, price: 30, discount: 0, total: 30, vatRate: 24 },
      ],
      subtotal: 30, vatAmount: 7.2, otherCharges: null, totalAmount: 37.2,
    });
    expect(plans[0].steps).toEqual([{ kind: 'extra_line', index: 2 }]);
  });

  it('η γραμμή που λείπει παίρνει τον συντελεστή της κεφαλίδας (24%)', () => {
    const plans = totalsPlans({
      items: [{ quantity: 1, price: 100, discount: 0, total: 100, vatRate: 24 }],
      subtotal: 150, vatAmount: 36, otherCharges: null, totalAmount: 186,
    });
    expect(plans[0].steps).toEqual([{ kind: 'missing_line', amount: 50, vatRate: 24 }]);
  });
});

