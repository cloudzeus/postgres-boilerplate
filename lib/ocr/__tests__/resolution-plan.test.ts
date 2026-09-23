// lib/ocr/__tests__/resolution-plan.test.ts
// «Τι πρέπει να λύσει ο χρήστης και σε ποιο μητρώο» — καθαρή λογική, χωρίς I/O.
//
// Ο κανόνας που κλειδώνεται εδώ: ο ΠΡΟΟΡΙΣΜΟΣ της σειράς ορίζει και τον τύπο καρτέλας και τα
// επιτρεπτά μητρώα γραμμής. Άγνωστος προορισμός ⇒ καμία δήλωση — ποτέ «προμηθευτής» ή «είδος»
// από συνήθεια.
import { describe, it, expect } from 'vitest';
import {
  requiredTraderForTarget, allowedLineKinds, defaultLineKind, lineKindFits,
  commonLineKind, lineKindsReason, KINDS_FOR_LINE_TABLE,
} from '../resolution-plan';
import {
  SODTYPE_FOR_OBJECT, SODTYPE_FOR_TRADER_KIND, TRADER_KIND_FOR_OBJECT, POST_OBJECTS, POST_LINE_TABLES,
  resolvePostingTarget, type PostingTarget, type PostObject, type PostLineTable,
} from '../posting-target';
import { lineFits, type PurdocLineCtx } from '../purdoc-payload';
import type { MatchKind } from '@/lib/ocr/line-match';

const target = (object: PostObject, lines: PostLineTable, supported = true): PostingTarget =>
  ({ object, lines, source: 'default', supported, reason: 'δοκιμή' });

describe('προορισμός → απαιτούμενος τύπος καρτέλας', () => {
  it('παραστατικό πιστωτών ζητά ΠΙΣΤΩΤΗ (16), όχι προμηθευτή', () => {
    const r = requiredTraderForTarget(target('LINCREDOC', 'LINLINES'));
    expect(r).toMatchObject({ kind: 'creditor', sodtype: 16, label: 'πιστωτής', labelAcc: 'πιστωτή' });
  });

  it('αγορές και ειδικές συναλλαγές προμηθευτών ζητούν ΠΡΟΜΗΘΕΥΤΗ (12)', () => {
    expect(requiredTraderForTarget(target('PURDOC', 'AUTO'))).toMatchObject({ kind: 'supplier', sodtype: 12 });
    expect(requiredTraderForTarget(target('LINSUPDOC', 'LINLINES'))).toMatchObject({ kind: 'supplier', sodtype: 12 });
  });

  it('ειδικές συναλλαγές χρεωστών ζητούν ΧΡΕΩΣΤΗ (15)', () => {
    expect(requiredTraderForTarget(target('LINDEBDOC', 'LINLINES'))).toMatchObject({ kind: 'debtor', sodtype: 15 });
  });

  /**
   * Χωρίς σειρά δεν ξέρουμε πού καταχωρείται, άρα δεν ξέρουμε ούτε τι καρτέλα θέλει. Μια
   * προεπιλογή «προμηθευτής» εδώ θα γεννούσε λάθος καρτέλα ΜΕΣΑ στο ERP — που δεν ξεγίνεται.
   */
  it('άγνωστος ή μη υποστηριζόμενος προορισμός ⇒ null', () => {
    expect(requiredTraderForTarget(null)).toBeNull();
    expect(requiredTraderForTarget(undefined)).toBeNull();
    expect(requiredTraderForTarget(target('PURDOC', 'AUTO', false))).toBeNull();
  });

  it('η πραγματική σειρά του παραστατικού «energa» (ενότητα 1653) ζητά πιστωτή', () => {
    const t = resolvePostingTarget({ sosource: 1653 });
    expect(t).toMatchObject({ object: 'LINCREDOC', lines: 'LINLINES', supported: true });
    expect(requiredTraderForTarget(t)?.kind).toBe('creditor');
  });
});

/**
 * Το `lib/softone.ts` (server-only) **επανεξάγει** αυτόν ακριβώς τον χάρτη ως
 * `TRADER_KIND_SODTYPE`, αντί να κρατά αντίγραφο: δύο αντίγραφα αποκλίνουν σιωπηλά και το UI θα
 * πρόσφερε άλλον τύπο από αυτόν που δημιουργεί ο server. Εδώ κλειδώνεται ο ΔΕΥΤΕΡΟΣ δρόμος —
 * object → τύπος → SODTYPE — να συμφωνεί με το object → SODTYPE.
 */
