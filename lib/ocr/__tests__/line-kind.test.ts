// lib/ocr/__tests__/line-kind.test.ts
// «Τι είδους εγγραφή χρειάζεται αυτή η γραμμή;» — καθαρή λογική, χωρίς I/O.
//
// Ο κανόνας που ελέγχεται εδώ είναι ένας: ΧΩΡΙΣ απόδειξη, καμία δήλωση. Το παλιό
// «όλα είναι Προϊόν» ήταν ισχυρισμός, όχι προεπιλογή.
import { describe, it, expect } from 'vitest';
import { inferLineKind, looksLikeService, KIND_FOR_LINE_TABLE } from '../line-kind';

describe('χωρίς απόδειξη → χωρίς κατηγορία', () => {
  it('σκέτη περιγραφή δεν αρκεί για κανέναν τύπο', () => {
    expect(inferLineKind({ sample: 'ΨΩΜΙ' })).toBeNull();
    expect(inferLineKind({ sample: 'Google Cloud - Fee for April 2026' })).toBeNull();
    expect(inferLineKind({})).toBeNull();
  });

  it('ασύμφωνοι προορισμοί ⇒ κανένας τύπος (η ομάδα δεν έχει έναν προορισμό)', () => {
    expect(inferLineKind({ lineTables: ['LINLINES', 'EXPANAL'] })).toBeNull();
  });

  it('ο προορισμός «ανά γραμμή» (AUTO) δεν λέει τίποτα', () => {
    expect(inferLineKind({ lineTables: ['AUTO'] })).toBeNull();
  });

  /**
   * Η ΑΓΝΩΣΤΗ σειρά είναι διαφωνία, όχι σιωπή: ένα γνωστό παραστατικό ΔΕΝ αποφασίζει για μια
   * ομάδα που εμφανίζεται και σε παραστατικά των οποίων τον προορισμό δεν ξέρουμε.
   */
  it('έστω ΕΝΑ άγνωστο παραστατικό ακυρώνει τον κανόνα του προορισμού', () => {
    expect(inferLineKind({ lineTables: ['LINLINES', null] })).toBeNull();
    expect(inferLineKind({ lineTables: [null, 'EXPANAL', null, null] })).toBeNull();
    expect(inferLineKind({ lineTables: [null] })).toBeNull();
  });

  /**
   * `ITELINES` και `SRVLINES` δέχονται ΚΑΙ ΤΑ ΔΥΟ οποιοδήποτε `MTRL` (είδος **ή** υπηρεσία) —
   * δες `lineFits` / `lines_need_mtrl`. Άρα δεν ορίζουν μητρώο και δεν δηλώνουν τύπο.
   */
  it('ITELINES / SRVLINES δεν ξεχωρίζουν είδος από υπηρεσία ⇒ κανένας τύπος', () => {
    expect(inferLineKind({ lineTables: ['ITELINES'] })).toBeNull();
    expect(inferLineKind({ lineTables: ['SRVLINES'] })).toBeNull();
    expect(inferLineKind({ lineTables: ['ITELINES', 'SRVLINES'] })).toBeNull();
  });
});

describe('ιεραρχία αποδείξεων', () => {
  it('η μνήμη είναι η ισχυρότερη — νικά ακόμη και τον προορισμό', () => {
    expect(inferLineKind({ memoryKind: 'product', lineTables: ['LINLINES'] })).toBe('product');
  });

  it('ήδη ταιριασμένη υπηρεσία σε γραμμή της ομάδας', () => {
    expect(inferLineKind({ matchedService: true })).toBe('service');
  });

  // Μόνο οι δύο πίνακες που ΟΡΙΖΟΥΝ μητρώο: `LINLINES` ⇒ χρεοπίστωση, `EXPANAL` ⇒ έξοδο.
  it('ο προορισμός της σειράς ΕΙΝΑΙ δομή του ERP, όχι εικασία', () => {
    expect(inferLineKind({ lineTables: ['LINLINES'] })).toBe('lineitem');
    expect(inferLineKind({ lineTables: ['EXPANAL'] })).toBe('expense');
    expect(inferLineKind({ lineTables: ['LINLINES', 'LINLINES'] })).toBe('lineitem');
  });

  it('αναμφισβήτητη λέξη υπηρεσίας — τελευταία και μόνη γλωσσική ένδειξη', () => {
    expect(inferLineKind({ sample: 'ΠΑΡΟΧΗ ΥΠΗΡΕΣΙΩΝ ΣΥΝΤΗΡΗΣΗΣ' })).toBe('service');
    expect(inferLineKind({ sample: 'Consulting service — April' })).toBe('service');
  });
});

describe('looksLikeService — σκόπιμα ΣΤΕΝΟ', () => {
  it('πιάνει μόνο ρητή «υπηρεσία»', () => {
    expect(looksLikeService('Υπηρεσία φιλοξενίας')).toBe(true);
    expect(looksLikeService('ΥΠΗΡΕΣΙΕΣ ΚΑΘΑΡΙΟΤΗΤΑΣ')).toBe(true);
  });

  it('ΔΕΝ πιάνει διφορούμενες λέξεις που μπορεί να είναι έξοδο ή χρεοπίστωση', () => {
    for (const s of ['ΗΛΕΚΤΡΙΚΟ ΡΕΥΜΑ', 'ΕΝΟΙΚΙΟ ΓΡΑΦΕΙΟΥ', 'Συνδρομή Netflix', 'ΜΕΤΑΦΟΡΙΚΑ']) {
      expect(looksLikeService(s)).toBe(false);
    }
  });
});

describe('ο χάρτης πίνακα → μητρώο είναι ΠΛΗΡΗΣ', () => {
  it('κάθε πίνακας γραμμών έχει ρητή απάντηση (ακόμη κι αν είναι «δεν ξέρω»)', () => {
    expect(KIND_FOR_LINE_TABLE).toEqual({
      AUTO: null,
      // Δέχονται και τα δύο οποιοδήποτε MTRL (είδος ή υπηρεσία) — δεν ορίζουν μητρώο.
      ITELINES: null,
      SRVLINES: null,
      EXPANAL: 'expense',
      LINLINES: 'lineitem',
    });
  });
});
