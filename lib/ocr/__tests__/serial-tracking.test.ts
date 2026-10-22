import { describe, it, expect } from 'vitest';
import { baseQuantity, describeSnMask, serialVerdict, snMaskMatches, splitSerials } from '../serial-tracking';
import { buildPurdocPayload, postingBlockers, postingWarnings, type PostingDoc, type PurdocContext, type PurdocLineCtx } from '../purdoc-payload';
import { normalizeDocument } from '../canonical';
import { planLineEdit, parseSerialsInput } from '../line-edit';
import { blockerFix } from '../blocker-fix';

// Συνθετικά δεδομένα — όχι πελάτες.
const doc = (lines: Array<Record<string, unknown>>) => normalizeDocument({
  kind: 'invoice', date: '2026-10-20', type: { number: 'ΤΙΜ 100' },
  lines, totals: { net: lines.reduce((t, l) => t + Number(l.net ?? 0), 0) },
});
const ctx = (lines: PurdocLineCtx[], object: 'PURDOC' | 'LINSUPDOC' = 'PURDOC'): PurdocContext => ({
  target: { object, lines: object === 'PURDOC' ? 'AUTO' : 'LINLINES', source: 'default', supported: true, reason: '' } as PurdocContext['target'],
  series: 2061, trdr: 2791, lines, vatIdByRate: { 24: 1410 },
});
const okDoc: PostingDoc = { status: 'COMPLETED', category: 'INVOICE', softoneTrdr: 2791, softoneSeries: '2061', seriesSource: 1251, seriesKnown: true, seriesEnabled: true, traderSodtype: 12 };
const line = (o: Record<string, unknown> = {}) => ({ name: 'Server', quantity: 2, unitPrice: 100, net: 200, vatRate: 24, ...o });

describe('μορφή σειριακού (SNCODEMSK)', () => {
  it('N = ψηφίο, A = γράμμα, ίδιο μήκος· κενή μορφή = όλα περνούν', () => {
    expect(snMaskMatches('12345', 'NNNNN')).toBe(true);
    expect(snMaskMatches('ABC12', 'NNNNN')).toBe(false);
    expect(snMaskMatches('1234', 'NNNNN')).toBe(false);
    expect(snMaskMatches('AB-12', 'AA-NN')).toBe(true);
    expect(snMaskMatches('οτιδήποτε', null)).toBe(true);
    expect(describeSnMask('NNNNN')).toBe('5 ψηφία');
  });
});

describe('κρίση γραμμής', () => {
  it('τεμάχια σε βασική μονάδα: 2 κιβώτια × 10 = 20', () => {
    expect(baseQuantity(2, 10, false)).toBe(20);
    expect(baseQuantity(20, 10, true)).toBe(20);
  });
  it('είδος με παρακολούθηση: πλήθος ≠ τεμάχια ⇒ ασυμφωνία· σωστό πλήθος ⇒ SNLINES', () => {
    const base = { rowIndex: 0, quantity: 2, isStockLine: true, snUse: 1 };
    expect(serialVerdict({ ...base, serials: ['A1', 'A2', 'A3'] }).countMismatch).toBe(true);
    const ok = serialVerdict({ ...base, serials: ['A1', 'A2'] });
    expect(ok.toSnLines).toBe(true);
    expect(ok.countMismatch).toBe(false);
  });
  it('είδος χωρίς παρακολούθηση ⇒ σχόλιο (untracked)· άγνωστο ⇒ unknown· χωρίς σειριακούς ⇒ missing', () => {
    expect(serialVerdict({ rowIndex: 0, quantity: 1, isStockLine: true, snUse: 0, serials: ['X1'] }).untracked).toBe(true);
    expect(serialVerdict({ rowIndex: 0, quantity: 1, isStockLine: true, snUse: null, serials: ['X1'] }).unknown).toBe(true);
    expect(serialVerdict({ rowIndex: 0, quantity: 1, isStockLine: true, snUse: 2, serials: [] }).missing).toBe(true);
    // Υπηρεσία / δαπάνη: ποτέ σειριακοί στη SoftOne.
    const srv = serialVerdict({ rowIndex: 0, quantity: 1, isStockLine: false, snUse: 1, serials: ['X1'] });
    expect(srv.toSnLines || srv.missing || srv.untracked).toBe(false);
  });
  it('μοίρασμα σε πολλές γραμμές (από δελτίο): κατά σειρά, τα περισσευούμενα στην τελευταία', () => {
    expect(splitSerials(['a', 'b', 'c', 'd'], [1, 2])).toEqual([['a'], ['b', 'c', 'd']]);
  });
});