describe('οι δύο δρόμοι προς το SODTYPE συμφωνούν', () => {
  it('κάθε object δείχνει στο ίδιο SODTYPE από τους δύο δρόμους', () => {
    for (const o of POST_OBJECTS) {
      expect(SODTYPE_FOR_TRADER_KIND[TRADER_KIND_FOR_OBJECT[o]]).toBe(SODTYPE_FOR_OBJECT[o]);
    }
  });
});

describe('προορισμός → επιτρεπτά μητρώα γραμμής', () => {
  it('LINLINES δέχεται ΜΟΝΟ χρεοπίστωση', () => {
    expect(allowedLineKinds(target('LINCREDOC', 'LINLINES'))).toEqual(['lineitem']);
    expect(lineKindFits(target('LINCREDOC', 'LINLINES'), 'product')).toBe(false);
    expect(lineKindFits(target('LINCREDOC', 'LINLINES'), 'expense')).toBe(false);
    expect(lineKindFits(target('LINCREDOC', 'LINLINES'), 'lineitem')).toBe(true);
  });

  it('EXPANAL δέχεται ΜΟΝΟ έξοδο', () => {
    expect(allowedLineKinds(target('PURDOC', 'EXPANAL'))).toEqual(['expense']);
  });

  /** Οι δύο πίνακες δέχονται ΚΑΙ ΟΙ ΔΥΟ οποιοδήποτε MTRL — «είδος ή υπηρεσία», όχι «είδος». */
  it('ITELINES / SRVLINES δέχονται είδος ΚΑΙ υπηρεσία', () => {
    expect(allowedLineKinds(target('PURDOC', 'ITELINES'))).toEqual(['product', 'service']);
    expect(allowedLineKinds(target('PURDOC', 'SRVLINES'))).toEqual(['product', 'service']);
  });

  /** Το PURDOC δεν έχει πίνακα για χρεοπίστωση (`autoTableFor` → null). */
  it('AUTO δέχεται είδος / υπηρεσία / έξοδο — ΟΧΙ χρεοπίστωση', () => {
    expect(allowedLineKinds(target('PURDOC', 'AUTO'))).toEqual(['product', 'service', 'expense']);
    expect(lineKindFits(target('PURDOC', 'AUTO'), 'lineitem')).toBe(false);
  });

  it('άγνωστος προορισμός ⇒ κενή λίστα, και τίποτα δεν κρίνεται ως λάθος', () => {
    expect(allowedLineKinds(null)).toEqual([]);
    expect(lineKindFits(null, 'product')).toBe(true);
    expect(lineKindFits(null, 'lineitem')).toBe(true);
  });
});

describe('ποιο μητρώο ανοίγει ο picker', () => {
  /**
   * Η ρίζα του «δεν δουλεύει σωστά»: το παραστατικό της ENERGA άνοιγε στο «Είδος» επειδή καμία
   * γραμμή δεν ήταν αντιστοιχισμένη και η παλιά `commonKind` επέστρεφε σταθερά `'product'`.
   */
  it('ένας μόνο επιτρεπτός τύπος ⇒ αυτός, ό,τι κι αν λέει το ιστορικό του παραστατικού', () => {
    expect(defaultLineKind(target('LINCREDOC', 'LINLINES'), null)).toBe('lineitem');
    expect(defaultLineKind(target('LINCREDOC', 'LINLINES'), 'product')).toBe('lineitem');
    expect(defaultLineKind(target('PURDOC', 'EXPANAL'), 'product')).toBe('expense');
  });

  it('πολλοί επιτρεπτοί ⇒ η ένδειξη του παραστατικού, αν χωράει', () => {
    expect(defaultLineKind(target('PURDOC', 'AUTO'), 'expense')).toBe('expense');
    expect(defaultLineKind(target('PURDOC', 'ITELINES'), 'service')).toBe('service');
  });

  it('ένδειξη που ΔΕΝ χωράει αγνοείται — και δεν αντικαθίσταται με εικασία', () => {
    expect(defaultLineKind(target('PURDOC', 'ITELINES'), 'expense')).toBeNull();
    expect(defaultLineKind(target('PURDOC', 'AUTO'), 'lineitem')).toBeNull();
  });

  it('χωρίς ένδειξη και με πολλές επιλογές ⇒ null («διάλεξε μητρώο»), ποτέ «Είδος»', () => {
    expect(defaultLineKind(target('PURDOC', 'AUTO'), null)).toBeNull();
    expect(defaultLineKind(null, null)).toBeNull();
  });

  it('άγνωστος προορισμός με ένδειξη ⇒ η ένδειξη', () => {
    expect(defaultLineKind(null, 'service')).toBe('service');
  });
});

