// lib/ocr/__tests__/purdoc-payload.test.ts
// Ο καθαρός μεταφραστής «κανονικό έγγραφο → PURDOC payload» και οι προϋποθέσεις καταχώρισης.
import { describe, it, expect } from 'vitest';
import { emptyDocument, type DocumentJson } from '../canonical';
import {
  buildPurdocPayload, documentReference, postingBlockers, postingWarnings,
  type PurdocContext, type PostingDoc,
} from '../purdoc-payload';
import {
  defaultPostingTarget, objectsForSosource, resolvePostingTarget, seriesTraderKind,
  LINES_FOR_OBJECT, POST_OBJECT_SHORT, SODTYPE_FOR_OBJECT, type PostingTarget,
} from '../posting-target';

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
          FINCODE: 'ΤΠΥ 17',
          TAXSERIES: 'ΤΠΥ',
          TAXSERIESNUM: '17',
          COMMENTS: 'OCR',
          MYDATAMARK: '400001',
          MYDATAUID: 'ABC',
        }],
        ITELINES: [{ LINENUM: 9000001, MTRL: 555, QTY1: 2, PRICE: 50, VAT: 1, COMMENTS: 'Είδος Α' }],
        SRVLINES: [{ LINENUM: 9000001, MTRL: 666, QTY1: 1, PRICE: 100, VAT: 1, COMMENTS: 'Υπηρεσία Β' }],
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
    // Χωρίς έκπτωση δεν στέλνεται ΚΑΝΕΝΑ πεδίο έκπτωσης: ένα `DISC1PRC: 0` είναι αβλαβές, αλλά
    // η παρουσία του πεδίου ήταν αυτή που έκρυβε ότι εκεί γραφόταν ΠΟΣΟ αντί για ποσοστό.
    expect(payload.DATA.ITELINES?.[0]).toMatchObject({ QTY1: 1 });
    expect(payload.DATA.ITELINES?.[0]).not.toHaveProperty('DISC1PRC');
    expect(payload.DATA.ITELINES?.[0]).not.toHaveProperty('DISC1VAL');
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

  it('1553 «Λοιπές συναλλαγές χρεωστών» → LINDEBDOC / LINLINES', () => {
    // Η αρίθμηση είναι `1<οντότητα><είδος>`: 5 = χρεώστες, 53 = λοιπές (ειδικές) συναλλαγές —
    // ο ίδιος συνδυασμός με το 1253 των προμηθευτών.
    expect(defaultPostingTarget({ sosource: 1553, name: 'Τιμολόγιο Δαπανών' }))
      .toMatchObject({ object: 'LINDEBDOC', lines: 'LINLINES', source: 'default', supported: true });
  });

  it('η αιτιολογία ονομάζει τη ΣΩΣΤΗ ενότητα ανά object — όχι δυαδικά', () => {
    // Ένα ternary «LINCREDOC ; αλλιώς 1253» θα έλεγε σε σειρά χρεωστών ότι ανήκει στους
    // προμηθευτές. Η αιτιολογία φαίνεται στην κάρτα προεπισκόπησης, άρα πρέπει να λέει αλήθεια.
    expect(defaultPostingTarget({ sosource: 1553 }).reason).toContain('1553');
    expect(defaultPostingTarget({ sosource: 1553 }).reason).toContain('χρεωστών');
    expect(defaultPostingTarget({ sosource: 1253 }).reason).toContain('1253');
    expect(defaultPostingTarget({ sosource: 1653 }).reason).toContain('1653');
  });

  it('κάθε LIN*DOC δέχεται ΜΟΝΟ LINLINES, με δικό του SODTYPE — καμία εφεύρεση πίνακα', () => {
    const want = { LINSUPDOC: 12, LINCREDOC: 16, LINDEBDOC: 15 } as const;
    for (const object of ['LINSUPDOC', 'LINCREDOC', 'LINDEBDOC'] as const) {
      expect(LINES_FOR_OBJECT[object]).toEqual(['LINLINES']);
      expect(POST_OBJECT_SHORT[object]).toMatch(/^Ειδικές συναλλαγές /);
      expect(SODTYPE_FOR_OBJECT[object]).toBe(want[object]);
    }
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
    expect(defaultPostingTarget({ sosource: 1351 })).toMatchObject({ supported: false });
    expect(defaultPostingTarget({ sosource: null })).toMatchObject({ supported: false });
  });

  it('objectsForSosource: ένα object ανά ενότητα, κενό για τις υπόλοιπες', () => {
    expect(objectsForSosource(1251)).toEqual(['PURDOC']);
    expect(objectsForSosource(1253)).toEqual(['LINSUPDOC']);
    expect(objectsForSosource(1553)).toEqual(['LINDEBDOC']);
    expect(objectsForSosource(1653)).toEqual(['LINCREDOC']);
    expect(objectsForSosource(1351)).toEqual([]);
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
    expect(resolvePostingTarget({ sosource: 1351, postObject: 'PURDOC', postLines: 'ITELINES' }))
      .toMatchObject({ supported: false });
  });

  it('το LINDEBDOC ΔΕΝ διασχίζει ενότητες — ρύθμιση εκτός ενότητας αγνοείται και εδώ', () => {
    // Ο κανόνας του B2 ισχύει και για τον χρεώστη: το object το ορίζει η ΕΝΟΤΗΤΑ. Μια σειρά
    // πιστωτών ρυθμισμένη σε LINDEBDOC θα έστελνε αριθμό σειράς 1653 σε παραστατικό 1553.
    const t = resolvePostingTarget({ sosource: 1653, postObject: 'LINDEBDOC' });
    expect(t).toMatchObject({ object: 'LINCREDOC', lines: 'LINLINES', source: 'default' });
    expect(t.reason).toMatch(/αγνοήθηκε/);
    // Και το αντίστροφο: σειρά χρεωστών δεν γίνεται ποτέ παραστατικό αγορών.
    expect(resolvePostingTarget({ sosource: 1553, postObject: 'PURDOC', postLines: 'ITELINES' }))
      .toMatchObject({ object: 'LINDEBDOC', lines: 'LINLINES' });
  });
});

