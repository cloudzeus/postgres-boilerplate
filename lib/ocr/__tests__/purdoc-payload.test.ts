// lib/ocr/__tests__/purdoc-payload.test.ts
// Ο καθαρός μεταφραστής «κανονικό έγγραφο → PURDOC payload» και οι προϋποθέσεις καταχώρισης.
import { describe, it, expect } from 'vitest';
import { emptyDocument, type DocumentJson } from '../canonical';
import { buildPurdocPayload, postingBlockers, postingWarnings, type PurdocContext, type PostingDoc } from '../purdoc-payload';
import { defaultPostingTarget, objectsForSosource, resolvePostingTarget, type PostingTarget } from '../posting-target';

/** Ο στόχος μιας σειράς αγοράς εμπορευμάτων: PURDOC με πίνακα ανά γραμμή (η σημερινή συμπεριφορά). */
const PURCHASE: PostingTarget = defaultPostingTarget({ sosource: 1251, name: 'Τιμολόγιο Αγοράς' });

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
  target: PURCHASE,
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
  seriesKnown: true,
  seriesEnabled: true,
  traderSodtype: 12,
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
    expect(payload.DATA.PURDOC?.[0]).not.toHaveProperty('MYDATAMARK');
    expect(payload.DATA.PURDOC?.[0]).not.toHaveProperty('COMMENTS');
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
    expect(payload.DATA.PURDOC?.[0]).toMatchObject({ COMPANY: 1001 });
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

// ============================================================
// Ο στόχος ανά σειρά — τι επιλέγεται όταν δεν το είπε ο χρήστης, και τι όταν το είπε
// ============================================================

describe('defaultPostingTarget', () => {
  it('1653 «Παραστατικά πιστωτών» → LINCREDOC / LINLINES', () => {
    expect(defaultPostingTarget({ sosource: 1653, name: 'Τιμολόγιο Δαπανών (Λήψη)' }))
      .toMatchObject({ object: 'LINCREDOC', lines: 'LINLINES', source: 'default', supported: true });
  });

  it('1253 «Λοιπές συναλλαγές προμηθευτών» → LINSUPDOC / LINLINES', () => {
    expect(defaultPostingTarget({ sosource: 1253, name: 'Δαπάνες' }))
      .toMatchObject({ object: 'LINSUPDOC', lines: 'LINLINES', supported: true });
  });

  it('1251 «Αγορές» → PURDOC / AUTO, ΑΝΕΞΑΡΤΗΤΑ από το πόσο «δαπάνη» ακούγεται η περιγραφή', () => {
    // Το SERIES μιας κεφαλίδας ανήκει σε ΜΙΑ ενότητα: μια σειρά αγορών δεν γίνεται ποτέ ειδική
    // συναλλαγή, όσο κι αν λέγεται «Τιμολόγιο Λήψης Υπηρεσιών».
    for (const name of ['Τιμολόγιο Αγοράς', 'Τιμολόγιο Δαπανών ΚΕ.Π.Υ.Ο', 'Τιμολόγιο Λήψης Υπηρεσιών', 'Αγορά Παγίων']) {
      expect(defaultPostingTarget({ sosource: 1251, name }))
        .toMatchObject({ object: 'PURDOC', lines: 'AUTO', supported: true });
    }
  });

  it('άγνωστη ενότητα → ΔΕΝ υποστηρίζεται (δεν μαντεύουμε object)', () => {
    expect(defaultPostingTarget({ sosource: 1261 })).toMatchObject({ supported: false });
    expect(defaultPostingTarget({ sosource: null })).toMatchObject({ supported: false });
  });

  it('objectsForSosource: ένα object ανά ενότητα, κενό για τις υπόλοιπες', () => {
    expect(objectsForSosource(1251)).toEqual(['PURDOC']);
    expect(objectsForSosource(1253)).toEqual(['LINSUPDOC']);
    expect(objectsForSosource(1653)).toEqual(['LINCREDOC']);
    expect(objectsForSosource(1261)).toEqual([]);
  });

  it('τα πάγια ΔΕΝ προσφέρονται (λείπουν WHOUSE/ASSDEPR και μητρώο παγίων)', () => {
    expect(resolvePostingTarget({ sosource: 1251, postLines: 'ASSLINES' }))
      .toMatchObject({ object: 'PURDOC', lines: 'AUTO', source: 'default' });
  });
});