describe('η πιο συχνή ήδη αντιστοιχισμένη κατηγορία', () => {
  it('μετράει μόνο τις αντιστοιχισμένες', () => {
    expect(commonLineKind(['expense', 'expense', 'product', null, undefined])).toBe('expense');
  });
  it('καμία αντιστοίχιση ⇒ null (όχι «product»)', () => {
    expect(commonLineKind([null, null])).toBeNull();
    expect(commonLineKind([])).toBeNull();
  });
});

describe('η ελληνική εξήγηση', () => {
  it('λέει τον πίνακα και τι δέχεται', () => {
    expect(lineKindsReason(target('LINCREDOC', 'LINLINES'))).toContain('LINLINES');
    expect(lineKindsReason(target('LINCREDOC', 'LINLINES'))).toContain('χρεοπίστωση');
    // Το «AUTO» είναι εσωτερικό όνομα — ο χρήστης διαβάζει τι σημαίνει, όχι τον κωδικό.
    expect(lineKindsReason(target('PURDOC', 'AUTO'))).toContain('ή έξοδο');
    expect(lineKindsReason(target('PURDOC', 'AUTO'))).not.toContain('AUTO');
    expect(lineKindsReason(target('PURDOC', 'AUTO'))).toContain('Κάθε γραμμή');
  });
  it('άγνωστος προορισμός το λέει ρητά', () => {
    expect(lineKindsReason(null)).toContain('Άγνωστος');
  });
});

describe('ο πίνακας επιτρεπτών καλύπτει κάθε στόχο', () => {
  it('κάθε PostLineTable έχει εγγραφή', () => {
    for (const t of ['AUTO', 'ITELINES', 'SRVLINES', 'EXPANAL', 'LINLINES'] as PostLineTable[]) {
      expect(KINDS_FOR_LINE_TABLE[t].length).toBeGreaterThan(0);
    }
  });
});

/**
 * ⚠️ Ο ΛΟΓΟΣ ΥΠΑΡΞΗΣ ΑΥΤΟΥ ΤΟΥ ΤΕΣΤ.
 *
 * Δύο συναρτήσεις απαντούν στην ΙΔΙΑ ερώτηση από αντίθετες μεριές: το `lineFits`
 * (`purdoc-payload.ts`) κρίνει μια **ήδη γραμμένη** αντιστοίχιση τη στιγμή της καταχώρισης, και το
 * `KINDS_FOR_LINE_TABLE` **προσφέρει** τις επιλογές στον χρήστη πριν γράψει. Αν αποκλίνουν, το UI
 * αφήνει τον χρήστη να διαλέξει κάτι που η καταχώριση θα απορρίψει — δηλαδή ακριβώς το αδιέξοδο
 * που αυτή η δουλειά έλυσε, ξαναγεννημένο σιωπηλά από μια μελλοντική αλλαγή.
 *
 * Η ισοδυναμία ζούσε μέχρι τώρα μόνο σε σχόλιο. Εδώ ελέγχεται στο ΠΛΗΡΕΣ καρτεσιανό γινόμενο.
 */
describe('η προσφορά ταυτίζεται με την κρίση (lineFits ↔ KINDS_FOR_LINE_TABLE)', () => {
  /** Μια αντιστοίχιση όπως θα την έγραφε ο χρήστης για κάθε μητρώο. */
  const ctxFor = (kind: MatchKind): PurdocLineCtx => ({
    rowIndex: 0,
    mtrl: kind === 'product' || kind === 'service' ? 1 : null,
    expn: kind === 'expense' ? 1 : null,
    lin: kind === 'lineitem' ? 1 : null,
    isService: kind === 'service',
  });

  const KINDS: MatchKind[] = ['product', 'service', 'expense', 'lineitem'];

  it('κάθε (πίνακας × μητρώο) συμφωνεί', () => {
    for (const table of POST_LINE_TABLES) {
      for (const kind of KINDS) {
        expect(
          { table, kind, fits: lineFits(table, ctxFor(kind)) },
        ).toEqual(
          { table, kind, fits: KINDS_FOR_LINE_TABLE[table].includes(kind) },
        );
      }
    }
  });

  it('…και το ίδιο ισχύει μέσω του `lineKindFits`, που βλέπει το UI', () => {
    for (const object of POST_OBJECTS) {
      for (const table of POST_LINE_TABLES) {
        for (const kind of KINDS) {
          const t = target(object, table);
          expect({ table, kind, fits: lineKindFits(t, kind) })
            .toEqual({ table, kind, fits: lineFits(table, ctxFor(kind)) });
        }
      }
    }
  });
});