describe('seriesTraderKind — η πλευρά μιας ενότητας', () => {
  it('βγαίνει από τον ΙΔΙΟ πίνακα προεπιλογών με την καταχώριση', () => {
    expect(seriesTraderKind(1653)).toBe('creditor');
    expect(seriesTraderKind(1553)).toBe('debtor');
    // Αγορές και ειδικές συναλλαγές προμηθευτών είναι η ΙΔΙΑ πλευρά.
    expect(seriesTraderKind(1251)).toBe('purchase');
    expect(seriesTraderKind(1253)).toBe('purchase');
    // Άγνωστη ενότητα δεν εφευρίσκει πλευρά — πέφτει στη γενική.
    expect(seriesTraderKind(9999)).toBe('purchase');
  });
});

const LINSUP: PostingTarget = defaultPostingTarget({ sosource: 1253 });
const LINDEB: PostingTarget = defaultPostingTarget({ sosource: 1553 });
const LINCRE: PostingTarget = defaultPostingTarget({ sosource: 1653 });

describe('buildPurdocPayload — LINLINES', () => {
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
    expect(payload.DATA.LINSUPDOC?.[0]).toMatchObject({ SERIES: 7001, TRDR: 12345, FINCODE: 'ΤΠΥ 17', TAXSERIES: 'ΤΠΥ', TAXSERIESNUM: '17' });
    expect(payload.DATA.LINLINES).toEqual([
      { LINENUM: 9000001, MTRL: 777, MTRTYPE: 1, QTY1: 2, PRICE: 50, NETLINEVAL: 100, VAT: 1, COMMENTS: 'Είδος Α' },
      { LINENUM: 9000002, MTRL: 778, MTRTYPE: 0, QTY1: 1, PRICE: 100, NETLINEVAL: 100, VAT: 1, COMMENTS: 'Υπηρεσία Β' },
    ]);
  });

  it('γραμμή που δεν χωράει στον πίνακα ΔΕΝ μπαίνει στο payload (και γίνεται εμπόδιο)', () => {
    const c = ctx({ target: LINSUP, lines: [{ rowIndex: 0, mtrl: 555 }, { rowIndex: 1, lin: 778, linMtrType: 0 }] });
    const payload = buildPurdocPayload(doc(), c);
    expect(payload.DATA.LINLINES).toHaveLength(1);
    expect(payload.DATA.ITELINES).toBeUndefined();
    expect(postingBlockers(doc(), postingDoc(), c)).toContain('lines_need_lineitem');
  });

  it('LINDEBDOC: ίδιο σχήμα με τους δύο αδελφούς του, μόνο άλλο κλειδί κεφαλίδας', () => {
    const lines = [
      { rowIndex: 0, lin: 777, linMtrType: 1 },
      { rowIndex: 1, lin: 778, linMtrType: 0 },
    ];
    const deb = buildPurdocPayload(doc(), ctx({ target: LINDEB, lines }));
    const sup = buildPurdocPayload(doc(), ctx({ target: LINSUP, lines }));

    expect(deb.OBJECT).toBe('LINDEBDOC');
    expect(deb.DATA.LINDEBDOC?.[0]).toMatchObject({
      SERIES: 7001, TRNDATE: '2026-03-14', TRDR: 12345, FINCODE: 'ΤΠΥ 17', TAXSERIES: 'ΤΠΥ', TAXSERIESNUM: '17',
      MYDATAMARK: '400001', MYDATAUID: 'ABC',
    });
    // Το SODTYPE είναι read-only με default στο SoftOne — ΔΕΝ το στέλνουμε ποτέ.
    expect(deb.DATA.LINDEBDOC?.[0]).not.toHaveProperty('SODTYPE');
    expect(deb.DATA.LINSUPDOC).toBeUndefined();
    expect(deb.DATA.PURDOC).toBeUndefined();
    // Οι γραμμές είναι ΑΠΑΡΑΛΛΑΚΤΕΣ — ο πίνακας LINLINES είναι κοινός στα τρία objects.
    expect(deb.DATA.LINLINES).toEqual(sup.DATA.LINLINES);
    expect(deb.DATA.LINLINES).toHaveLength(2);
  });

  it('LINDEBDOC: τα ίδια εμπόδια με τους αδελφούς του — καμία γραμμή δεν χάνεται σιωπηλά', () => {
    const c = ctx({ target: LINDEB, lines: [{ rowIndex: 0, mtrl: 555 }, { rowIndex: 1, lin: 778, linMtrType: 0 }] });
    expect(buildPurdocPayload(doc(), c).DATA.LINLINES).toHaveLength(1);
    expect(postingBlockers(doc(), postingDoc({ seriesSource: 1553 }), c)).toContain('lines_need_lineitem');

    // Χρεοπίστωση χωρίς MTRTYPE στο μητρώο: εμπόδιο, όχι μαντεψιά.
    const noType = ctx({ target: LINDEB, lines: [{ rowIndex: 0, lin: 777, linMtrType: null }, { rowIndex: 1, lin: 778, linMtrType: 0 }] });
    expect(postingBlockers(doc(), postingDoc({ seriesSource: 1553 }), noType)).toContain('lines_no_mtrtype');

    // Ο πίνακας LINLINES δεν έχει πεδίο χαρακτηρισμού — ο χρήστης πρέπει να το ξέρει.
    expect(postingWarnings(ctx({ target: LINDEB, lines: [{ rowIndex: 0, lin: 777, linMtrType: 0 }] })))
      .toContain('mydata_from_master');
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
    const c = ctx({ target: defaultPostingTarget({ sosource: 1351 }) });
    expect(postingBlockers(doc(), postingDoc({ seriesSource: 1351 }), c)).toContain('series_module_unsupported');
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

  it('σειρά ΧΡΕΩΣΤΩΝ απαιτεί χρεώστη (15) — προμηθευτής ή πιστωτής είναι λάθος εγγραφή', () => {
    const c = ctx({ target: defaultPostingTarget({ sosource: 1553 }), lines: [{ rowIndex: 0, lin: 7, linMtrType: 0 }, { rowIndex: 1, lin: 8, linMtrType: 0 }] });
    const blockers = (traderSodtype: number) =>
      postingBlockers(doc(), postingDoc({ seriesSource: 1553, traderSodtype }), c);
    expect(blockers(15)).not.toContain('trader_kind_mismatch');
    expect(blockers(12)).toContain('trader_kind_mismatch');
    expect(blockers(16)).toContain('trader_kind_mismatch');
    // …και το 1553 ΕΙΝΑΙ υποστηριζόμενη ενότητα: δεν μπλοκάρεται ως άγνωστη.
    expect(blockers(15)).not.toContain('series_module_unsupported');
  });

  it('χρεώστης (15) σε σειρά πιστωτών ή αγορών → trader_kind_mismatch', () => {
    const cred = ctx({ target: defaultPostingTarget({ sosource: 1653 }), lines: [{ rowIndex: 0, lin: 7, linMtrType: 0 }, { rowIndex: 1, lin: 8, linMtrType: 0 }] });
    expect(postingBlockers(doc(), postingDoc({ seriesSource: 1653, traderSodtype: 15 }), cred)).toContain('trader_kind_mismatch');
    expect(postingBlockers(doc(), postingDoc({ traderSodtype: 15 }), ctx())).toContain('trader_kind_mismatch');
  });
});

