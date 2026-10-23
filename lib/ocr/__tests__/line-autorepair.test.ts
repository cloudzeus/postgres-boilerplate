import { describe, it, expect } from 'vitest';
import { autoRepairLines, likelyMissingPages, recordedRepairs } from '../line-autorepair';
import { normalizeDocument } from '../canonical';
import { totalsClose } from '../invoice-math';
import { postingBlockers, postingWarnings, type PostingDoc, type PurdocContext } from '../purdoc-payload';
import { LINE_ARITHMETIC_RULES, buildSystemPrompt } from '../templates';

// Συνθετικά έγγραφα με τα ΙΔΙΑ μοτίβα που κόλλησαν πραγματικά παραστατικά (22–23/10/2026).
const doc = (lines: Array<Record<string, unknown>>, totals: Record<string, unknown>) => normalizeDocument({ kind: 'invoice', date: '2026-10-20', type: { number: 'Α 1' }, lines, totals });
const closes = (d: ReturnType<typeof doc>) => totalsClose({
  items: d.lines.map((l) => ({ quantity: l.quantity, price: l.unitPrice, discount: l.discount, vatRate: l.vatRate, total: l.net })),
  subtotal: d.totals.net, vatAmount: d.totals.vatAmount, otherCharges: d.totals.fees, totalAmount: d.totals.total,
});

describe('αυτόματες διορθώσεις ανάγνωσης', () => {
  it('τιμή αντλίας ΜΕ ΦΠΑ (21,87 lt × 1,829 = 40,00 = σύνολο) ⇒ καθαρή τιμή μονάδας', () => {
    const d = doc([{ name: 'DIESEL', quantity: 21.87, unitPrice: 1.829, net: 32.26, vatRate: 24 }], { net: 32.26, vatAmount: 7.74, total: 40 });
    expect(closes(d)).toBe(false);
    const { document, repairs } = autoRepairLines(d);
    expect(repairs.map((r) => r.kind)).toEqual(['gross_unit_price']);
    expect(document.lines[0].unitPrice).toBeCloseTo(1.47508, 5);
    expect(document.lines[0].net).toBe(32.26); // η τυπωμένη αξία δεν αλλάζει ποτέ
    expect(closes(document)).toBe(true);
  });

  it('χιλιάδες με τελεία («11.373 kg» διαβάστηκε 11,373) ⇒ 11373', () => {
    const d = doc([{ name: 'ΜΑΖΟΥΤ', quantity: 11.373, unitPrice: 0.57626, net: 6553.8, vatRate: 24 }], { net: 6553.8, vatAmount: 1572.91, total: 8126.71 });
    const { document, repairs } = autoRepairLines(d);
    expect(repairs[0].kind).toBe('thousands_quantity');
    expect(document.lines[0].quantity).toBe(11373);
  });

  it('έκπτωση που δεν διαβάστηκε (5 × 450 = 2.250, αξία 1.316,25) ⇒ 41,5%', () => {
    const d = doc([{ name: 'Άδειες', quantity: 5, unitPrice: 450, discount: 0, net: 1316.25, vatRate: 24 }], { net: 1316.25, vatAmount: 315.9, total: 1632.15 });
    const { document, repairs } = autoRepairLines(d);
    expect(repairs[0].kind).toBe('line_discount');
    expect(document.lines[0].discount).toBe(41.5);
    expect(closes(document)).toBe(true);
  });

  it('γραμμή με κενή στήλη ΦΠΑ (τέλος ΕΤΕ) ⇒ 0%, μόνο όταν εξηγεί ΑΚΡΙΒΩΣ τον ΦΠΑ της κεφαλίδας', () => {
    const d = doc([
      { name: 'Φυσικό αέριο', quantity: 1, unitPrice: 14619.99, net: 14619.99, vatRate: 6 },
      { name: 'ΕΑΕ', quantity: 1, unitPrice: 6.52, net: 6.52, vatRate: 6 },
      { name: 'ΕΤΕ', quantity: 1, unitPrice: 75.52, net: 75.52, vatRate: 6 },
      { name: 'ΕΦΚ', quantity: 1, unitPrice: 476.96, net: 476.96, vatRate: 6 },
    ], { net: 15178.99, vatAmount: 906.21, total: 16085.2 });
    const { document, repairs } = autoRepairLines(d);
    expect(repairs.map((r) => [r.kind, r.row])).toEqual([['zero_vat_line', 2]]);
    expect(document.lines[2].vatRate).toBe(0);
    expect(closes(document)).toBe(true);
  });

  it('γραμμή που βγαίνει ⇒ τίποτα· ασαφές ⇒ τίποτα (δεν μαντεύουμε)', () => {
    const ok = doc([{ name: 'Χ', quantity: 2, unitPrice: 10, net: 20, vatRate: 24 }], { net: 20, vatAmount: 4.8, total: 24.8 });
    expect(autoRepairLines(ok).repairs).toEqual([]);
    const odd = doc([{ name: 'Υ', quantity: 3, unitPrice: 7, net: 19.37, vatRate: 24 }], { net: 19.37, vatAmount: 4.65, total: 24.02 });
    expect(autoRepairLines(odd).repairs).toEqual([]);
  });

  it('οι διορθώσεις καταγράφονται στο έγγραφο και γίνονται παρατήρηση καταχώρισης', () => {
    const d = autoRepairLines(doc([{ name: 'DIESEL', quantity: 21.87, unitPrice: 1.829, net: 32.26, vatRate: 24 }], { net: 32.26, vatAmount: 7.74, total: 40 })).document;
    expect(recordedRepairs(d)).toHaveLength(1);
    const ctx = { target: { object: 'PURDOC', lines: 'AUTO', supported: true }, lines: [{ rowIndex: 0, mtrl: 1, isService: true }] } as unknown as PurdocContext;
    expect(postingWarnings(ctx, null, d)).toContain('reading_auto_repaired');
  });
});