describe('resolvePostingTarget', () => {
  it('η ρύθμιση πίνακα γραμμών νικά την προεπιλογή', () => {
    expect(resolvePostingTarget({ sosource: 1251, name: 'Τιμολόγιο Αγοράς', postLines: 'ITELINES' }))
      .toMatchObject({ object: 'PURDOC', lines: 'ITELINES', source: 'configured' });
  });

  it('ρύθμιση object εκτός ενότητας αγνοείται — ποτέ σειρά 1251 σε LINSUPDOC', () => {
    const t = resolvePostingTarget({ sosource: 1251, postObject: 'LINSUPDOC', postLines: 'LINLINES' });
    expect(t).toMatchObject({ object: 'PURDOC', lines: 'AUTO', source: 'default' });
    expect(t.reason).toMatch(/αγνοήθηκε/);
  });

  it('πίνακας που δεν υπάρχει στο object → η προεπιλογή, ποτέ σκουπίδι', () => {
    expect(resolvePostingTarget({ sosource: 1653, postLines: 'EXPANAL' }))
      .toMatchObject({ object: 'LINCREDOC', lines: 'LINLINES' });
  });

  it('άκυρες τιμές αγνοούνται και ισχύει η προεπιλογή', () => {
    expect(resolvePostingTarget({ sosource: 1653, postObject: 'ΧΑΖΟ', postLines: 'ΚΑΤΙ' }))
      .toMatchObject({ object: 'LINCREDOC', lines: 'LINLINES', source: 'default' });
  });

  it('μη υποστηριζόμενη ενότητα μένει μη υποστηριζόμενη ό,τι κι αν ρυθμιστεί', () => {
    expect(resolvePostingTarget({ sosource: 1261, postObject: 'PURDOC', postLines: 'ITELINES' }))
      .toMatchObject({ supported: false });
  });
});

const LINSUP: PostingTarget = defaultPostingTarget({ sosource: 1253 });

describe('buildPurdocPayload — LINLINES / ASSLINES', () => {
  it('LINSUPDOC: κεφαλίδα στο δικό της κλειδί, γραμμές με MTRL χρεοπίστωσης και MTRTYPE', () => {
    const payload = buildPurdocPayload(doc(), ctx({
      target: LINSUP,
      lines: [
        { rowIndex: 0, lin: 777, linMtrType: 1 },
        { rowIndex: 1, lin: 778, linMtrType: 0 },
      ],
    }));
    expect(payload.OBJECT).toBe('LINSUPDOC');
    expect(payload.DATA.PURDOC).toBeUndefined();
    expect(payload.DATA.LINSUPDOC?.[0]).toMatchObject({ SERIES: 7001, TRDR: 12345, FINCODE: '17' });
    expect(payload.DATA.LINLINES).toEqual([
      { LINENUM: 9000001, MTRL: 777, MTRTYPE: 1, QTY1: 2, PRICE: 50, DISC1PRC: 0, NETLINEVAL: 100, VAT: 1, COMMENTS: 'Είδος Α' },
      { LINENUM: 9000002, MTRL: 778, MTRTYPE: 0, QTY1: 1, PRICE: 100, DISC1PRC: 0, NETLINEVAL: 100, VAT: 1, COMMENTS: 'Υπηρεσία Β' },
    ]);
  });

  it('γραμμή που δεν χωράει στον πίνακα ΔΕΝ μπαίνει στο payload (και γίνεται εμπόδιο)', () => {
    const c = ctx({ target: LINSUP, lines: [{ rowIndex: 0, mtrl: 555 }, { rowIndex: 1, lin: 778, linMtrType: 0 }] });
    const payload = buildPurdocPayload(doc(), c);
    expect(payload.DATA.LINLINES).toHaveLength(1);
    expect(payload.DATA.ITELINES).toBeUndefined();
    expect(postingBlockers(doc(), postingDoc(), c)).toContain('lines_need_lineitem');
  });

  // Το `MTRL.MYDATACODE` είναι ο μικρός enum κωδικός του `$s1ClassType` («1», «7» στον tenant),
  // όχι το αλφαριθμητικό του MYDATACLTYPE — περνάει αυτούσιο στη γραμμή.
  it('MYDATACODE μόνο εκεί όπου ο πίνακας το έχει', () => {
    const item = buildPurdocPayload(doc(), ctx({ lines: [{ rowIndex: 0, mtrl: 555, myDataCode: '1' }] }));
    expect(item.DATA.ITELINES?.[0]).toMatchObject({ MYDATACODE: '1' });
    const lin = buildPurdocPayload(doc(), ctx({ target: LINSUP, lines: [{ rowIndex: 0, lin: 777, linMtrType: 0, myDataCode: '7' }] }));
    expect(lin.DATA.LINLINES?.[0]).not.toHaveProperty('MYDATACODE');
  });
});

