// Γραμμές ΠΑΓΙΩΝ (ASSLINES): payload, εμπόδια, κωδικός και πρόταση κατηγορίας.
import { describe, it, expect } from 'vitest';
import { emptyDocument, type DocumentJson } from '../canonical';
import { buildPurdocPayload, postingBlockers, type PurdocContext, type PostingDoc } from '../purdoc-payload';
import { assetFits, defaultPostingTarget, resolvePostingTarget } from '../posting-target';
import { guessAssetCategories, nextAssetCode } from '../asset-code';

const PURCHASE = defaultPostingTarget({ sosource: 1251, name: 'Τιμολόγιο Αγοράς' });

const doc = (): DocumentJson => ({
  ...emptyDocument('invoice'),
  date: '2026-10-12',
  type: { label: 'ΤΙΜΟΛΟΓΙΟ', series: 'ΤΙΜ', number: '5', myDataType: null },
  totals: { net: 2100, discount: null, vatAmount: 504, withholding: null, fees: null, total: 2604, payable: 2604 },
  lines: [
    { code: null, name: 'MacBook Pro 14', unit: null, quantity: 1, unitPrice: 2000, discount: 0, net: 2000, vatRate: 24, vatAmount: 480, total: 2480, serials: [], custom: {} },
    { code: 'A1', name: 'Θήκη', unit: null, quantity: 2, unitPrice: 50, discount: 0, net: 100, vatRate: 24, vatAmount: 24, total: 124, serials: [], custom: {} },
  ],
});

const ctx = (over: Partial<PurdocContext> = {}): PurdocContext => ({
  target: PURCHASE,
  series: 2061,
  trdr: 28,
  lines: [
    { rowIndex: 0, asset: 6198, costCntr: 7 },
    { rowIndex: 1, mtrl: 555, isService: false },
  ],
  vatIdByRate: { 24: 1410 },
  assetWhouse: 1000,
  ...over,
});

const postingDoc: PostingDoc = {
  status: 'COMPLETED', category: 'EXPENSE', softoneTrdr: 28, softoneSeries: '2061', seriesSource: 1251,
  seriesKnown: true, seriesEnabled: true, traderSodtype: 12,
};

describe('ASSLINES στο payload', () => {
  it('η γραμμή παγίου πάει σε ASSLINES με αποθήκη παγίων και «Αγορά/Προσθήκη» 0, δίπλα στα είδη', () => {
    const p = buildPurdocPayload(doc(), ctx());
    expect(p.OBJECT).toBe('PURDOC');
    expect(p.DATA.ASSLINES).toEqual([{
      LINENUM: 9000001, MTRL: 6198, WHOUSE: 1000, ASSDEPR: 0, MTRTYPE: 0, QTY1: 1, PRICE: 2000, VAT: 1410,
      COMMENTS: 'MacBook Pro 14', COSTCNTR: 7,
    }]);
    expect(p.DATA.ITELINES).toEqual([{ LINENUM: 9000001, MTRL: 555, QTY: 2, PRICE: 50, VAT: 1410, COMMENTS: 'Θήκη' }]);
  });

  it('χωρίς αποθήκη παγίων: καμία γραμμή παγίου στο payload και εμπόδιο asset_no_whouse', () => {
    const c = ctx({ assetWhouse: null });
    expect(buildPurdocPayload(doc(), c).DATA.ASSLINES).toBeUndefined();
    expect(postingBlockers(doc(), postingDoc, c)).toContain('asset_no_whouse');
  });

  it('η γραμμή παγίου μετράει ως αντιστοιχισμένη', () => {
    expect(postingBlockers(doc(), postingDoc, ctx())).not.toContain('unmatched_lines');
    expect(postingBlockers(doc(), postingDoc, ctx())).toEqual([]);
  });

  it('πάγιο σε σειρά που δεν στέλνει «ανά γραμμή» → εμπόδιο, όχι σιωπηλή απώλεια', () => {
    const t = resolvePostingTarget({ sosource: 1251, postLines: 'ITELINES' });
    const blockers = postingBlockers(doc(), postingDoc, ctx({ target: t }));
    expect(blockers).toContain('lines_asset_unsupported');
    expect(buildPurdocPayload(doc(), ctx({ target: t })).DATA.ASSLINES).toBeUndefined();
  });

  it('assetFits: μόνο PURDOC με γραμμές «ανά γραμμή»', () => {
    expect(assetFits(PURCHASE)).toBe(true);
    expect(assetFits(resolvePostingTarget({ sosource: 1251, postLines: 'EXPANAL' }))).toBe(false);
    expect(assetFits(defaultPostingTarget({ sosource: 1653, name: 'Πιστωτές' }))).toBe(false);
    expect(assetFits(null)).toBe(false);
  });
});

describe('nextAssetCode', () => {
  it('επόμενος αύξων στο πρόθεμα του λογαριασμού αγορών', () => {
    expect(nextAssetCode('14.03.00', ['14.03.00.0002', '14.03.00.0013', '14.08.00.0004', '14.03.00.ΧΧ'])).toBe('14.03.00.0014');
  });
  it('πρώτο πάγιο της κατηγορίας', () => {
    expect(nextAssetCode('13.02.00', ['14.03.00.0001'])).toBe('13.02.00.0001');
  });
});

describe('guessAssetCategories', () => {
  const gl = [
    { mtrAcn: 1001, name: 'Έπιπλα' }, { mtrAcn: 1002, name: 'Μηχανήματα' },
    { mtrAcn: 1006, name: 'Ηλεκτρονικά Συγκροτήματα' }, { mtrAcn: 1007, name: 'Εξοπλισμός τηλεπικοινωνιών' },
  ];
  const cats = [
    { mtrCategory: 1001, name: 'Eξοπλισμός Διοίκησης' }, { mtrCategory: 1002, name: 'Εξοπλισμός Μηχανημάτων' },
    { mtrCategory: 1005, name: 'Η/Υ και ηλεκτρονικά συγκροτήματα' },
  ];
  it('MacBook → Ηλεκτρονικά συγκροτήματα', () => {
    expect(guessAssetCategories('NB APPLE MACBOOK PRO 14-INCH/M3/1T', gl, cats)).toEqual({ mtrAcn: 1006, mtrCategory: 1005 });
  });
  it('αντιδραστήρας → Μηχανήματα', () => {
    expect(guessAssetCategories('Reactor 16m3', gl, cats)).toEqual({ mtrAcn: 1002, mtrCategory: 1002 });
    expect(guessAssetCategories('Heat Exchanger 24 m2 17', gl, cats)).toEqual({ mtrAcn: 1002, mtrCategory: 1002 });
  });
  it('άγνωστο → καμία πρόταση', () => {
    expect(guessAssetCategories('Κάτι άσχετο', gl, cats)).toEqual({ mtrAcn: null, mtrCategory: null });
  });
});