describe('λείπουν σελίδες', () => {
  it('γραμμές 772,40 από καθαρή 30.245,28 με κεφαλίδα που κλείνει ⇒ λείπουν σελίδες', () => {
    expect(likelyMissingPages(doc([{ name: 'Προμήθεια', quantity: 1, unitPrice: 772.4, net: 772.4, vatRate: 0 }], { net: 30245.28, vatAmount: 0, total: 30245.28 }))).toBe(true);
    expect(likelyMissingPages(doc([{ name: 'Χ', quantity: 1, unitPrice: 60, net: 60, vatRate: 0 }], { net: 60.75, vatAmount: 0, total: 60.75 }))).toBe(false);
  });
});

describe('«Έξοδο» αγορών (EXPANAL) δεν περνά από τη σύνδεση', () => {
  it('γραμμή «Έξοδο» σε τιμολόγιο αγοράς ⇒ εμπόδιο, όχι «Έτοιμο»', () => {
    const d = doc([{ name: 'Καύσιμα', quantity: 1, unitPrice: 32.26, net: 32.26, vatRate: 24 }], { net: 32.26, vatAmount: 7.74, total: 40 });
    const pd: PostingDoc = { status: 'COMPLETED', category: 'RECEIPT', softoneTrdr: 1, softoneSeries: '2061', seriesSource: 1251, seriesKnown: true, seriesEnabled: true, traderSodtype: 12 };
    const ctx = { target: { object: 'PURDOC', lines: 'AUTO', supported: true }, lines: [{ rowIndex: 0, expn: 983 }], vatIdByRate: { 24: 1410 } } as unknown as PurdocContext;
    expect(postingBlockers(d, pd, ctx)).toContain('lines_expense_unsupported');
  });
});

describe('οδηγίες ανάγνωσης', () => {
  it('ο κανόνας αριθμητικής γραμμών μπαίνει σε κάθε prompt', () => {
    const p = buildSystemPrompt('auto', 'el' as never);
    expect(p).toContain(LINE_ARITHMETIC_RULES);
    expect(LINE_ARITHMETIC_RULES).toMatch(/price WITH VAT/);
    expect(LINE_ARITHMETIC_RULES).toMatch(/THOUSANDS separator/);
  });
});

describe('payload γραμμών ειδών/υπηρεσιών (μετρημένο με calculate, 23/10/2026)', () => {
  const ctx = (lines: unknown[]) => ({ target: { object: 'PURDOC', lines: 'AUTO', supported: true }, series: 2061, trdr: 1, lines, vatIdByRate: { 24: 1410 } }) as unknown as PurdocContext;
  it('υπηρεσία ⇒ QTY1 (βασική μονάδα), όχι QTY', async () => {
    const { buildPurdocPayload } = await import('../purdoc-payload');
    const p = buildPurdocPayload(doc([{ name: 'Συνδρομή', quantity: 4, unitPrice: 100, discount: 0, net: 400, vatRate: 24 }], { net: 400, vatAmount: 96, total: 496 }), ctx([{ rowIndex: 0, mtrl: 3902, isService: true }]));
    expect(p.DATA.SRVLINES?.[0]).toMatchObject({ QTY1: 4, PRICE: 100 });
    expect(p.DATA.SRVLINES?.[0]).not.toHaveProperty('QTY');
  });
  it('τιμή με > 2 δεκαδικά ⇒ στέλνεται και η αξία (LINEVAL), αλλιώς η SoftOne τη στρογγυλεύει', async () => {
    const { buildPurdocPayload } = await import('../purdoc-payload');
    const p = buildPurdocPayload(doc([{ name: 'ΥΓΡΟ ΑΖΩΤΟ', quantity: 9560, unitPrice: 0.292, net: 2791.52, vatRate: 24 }], { net: 2791.52, vatAmount: 669.96, total: 3461.48 }), ctx([{ rowIndex: 0, mtrl: 8555, isService: false }]));
    expect(p.DATA.ITELINES?.[0]).toMatchObject({ QTY: 9560, PRICE: 0.292, LINEVAL: 2791.52 });
    const q = buildPurdocPayload(doc([{ name: 'Χ', quantity: 2, unitPrice: 10.5, net: 21, vatRate: 24 }], { net: 21, vatAmount: 5.04, total: 26.04 }), ctx([{ rowIndex: 0, mtrl: 1, isService: false }]));
    expect(q.DATA.ITELINES?.[0]).not.toHaveProperty('LINEVAL');
  });
});

describe('ΦΠΑ από την κεφαλίδα', () => {
  it('καμία γραμμή χωρίς συντελεστή + ΦΠΑ κεφαλίδας 0 ⇒ 0% σε όλες', () => {
    const d = doc([{ name: 'COMMISSION', quantity: 1, unitPrice: 6361.6, net: 6361.6 }], { net: 6361.6, vatAmount: 0, total: 6361.6 });
    const { document, repairs } = autoRepairLines(d);
    expect(repairs[0].kind).toBe('vat_from_header');
    expect(document.lines[0].vatRate).toBe(0);
  });
  it('μικτοί/άγνωστοι συντελεστές ⇒ δεν μαντεύουμε', () => {
    const d = doc([{ name: 'Α', quantity: 1, unitPrice: 100, net: 100 }, { name: 'Β', quantity: 1, unitPrice: 100, net: 100 }], { net: 200, vatAmount: 30, total: 230 });
    expect(autoRepairLines(d).repairs).toEqual([]);
  });
});
