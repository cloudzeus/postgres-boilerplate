// lib/ocr/__tests__/purdoc-payload.test.ts
// Ο καθαρός μεταφραστής «κανονικό έγγραφο → PURDOC payload» και οι προϋποθέσεις καταχώρισης.
import { describe, it, expect } from 'vitest';
import { emptyDocument, type DocumentJson } from '../canonical';
import { buildPurdocPayload, postingBlockers, type PurdocContext, type PostingDoc } from '../purdoc-payload';

const doc = (over: Partial<DocumentJson> = {}): DocumentJson => ({
  ...emptyDocument('invoice'),
  date: '2026-03-14',
  type: { label: 'ΤΙΜΟΛΟΓΙΟ', series: 'ΤΠΥ', number: '17', myDataType: null },
  totals: { net: 200, discount: null, vatAmount: 48, withholding: null, fees: null, total: 248, payable: 248 },
  digital: { mark: '400001', uid: 'ABC', authCode: null, provider: null, qr: null },
  lines: [
    { code: 'A1', name: 'Είδος Α', unit: null, quantity: 2, unitPrice: 50, discount: 0, net: 100, vatRate: 24, vatAmount: 24, total: 124, custom: {} },
    { code: 'B2', name: 'Υπηρεσία Β', unit: null, quantity: 1, unitPrice: 100, discount: 0, net: 100, vatRate: 24, vatAmount: 24, total: 124, custom: {} },
  ],
  ...over,
});

const ctx = (over: Partial<PurdocContext> = {}): PurdocContext => ({
  series: 7001,
  trdr: 12345,
  lines: [
    { rowIndex: 0, mtrl: 555, expn: null, isService: false },
    { rowIndex: 1, mtrl: 666, expn: null, isService: true },
  ],
  vatIdByRate: { 24: 1, 13: 2, 0: 4 },
  ...over,
});

const postingDoc = (over: Partial<PostingDoc> = {}): PostingDoc => ({
  status: 'COMPLETED',
  category: 'EXPENSE',
  softoneTrdr: 12345,
  softoneSeries: '7001',
  seriesSource: 1251,
  ...over,
});

describe('buildPurdocPayload', () => {
  it('χτίζει πλήρες payload: header + είδη + υπηρεσίες', () => {
    const payload = buildPurdocPayload(doc(), ctx({ comments: 'OCR' }));
    expect(payload).toEqual({
      OBJECT: 'PURDOC',
      KEY: '',
      DATA: {
        PURDOC: [{
          SERIES: 7001,
          TRNDATE: '2026-03-14',
          TRDR: 12345,
          FINCODE: '17',
          COMMENTS: 'OCR',
          MYDATAMARK: '400001',
          MYDATAUID: 'ABC',
        }],
        ITELINES: [{ LINENUM: 9000001, MTRL: 555, QTY1: 2, PRICE: 50, DISC1PRC: 0, VAT: 1, COMMENTS: 'Είδος Α' }],
        SRVLINES: [{ LINENUM: 9000001, MTRL: 666, QTY1: 1, PRICE: 100, DISC1PRC: 0, VAT: 1, COMMENTS: 'Υπηρεσία Β' }],
      },
    });
  });

  it('παραλείπει κενούς πίνακες και άδεια πεδία header', () => {
    const d = doc({
      digital: { mark: null, uid: null, authCode: null, provider: null, qr: null },
      lines: [doc().lines[0]],
    });
    const payload = buildPurdocPayload(d, ctx({ lines: [{ rowIndex: 0, mtrl: 555, expn: null, isService: false }] }));
    expect(payload.DATA.SRVLINES).toBeUndefined();
    expect(payload.DATA.EXPANAL).toBeUndefined();
    expect(payload.DATA.PURDOC[0]).not.toHaveProperty('MYDATAMARK');
    expect(payload.DATA.PURDOC[0]).not.toHaveProperty('COMMENTS');
  });

  it('τιμολόγιο μόνο με έξοδα → μόνο EXPANAL, με EXPVAL = καθαρή αξία', () => {
    const payload = buildPurdocPayload(doc(), ctx({
      lines: [
        { rowIndex: 0, mtrl: null, expn: 91, isService: null },
        { rowIndex: 1, mtrl: null, expn: 92, isService: null },
      ],
    }));
    expect(payload.DATA.ITELINES).toBeUndefined();
    expect(payload.DATA.SRVLINES).toBeUndefined();
    expect(payload.DATA.EXPANAL).toEqual([
      { LINENUM: 9000001, EXPN: 91, VAT: 1, EXPVAL: 100 },
      { LINENUM: 9000002, EXPN: 92, VAT: 1, EXPVAL: 100 },
    ]);
  });

  it('η ποσότητα λείπει → 1, η έκπτωση λείπει → 0, COMPANY μόνο όταν δοθεί', () => {
    const d = doc({
      lines: [{ ...doc().lines[0], quantity: null, discount: null }],
    });
    const payload = buildPurdocPayload(d, ctx({ company: 1001, lines: [{ rowIndex: 0, mtrl: 555, expn: null, isService: false }] }));
    expect(payload.DATA.ITELINES?.[0]).toMatchObject({ QTY1: 1, DISC1PRC: 0 });
    expect(payload.DATA.PURDOC[0]).toMatchObject({ COMPANY: 1001 });
  });
});