describe('payload PURDOC με σειριακούς', () => {
  it('είδος με παρακολούθηση ⇒ SNLINES δεμένα με το LINENUM της γραμμής, όχι στο σχόλιο', () => {
    const d = doc([line({ serials: ['SN-0001', 'SN-0002'] })]);
    const p = buildPurdocPayload(d, ctx([{ rowIndex: 0, mtrl: 1275, isService: false, snUse: 1 }]));
    expect(p.DATA.SNLINES).toEqual([
      { MTRLINES: 9000001, MTRL: 1275, CODE: 'SN-0001' },
      { MTRLINES: 9000001, MTRL: 1275, CODE: 'SN-0002' },
    ]);
    expect(p.DATA.ITELINES?.[0].COMMENTS).toBe('Server');
  });
  it('είδος χωρίς παρακολούθηση ⇒ κανένα SNLINES, οι σειριακοί στο σχόλιο της γραμμής', () => {
    const d = doc([line({ quantity: 1, net: 100, serials: ['SN-0009'] })]);
    const p = buildPurdocPayload(d, ctx([{ rowIndex: 0, mtrl: 8568, isService: false, snUse: 0 }]));
    expect(p.DATA.SNLINES).toBeUndefined();
    expect(p.DATA.ITELINES?.[0].COMMENTS).toBe('Server · S/N: SN-0009');
  });
  it('από δελτίο σε δύο γραμμές ⇒ οι σειριακοί μοιράζονται στα LINENUM τους', () => {
    const d = doc([line({ serials: ['A', 'B'] })]);
    const p = buildPurdocPayload(d, ctx([{ rowIndex: 0, mtrl: 1275, isService: false, snUse: 1, sourceLinks: [{ findoc: 1, mtrlines: 1, qty1: 1 }, { findoc: 1, mtrlines: 2, qty1: 1 }] }]));
    expect(p.DATA.SNLINES?.map((s) => [s.MTRLINES, s.CODE])).toEqual([[9000001, 'A'], [9000002, 'B']]);
  });
});

describe('εμπόδια & παρατηρήσεις σειριακών', () => {
  it('λάθος πλήθος ή μορφή ⇒ εμπόδιο με «Λύσε» στον επεξεργαστή γραμμών', () => {
    const d = doc([line({ serials: ['12345', 'ABCDE', '99999'] })]);
    const b = postingBlockers(d, okDoc, ctx([{ rowIndex: 0, mtrl: 1, isService: false, snUse: 1, snMask: 'NNNNN' }]));
    expect(b).toContain('serials_count_mismatch');
    expect(b).toContain('serials_bad_format');
    expect(blockerFix('serials_count_mismatch')?.target).toEqual({ kind: 'tool', tool: 'lines' });
  });
  it('είδος με παρακολούθηση χωρίς σειριακούς ⇒ παρατήρηση (όχι εμπόδιο)', () => {
    const d = doc([line()]);
    const c = ctx([{ rowIndex: 0, mtrl: 1, isService: false, snUse: 2 }]);
    expect(postingBlockers(d, okDoc, c)).not.toContain('serials_count_mismatch');
    expect(postingWarnings(c, null, d)).toContain('serials_missing');
  });
  it('σειριακοί σε είδος χωρίς παρακολούθηση ⇒ παρατήρηση serials_untracked', () => {
    const d = doc([line({ quantity: 1, net: 100, serials: ['Z1'] })]);
    expect(postingWarnings(ctx([{ rowIndex: 0, mtrl: 1, isService: false, snUse: 0 }]), null, d)).toContain('serials_untracked');
  });
});

describe('επεξεργαστής γραμμών: σειριακοί', () => {
  it('«A1, A2 / A3  A3» → τρεις, χωρίς διπλότυπα', () => {
    expect(parseSerialsInput('A1, A2 / A3  A3')).toEqual(['A1', 'A2', 'A3']);
  });
  it('η αλλαγή σειριακών περνά στη γραμμή χωρίς να αγγίξει ποσά', () => {
    const cur = [{ name: 'Server', code: null, unit: null, quantity: 2, unitPrice: 100, discount: null, net: 200, vatRate: 24, serials: ['A'] }];
    const plan = planLineEdit(cur, { update: [{ rowIndex: 0, serials: ['A', 'B'] }] });
    expect(plan.errors).toEqual([]);
    expect(plan.lines[0].values.serials).toEqual(['A', 'B']);
    expect(plan.lines[0].values.net).toBe(200);
    expect(plan.identityChanged).toEqual([]);
  });
});