describe('postingBlockers — στόχος', () => {
  it('χρεοπίστωση σε σειρά PURDOC/AUTO → lines_lineitem_unsupported', () => {
    const c = ctx({ lines: [{ rowIndex: 0, lin: 777 }, { rowIndex: 1, lin: 778 }] });
    expect(postingBlockers(doc(), postingDoc(), c)).toContain('lines_lineitem_unsupported');
  });

  it('έξοδο σε σειρά με πίνακα ειδών → lines_need_mtrl', () => {
    const c = ctx({
      target: resolvePostingTarget({ sosource: 1251, postLines: 'ITELINES' }),
      lines: [{ rowIndex: 0, expn: 91 }, { rowIndex: 1, expn: 92 }],
    });
    expect(postingBlockers(doc(), postingDoc(), c)).toContain('lines_need_mtrl');
  });

  it('χρεοπίστωση χωρίς MTRTYPE → lines_no_mtrtype', () => {
    const c = ctx({ target: LINSUP, lines: [{ rowIndex: 0, lin: 777 }, { rowIndex: 1, lin: 778, linMtrType: 0 }] });
    expect(postingBlockers(doc(), postingDoc(), c)).toContain('lines_no_mtrtype');
  });

  it('γραμμή αντιστοιχισμένη σε χρεοπίστωση ΔΕΝ μετράει ως unmatched', () => {
    const c = ctx({ target: LINSUP, lines: [{ rowIndex: 0, lin: 777, linMtrType: 0 }, { rowIndex: 1, lin: 778, linMtrType: 0 }] });
    expect(postingBlockers(doc(), postingDoc(), c)).not.toContain('unmatched_lines');
  });
});

describe('postingWarnings', () => {
  it('μητρώο χωρίς χαρακτηρισμό myDATA → προειδοποίηση, όχι εμπόδιο', () => {
    const c = ctx({ lines: [{ rowIndex: 0, mtrl: 555, noClassification: true }, { rowIndex: 1, mtrl: 666 }] });
    expect(postingWarnings(c)).toContain('no_mydata_classification');
    expect(postingBlockers(doc(), postingDoc(), c)).toEqual([]);
  });

  it('LINLINES / EXPANAL → ο χαρακτηρισμός έρχεται από το μητρώο', () => {
    expect(postingWarnings(ctx({ target: LINSUP, lines: [{ rowIndex: 0, lin: 777, linMtrType: 0 }] })))
      .toContain('mydata_from_master');
    expect(postingWarnings(ctx({ lines: [{ rowIndex: 0, mtrl: 555 }] })))
      .not.toContain('mydata_from_master');
  });
});