describe('postingBlockers', () => {
  it('πλήρες έγγραφο → κανένα εμπόδιο', () => {
    expect(postingBlockers(doc(), postingDoc(), ctx())).toEqual([]);
  });

  it('κατάσταση / κατηγορία / προμηθευτής / σειρά', () => {
    expect(postingBlockers(doc(), postingDoc({ status: 'PENDING' }), ctx())).toContain('not_completed');
    expect(postingBlockers(doc(), postingDoc({ category: null }), ctx())).toContain('no_category');
    expect(postingBlockers(doc(), postingDoc({ softoneTrdr: null }), ctx())).toContain('no_trader');
    expect(postingBlockers(doc(), postingDoc({ softoneSeries: null }), ctx())).toContain('no_series');
    expect(postingBlockers(doc(), postingDoc({ seriesSource: null }), ctx())).toContain('no_series');
  });

  it('ημερομηνία και αριθμός παραστατικού', () => {
    expect(postingBlockers(doc({ date: null }), postingDoc(), ctx())).toContain('no_date');
    expect(postingBlockers(doc({ type: { label: null, series: null, number: null, myDataType: null } }), postingDoc(), ctx()))
      .toContain('no_number');
  });

  it('γραμμή χωρίς είδος/έξοδο → unmatched_lines· καθόλου γραμμές → no_lines', () => {
    expect(postingBlockers(doc(), postingDoc(), ctx({ lines: [{ rowIndex: 0, mtrl: 555, expn: null, isService: false }] })))
      .toContain('unmatched_lines');
    expect(postingBlockers(doc({ lines: [] }), postingDoc(), ctx({ lines: [] }))).toContain('no_lines');
  });

  it('συντελεστής ΦΠΑ χωρίς κωδικό στο μητρώο → no_vat_category', () => {
    const d = doc({ lines: [{ ...doc().lines[0], vatRate: 17 }] });
    const c = ctx({ lines: [{ rowIndex: 0, mtrl: 555, expn: null, isService: false }] });
    expect(postingBlockers(d, postingDoc(), c)).toContain('no_vat_category');
    const noRate = doc({ lines: [{ ...doc().lines[0], vatRate: null }] });
    expect(postingBlockers(noRate, postingDoc(), c)).toContain('no_vat_category');
  });

  it('άθροισμα γραμμών ≠ καθαρή αξία πάνω από 0,05 → totals_mismatch', () => {
    const ok = doc({ totals: { ...doc().totals, net: 200.04 } });
    expect(postingBlockers(ok, postingDoc(), ctx())).not.toContain('totals_mismatch');
    const bad = doc({ totals: { ...doc().totals, net: 210 } });
    expect(postingBlockers(bad, postingDoc(), ctx())).toContain('totals_mismatch');
  });
});