describe('αναλυτική ανά γραμμή (κέντρο κόστους / έργο / δραστηριότητα)', () => {
  const AN = { costCntr: 3, prjc: 4, prjcStage: 5 };

  it('ITELINES: στέλνονται και τα τρία όταν έχουν οριστεί', () => {
    const payload = buildPurdocPayload(doc(), ctx({ lines: [{ rowIndex: 0, mtrl: 555, ...AN }] }));
    expect(payload.DATA.ITELINES?.[0]).toMatchObject({ COSTCNTR: 3, PRJC: 4, PRJCSTAGE: 5 });
  });

  it('LINLINES: στέλνονται και εκεί — και στα ΤΡΙΑ objects ειδικών συναλλαγών', () => {
    // Η αναλυτική κρέμεται από τον ΠΙΝΑΚΑ ΓΡΑΜΜΩΝ, όχι από το object: αφού και τα τρία
    // LIN*DOC γράφουν LINLINES, ο χρεώστης δεν χρειάζεται τίποτα ξεχωριστό — αλλά το κλειδώνουμε,
    // ώστε μια μελλοντική «εξαίρεση ανά object» να σπάσει εδώ και όχι σιωπηλά στο ERP.
    for (const target of [LINSUP, LINCRE, LINDEB]) {
      const payload = buildPurdocPayload(doc(), ctx({
        target, lines: [{ rowIndex: 0, lin: 777, linMtrType: 0, ...AN }],
      }));
      expect(payload.DATA.LINLINES?.[0]).toMatchObject({ COSTCNTR: 3, PRJC: 4, PRJCSTAGE: 5 });
    }
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

describe('documentReference — η αναφορά του εκδότη στα τρία της πεδία', () => {
  it('πρόθεμα χωριστά: «ΤΠΥ» + «17» → Φορ/κή σειρά / Φορ/κός αριθμός / πλήρες «ΤΠΥ 17»', () => {
    expect(documentReference({ series: 'ΤΠΥ', number: '17' }))
      .toEqual({ taxSeries: 'ΤΠΥ', taxSeriesNum: '17', fincode: 'ΤΠΥ 17' });
  });

  it('πρόθεμα ΜΕΣΑ στον αριθμό: δεν διπλασιάζεται («ΤΠΥ ΤΠΥ 17» ποτέ)', () => {
    expect(documentReference({ series: 'ΤΠΥ', number: 'ΤΠΥ 17' }))
      .toEqual({ taxSeries: 'ΤΠΥ', taxSeriesNum: '17', fincode: 'ΤΠΥ 17' });
    // Ίδιο πρόθεμα με άλλο διαχωριστικό — η σύγκριση αγνοεί κενά/παύλες/τελείες.
    expect(documentReference({ series: 'ΤΙΜ-AA', number: 'ΤΙΜ AA-2455' }))
      .toEqual({ taxSeries: 'ΤΙΜ-AA', taxSeriesNum: '2455', fincode: 'ΤΙΜ AA-2455' });
  });

  it('χωρίς πρόθεμα: ΟΛΗ η τυπωμένη αναφορά μένει ακέραιη, δεν μαντεύουμε σειρά', () => {
    expect(documentReference({ series: null, number: 'INV.239124' }))
      .toEqual({ taxSeriesNum: 'INV.239124', fincode: 'INV.239124' });
    expect(documentReference({ series: '', number: '276708' }))
      .toEqual({ taxSeriesNum: '276708', fincode: '276708' });
  });

  it('πρόθεμα που ΜΟΙΑΖΕΙ αλλά δεν είναι: ενώνονται, δεν κόβεται τίποτα', () => {
    expect(documentReference({ series: 'ΤΠΥ', number: 'ΤΙΜ 17' }))
      .toEqual({ taxSeries: 'ΤΠΥ', taxSeriesNum: 'ΤΙΜ 17', fincode: 'ΤΠΥ ΤΙΜ 17' });
  });

  it('ελληνικά/λατινικά ομόγλυφα: το πρόθεμα ΔΕΝ γράφεται δύο φορές', () => {
    // Η ΠΡΑΓΜΑΤΙΚΗ γραμμή 1042 του πελάτη είναι «ΤΙΜ-AA-2455» με ΕΛΛΗΝΙΚΟ «ΤΙΜ» και ΛΑΤΙΝΙΚΟ
    // «AA» στο ίδιο string. Το OCR μπορεί κάλλιστα να δώσει τη σειρά με ελληνικά «Α»: χωρίς
    // δίπλωμα ομογλύφων το πρόθεμα δεν αναγνωριζόταν και γραφόταν «ΤΙΜ-ΑΑ ΤΙΜ-AA-2455».
    expect(documentReference({ series: 'ΤΙΜ-ΑΑ', number: 'ΤΙΜ-AA-2455' }))
      .toEqual({ taxSeries: 'ΤΙΜ-ΑΑ', taxSeriesNum: '2455', fincode: 'ΤΙΜ-AA-2455' });
    // Και αντίστροφα (σειρά λατινική, αριθμός ελληνικός).
    expect(documentReference({ series: 'ΤΙΜ-AA', number: 'ΤΙΜ-ΑΑ-2455' }))
      .toEqual({ taxSeries: 'ΤΙΜ-AA', taxSeriesNum: '2455', fincode: 'ΤΙΜ-ΑΑ-2455' });
    // Ο τόνος δεν σπάει τη σύγκριση ούτε χάνεται χαρακτήρας.
    expect(documentReference({ series: 'ΤΊΜ', number: 'ΤΙΜ 42' }))
      .toEqual({ taxSeries: 'ΤΊΜ', taxSeriesNum: '42', fincode: 'ΤΙΜ 42' });
  });

  it('ο αριθμός είναι σκέτο το πρόθεμα: ο «Φορ/κός αριθμός» ΔΕΝ μένει κενός', () => {
    // Κενό πεδίο σημαίνει ότι το ERP βάζει εκεί τον ΔΙΚΟ ΜΑΣ αύξοντα (γραμμές 1009/1034) και ότι
    // ο έλεγχος διπλοεγγραφής παρακάμπτεται εντελώς.
    expect(documentReference({ series: 'ΤΔΑ', number: 'ΤΔΑ' }))
      .toEqual({ taxSeries: 'ΤΔΑ', taxSeriesNum: 'ΤΔΑ', fincode: 'ΤΔΑ' });
  });

  it('κενό έγγραφο → κανένα πεδίο (και άρα καμία κενή τιμή στην κεφαλίδα)', () => {
    expect(documentReference({ series: null, number: null })).toEqual({});
    expect(documentReference({ series: 'ΤΠΥ', number: null })).toEqual({ taxSeries: 'ΤΠΥ' });
  });

  it('το «Παραστατικό» χωράει 30 χαρακτήρες: προτιμά τον αριθμό από μια κομμένη σειρά', () => {
    const series = 'ΣΕΙΡΑ-ΜΕ-ΠΟΛΥ-ΜΕΓΑΛΟ-ΟΝΟΜΑ';
    const r = documentReference({ series, number: '2455' });
    expect(r.taxSeries).toBe(series);
    expect(r.taxSeriesNum).toBe('2455');
    expect(r.fincode).toBe('2455');
    expect((r.fincode ?? '').length).toBeLessThanOrEqual(30);
  });
});

describe('αναφορά εκδότη στην κεφαλίδα — και στα τέσσερα objects', () => {
  const targets = { PURDOC: PURCHASE, LINSUPDOC: LINSUP, LINCREDOC: LINCRE, LINDEBDOC: LINDEB } as const;
  const lineCtx = { rowIndex: 0, mtrl: null, expn: null, lin: 777, linMtrType: 1 };
  const oneLine = (d: DocumentJson): DocumentJson => ({ ...d, lines: [d.lines[0]] });

  for (const [object, target] of Object.entries(targets)) {
    it(`${object}: ΤΑΞΣΕΙΡΑ + ΦΟΡ/ΚΟΣ ΑΡΙΘΜΟΣ + ΠΑΡΑΣΤΑΤΙΚΟ, ΠΟΤΕ SERIESNUM`, () => {
      const isPurdoc = object === 'PURDOC';
      const payload = buildPurdocPayload(
        oneLine(doc()),
        ctx({ target, lines: [isPurdoc ? { rowIndex: 0, mtrl: 555, expn: null } : lineCtx] }),
      );
      const header = (payload.DATA as Record<string, Record<string, unknown>[]>)[object][0];
      expect(header).toMatchObject({ FINCODE: 'ΤΠΥ 17', TAXSERIES: 'ΤΠΥ', TAXSERIESNUM: '17' });
      // Ο δικός μας αύξων τον δίνει το ERP — δεν τον στέλνουμε ποτέ.
      expect(header).not.toHaveProperty('SERIESNUM');
    });
  }

  it('αριθμός με ενσωματωμένο πρόθεμα: το «Παραστατικό» κρατά την τυπωμένη μορφή', () => {
    const payload = buildPurdocPayload(
      oneLine(doc({ type: { label: null, series: 'ΤΙΜ Α32', number: 'ΤΙΜ Α32-000085237', myDataType: null } })),
      ctx({ lines: [{ rowIndex: 0, mtrl: 555, expn: null }] }),
    );
    expect(payload.DATA.PURDOC?.[0]).toMatchObject({
      FINCODE: 'ΤΙΜ Α32-000085237', TAXSERIES: 'ΤΙΜ Α32', TAXSERIESNUM: '000085237',
    });
  });

  it('χωρίς σειρά: η «Φορ/κή σειρά» μένει άγραφη αντί να μαντευτεί', () => {
    const payload = buildPurdocPayload(
      oneLine(doc({ type: { label: null, series: null, number: 'INV.239124', myDataType: null } })),
      ctx({ lines: [{ rowIndex: 0, mtrl: 555, expn: null }] }),
    );
    const header = payload.DATA.PURDOC?.[0];
    expect(header).toMatchObject({ FINCODE: 'INV.239124', TAXSERIESNUM: 'INV.239124' });
    expect(header).not.toHaveProperty('TAXSERIES');
  });
});

/* ------------------------------------------------------------------ */
/* ΕΠΙΜΕΡΙΣΜΟΣ γραμμής σε πολλούς λογαριασμούς                         */
/* ------------------------------------------------------------------ */

/** Σειρά πιστωτών: ό,τι φεύγει, φεύγει ως `LINLINES` — ο μόνος πίνακας που δέχεται χρεοπίστωση. */
const CREDITORS: PostingTarget = defaultPostingTarget({ sosource: 1653, name: 'Τιμολόγιο Δαπανών' });

const oneLineDoc = (): DocumentJson => ({
  ...doc(),
  totals: { net: 1055, discount: null, vatAmount: 253.2, withholding: null, fees: null, total: 1308.2, payable: 1308.2 },
  lines: [{
    code: null, name: 'ΜΙΣΘΟΔΟΣΙΑ ΙΟΥΛΙΟΥ', unit: null, quantity: 1, unitPrice: 1055, discount: 0,
    net: 1055, vatRate: 24, vatAmount: 253.2, total: 1308.2, custom: {},
  }],
});

const splitCtx = (over: Partial<PurdocContext> = {}): PurdocContext => ({
  target: CREDITORS,
  series: 1001,
  trdr: 45,
  lines: [{
    rowIndex: 0,
    allocations: [
      { registryMtrl: 3308, mtrType: 1, amount: 351.63, percent: 33.33, label: '64.02.06.0099 — Φιλοξενία' },
      { registryMtrl: 2946, mtrType: 1, amount: 703.37, percent: 66.67, label: '64.01.00.0000 — Ταξίδια' },
    ],
  }],
  vatIdByRate: { 24: 1 },
  ...over,
});

describe('επιμερισμός → γραμμές LINLINES', () => {
  const linesOf = (c: PurdocContext = splitCtx()) =>
    (buildPurdocPayload(oneLineDoc(), c).DATA as any).LINLINES as any[];

  it('ΜΙΑ γραμμή παραστατικού γίνεται N γραμμές, μία ανά λογαριασμό', () => {
    const lin = linesOf();
    expect(lin).toHaveLength(2);
    expect(lin.map((r) => r.MTRL)).toEqual([3308, 2946]);
    expect(lin.map((r) => r.NETLINEVAL)).toEqual([351.63, 703.37]);
  });

  it('τα ποσά των γραμμών αθροίζουν ΑΚΡΙΒΩΣ στο καθαρό της αρχικής', () => {
    const sum = Math.round(linesOf().reduce((t, r) => t + r.NETLINEVAL, 0) * 100) / 100;
    expect(sum).toBe(1055);
  });

  it('ποσότητα 1 και τιμή = το ποσό: μοιράζεται η ΑΞΙΑ, όχι τα τεμάχια', () => {
    expect(linesOf()[0]).toMatchObject({ QTY1: 1, PRICE: 351.63, DISC1PRC: 0, MTRTYPE: 1 });
  });

  it('το σχόλιο κουβαλά το ποσοστό — αλλιώς η γραμμή στο ERP είναι ανεξήγητη', () => {
    const lin = linesOf();
    expect(lin[0].COMMENTS).toContain('33,33%');
    expect(lin[1].COMMENTS).toContain('66,67%');
  });

  it('οι αριθμοί γραμμής είναι συνεχόμενοι', () => {
    const lin = linesOf();
    expect(lin[1].LINENUM - lin[0].LINENUM).toBe(1);
  });

  it('ο ΦΠΑ της αρχικής γραμμής περνά σε ΚΑΘΕ κομμάτι', () => {
    expect(linesOf().every((r) => r.VAT === 1)).toBe(true);
  });
});

describe('επιμερισμός → έλεγχοι πριν την καταχώριση', () => {
  const creditorDoc = () => postingDoc({ softoneSeries: '1001', seriesSource: 1653, traderSodtype: 16, softoneTrdr: 45 });

  it('επιμερισμένη γραμμή ΔΕΝ είναι «χωρίς αντιστοίχιση»', () => {
    expect(postingBlockers(oneLineDoc(), creditorDoc(), splitCtx())).not.toContain('unmatched_lines');
  });

  it('χρεοπίστωση επιμερισμού χωρίς MTRTYPE μπλοκάρει', () => {
    const c = splitCtx();
    c.lines[0].allocations![1].mtrType = null;
    expect(postingBlockers(oneLineDoc(), creditorDoc(), c)).toContain('lines_no_mtrtype');
  });

  it('επιμερισμός σε σειρά που ΔΕΝ στέλνει LINLINES δεν πέφτει σιωπηλά', () => {
    const c = splitCtx({ target: PURCHASE });
    const codes = postingBlockers(oneLineDoc(), postingDoc(), c);
    expect(codes.length).toBeGreaterThan(0);
    const data = buildPurdocPayload(oneLineDoc(), c).DATA as any;
    expect(data.ITELINES ?? []).toHaveLength(0);
    expect(data.SRVLINES ?? []).toHaveLength(0);
  });
});