describe('postingBlockers — σειρά και συναλλασσόμενος', () => {
  it('σειρά εκτός μητρώου → series_unknown (δεν σιωπά πίσω από την προεπιλογή)', () => {
    expect(postingBlockers(doc(), postingDoc({ seriesKnown: false }), ctx())).toContain('series_unknown');
    expect(postingBlockers(doc(), postingDoc({ seriesEnabled: false }), ctx())).toContain('series_unknown');
  });

  it('ενότητα χωρίς υποστηριζόμενο object → series_module_unsupported', () => {
    const c = ctx({ target: defaultPostingTarget({ sosource: 1261 }) });
    expect(postingBlockers(doc(), postingDoc({ seriesSource: 1261 }), c)).toContain('series_module_unsupported');
  });

  // Το read-back ΔΕΝ μπορεί να το πιάσει: συγκρίνει το TRDR με ό,τι στείλαμε.
  it('προμηθευτής (12) σε σειρά πιστωτών → trader_kind_mismatch', () => {
    const c = ctx({ target: defaultPostingTarget({ sosource: 1653 }), lines: [{ rowIndex: 0, lin: 7, linMtrType: 0 }, { rowIndex: 1, lin: 8, linMtrType: 0 }] });
    expect(postingBlockers(doc(), postingDoc({ seriesSource: 1653, traderSodtype: 12 }), c)).toContain('trader_kind_mismatch');
    expect(postingBlockers(doc(), postingDoc({ seriesSource: 1653, traderSodtype: 16 }), c)).not.toContain('trader_kind_mismatch');
  });

  it('πιστωτής (16) σε παραστατικό αγορών → trader_kind_mismatch', () => {
    expect(postingBlockers(doc(), postingDoc({ traderSodtype: 16 }), ctx())).toContain('trader_kind_mismatch');
  });

  it('άγνωστος τύπος συναλλασσομένου → ΔΕΝ κρίνουμε', () => {
    expect(postingBlockers(doc(), postingDoc({ traderSodtype: null }), ctx())).not.toContain('trader_kind_mismatch');
  });
});

describe('αναλυτική ανά γραμμή (κέντρο κόστους / έργο / δραστηριότητα)', () => {
  const AN = { costCntr: 3, prjc: 4, prjcStage: 5 };

  it('ITELINES: στέλνονται και τα τρία όταν έχουν οριστεί', () => {
    const payload = buildPurdocPayload(doc(), ctx({ lines: [{ rowIndex: 0, mtrl: 555, ...AN }] }));
    expect(payload.DATA.ITELINES?.[0]).toMatchObject({ COSTCNTR: 3, PRJC: 4, PRJCSTAGE: 5 });
  });

  it('LINLINES: στέλνονται και εκεί', () => {
    const payload = buildPurdocPayload(doc(), ctx({
      target: LINSUP, lines: [{ rowIndex: 0, lin: 777, linMtrType: 0, ...AN }],
    }));
    expect(payload.DATA.LINLINES?.[0]).toMatchObject({ COSTCNTR: 3, PRJC: 4, PRJCSTAGE: 5 });
  });

  // Το EXPANAL ΔΕΝ έχει τα πεδία: ό,τι κι αν κρατά η γραμμή, δεν φεύγει — και το UI το λέει.
  it('EXPANAL: ΔΕΝ στέλνεται τίποτα από την αναλυτική', () => {
    const payload = buildPurdocPayload(doc(), ctx({ lines: [{ rowIndex: 0, expn: 91, ...AN }] }));
    const row = payload.DATA.EXPANAL?.[0] as Record<string, unknown>;
    expect(row).not.toHaveProperty('COSTCNTR');
    expect(row).not.toHaveProperty('PRJC');
    expect(row).not.toHaveProperty('PRJCSTAGE');
  });

  it('κενά / μηδενικά δεν μπαίνουν καθόλου στο payload', () => {
    const payload = buildPurdocPayload(doc(), ctx({
      lines: [{ rowIndex: 0, mtrl: 555, costCntr: null, prjc: 0, prjcStage: undefined }],
    }));
    const row = payload.DATA.ITELINES?.[0] as Record<string, unknown>;
    expect(row).not.toHaveProperty('COSTCNTR');
    expect(row).not.toHaveProperty('PRJC');
    expect(row).not.toHaveProperty('PRJCSTAGE');
  });

  it('η αναλυτική ΔΕΝ εμποδίζει ποτέ: κενή γραμμή περνά χωρίς εμπόδιο', () => {
    expect(postingBlockers(doc(), postingDoc(), ctx())).toEqual([]);
  });
});
