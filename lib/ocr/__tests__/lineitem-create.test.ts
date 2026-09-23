// lib/ocr/__tests__/lineitem-create.test.ts
// Οι κανόνες δημιουργίας χρεοπίστωσης — καθαρή λογική, χωρίς I/O.
//
// Τα νούμερα των τεστ είναι ΖΩΝΤΑΝΑ: διαβάστηκαν read-only από τις 207 ενεργές χρεοπιστώσεις της
// εγκατάστασης. Εκεί κρύβονται και τα δύο σφάλματα που αυτό το αρχείο υπάρχει για να αποτρέψει:
// 33 πρότυπα δεν επιτρέπουν πιστωτή, και 7 δεν έχουν καθόλου λογαριασμό γενικής.
import { describe, it, expect } from 'vitest';
import {
  parseLisourceType, lisourceAllows, checkLineItemTemplate, codeFollowsAccount,
  LINEITEM_COPY_FIELDS, LINEITEM_TEMPLATE_READ_FIELDS,
} from '../lineitem-create';

describe('«Κατηγορία τιμολόγησης» (LISOURCETYPE)', () => {
  it('διαβάζεται ως λίστα SODTYPE', () => {
    expect(parseLisourceType('12,13,14,15,16')).toEqual([12, 13, 14, 15, 16]);
    expect(parseLisourceType('12, 16')).toEqual([12, 16]);
    expect(parseLisourceType('14')).toEqual([14]);
  });

  it('ανέχεται σκουπίδια χωρίς να πετάει', () => {
    expect(parseLisourceType(null)).toEqual([]);
    expect(parseLisourceType('')).toEqual([]);
    expect(parseLisourceType('12,,x,16')).toEqual([12, 16]);
    expect(parseLisourceType(0)).toEqual([]);
  });

  it('απαντά αν επιτρέπει έναν τύπο', () => {
    expect(lisourceAllows('12,14', 16)).toBe(false);
    expect(lisourceAllows('12,16', 16)).toBe(true);
    // ΟΧΙ υποσυμβολοσειρά: το «1» δεν είναι μέσα στο «12,16».
    expect(lisourceAllows('12,16', 1)).toBe(false);
    expect(lisourceAllows('12,13,14,15,16', 6)).toBe(false);
  });
});

describe('κρίση προτύπου πριν χρησιμοποιηθεί', () => {
  const base = { templateLabel: 'ΧΡ01 — Δοκιμή', accountStatus: 'ok' as const, accountMessage: null };

  /**
   * ΤΟ ΚΑΡΦΙ. 24 από τις 207 ενεργές χρεοπιστώσεις έχουν «12,14» και 8 έχουν «14»: αντιγραμμένες
   * ως πρότυπο για παραστατικό ΠΙΣΤΩΤΗ γεννούν καρτέλα που δεν μπαίνει στη γραμμή — και αυτό είναι
   * ακριβώς το παραστατικό για το οποίο υπάρχει η ροή.
   */
  it('πρότυπο χωρίς τον απαιτούμενο τύπο απορρίπτεται, ονομάζοντας και τα δύο', () => {
    const r = checkLineItemTemplate({ ...base, lisourceType: '12,14', requiredSodtype: 16 });
    expect(r?.code).toBe('lisource_excludes_target');
    expect(r?.message).toContain('12');
    expect(r?.message).toContain('16');
    expect(r?.message).toContain('πιστωτής');
  });

  it('πρότυπο που τον περιλαμβάνει περνά', () => {
    expect(checkLineItemTemplate({ ...base, lisourceType: '12,16', requiredSodtype: 16 })).toBeNull();
    expect(checkLineItemTemplate({ ...base, lisourceType: '12,13,14,15,16', requiredSodtype: 15 })).toBeNull();
  });

  it('κενή κατηγορία τιμολόγησης απορρίπτεται — είναι required και δεν το εφευρίσκουμε', () => {
    expect(checkLineItemTemplate({ ...base, lisourceType: '', requiredSodtype: 16 })?.code).toBe('lisource_missing');
    expect(checkLineItemTemplate({ ...base, lisourceType: null, requiredSodtype: null })?.code).toBe('lisource_missing');
  });

  /** Άγνωστη σειρά ⇒ δεν ξέρουμε τι απαιτείται, άρα δεν κρίνουμε — ίδια στάση με τον τύπο καρτέλας. */
  it('άγνωστη σειρά δεν κρίνει την κατηγορία τιμολόγησης', () => {
    expect(checkLineItemTemplate({ ...base, lisourceType: '14', requiredSodtype: null })).toBeNull();
  });

  describe('ο λογαριασμός γενικής', () => {
    /**
     * 7 από τις 207 έχουν ΚΕΝΟ `ACNMSK`. Αντιγραμμένο στα τυφλά, γεννά χρεοπίστωση που ο ΔΙΚΟΣ μας
     * έλεγχος μπλοκάρει αμέσως με `account_missing` — και διορθώνεται μόνο μέσα στο SoftOne.
     */
    it('κενός / μάσκα / εκτός σχεδίου / μη κινούμενος ⇒ άρνηση', () => {
      for (const status of ['missing', 'mask', 'not_in_chart', 'not_postable'] as const) {
        const r = checkLineItemTemplate({ ...base, lisourceType: '12,16', requiredSodtype: 16, accountStatus: status });
        expect(r?.code).toBe('account_blocked');
      }
    });

    it('η διατύπωση ακολουθεί την πηγή του λογαριασμού', () => {
      const fromTemplate = checkLineItemTemplate({
        ...base, lisourceType: '12,16', requiredSodtype: 16, accountStatus: 'missing',
      });
      expect(fromTemplate?.message).toContain('του προτύπου');
      const chosen = checkLineItemTemplate({
        ...base, lisourceType: '12,16', requiredSodtype: 16, accountStatus: 'not_postable', accountChosen: true,
      });
      expect(chosen?.message).toContain('που διάλεξες');
      expect(chosen?.message).not.toContain('του προτύπου');
    });

    it('«άγνωστο» (ασυγχρόνιστο σχέδιο) ΔΕΝ είναι εμπόδιο', () => {
      expect(checkLineItemTemplate({
        ...base, lisourceType: '12,16', requiredSodtype: 16, accountStatus: 'unknown',
      })).toBeNull();
    });

    it('ανενεργός λογαριασμός δεν μπλοκάρει (υπάρχει και δέχεται)', () => {
      expect(checkLineItemTemplate({
        ...base, lisourceType: '12,16', requiredSodtype: 16, accountStatus: 'inactive',
      })).toBeNull();
    });

    /** Η κατηγορία τιμολόγησης κρίνεται ΠΡΩΤΗ: είναι το εμπόδιο που δεν φαίνεται πουθενά αλλού. */
    it('όταν φταίνε δύο πράγματα, αναφέρεται πρώτα η κατηγορία τιμολόγησης', () => {
      const r = checkLineItemTemplate({
        ...base, lisourceType: '14', requiredSodtype: 16, accountStatus: 'missing',
      });
      expect(r?.code).toBe('lisource_excludes_target');
    });
  });
});

describe('τι αντιγράφεται από το πρότυπο', () => {
  /**
   * Ο ΧΑΡΑΚΤΗΡΙΣΜΟΣ myDATA ΔΕΝ ΑΝΤΙΓΡΑΦΕΤΑΙ. Αν αντιγραφεί, μια νέα χρεοπίστωση ρεύματος
   * φτιαγμένη από πρότυπο «Έξοδα εκθέσεων» κληρονομεί ΕΚΕΙΝΟΝ τον χαρακτηρισμό — και επειδή το
   * `postingWarnings` προειδοποιεί μόνο όταν ΔΕΝ υπάρχει κανένας, η αντιγραφή σβήνει την
   * προειδοποίηση και στέλνει λάθος χαρακτηρισμό σιωπηλά.
   */
  it('ο χαρακτηρισμός myDATA λείπει ΕΠΙΤΗΔΕΣ από τα αντιγραφόμενα', () => {
    for (const f of ['MYDATACODE', 'CLASSTYPE', 'CLASSCATEGORY', 'MYDATAVPRC']) {
      expect(LINEITEM_COPY_FIELDS as readonly string[]).not.toContain(f);
    }
  });

  it('αντιγράφονται τα required πεδία της καρτέλας', () => {
    // `MTRTYPE1` είναι 1 σε 175 από τις 207 — το default 0 θα ήταν λάθος στις περισσότερες.
    for (const f of ['MTRTYPE', 'MTRTYPE1', 'KEPYO', 'LISOURCETYPE', 'MTRUNIT1']) {
      expect(LINEITEM_COPY_FIELDS as readonly string[]).toContain(f);
    }
  });

  it('διαβάζονται επιπλέον όσα κρίνουμε ή δείχνουμε', () => {
    for (const f of ['ACNMSK', 'VAT', 'MTRCATEGORY']) {
      expect(LINEITEM_TEMPLATE_READ_FIELDS as readonly string[]).toContain(f);
    }
    // Ό,τι αντιγράφεται πρέπει και να διαβάζεται.
    for (const f of LINEITEM_COPY_FIELDS) {
      expect(LINEITEM_TEMPLATE_READ_FIELDS as readonly string[]).toContain(f);
    }
  });
});

describe('η σύμβαση «κωδικός = λογαριασμός»', () => {
  const row = (code: string, acnmsk: string | null) => ({ code, acnmsk });

  /** Ζωντανά: 190 από τις 200 με λογαριασμό. Η σύμβαση κρατά καθαρά. */
  it('αναγνωρίζεται όταν κρατά', () => {
    const rows = [
      ...Array.from({ length: 190 }, (_, i) => row(`62.0${i}`, `62.0${i}`)),
      ...Array.from({ length: 10 }, (_, i) => row(`90000${i}`, `64.0${i}`)),
    ];
    const c = codeFollowsAccount(rows);
    expect(c).toMatchObject({ follows: true, matched: 190, total: 200 });
  });

  it('δεν αναγνωρίζεται όταν δεν κρατά — εγκατάσταση με δική της αρίθμηση δεν αλλάζει', () => {
    const rows = Array.from({ length: 100 }, (_, i) => row(`900${i}`, `62.0${i}`));
    expect(codeFollowsAccount(rows).follows).toBe(false);
  });

  /** Από τρεις γραμμές δεν βγαίνει σύμβαση — το 100 % ενός μικρού δείγματος δεν σημαίνει τίποτα. */
  it('μικρό δείγμα δεν παράγει σύμβαση', () => {
    expect(codeFollowsAccount([row('62.00', '62.00'), row('62.01', '62.01')]).follows).toBe(false);
    expect(codeFollowsAccount([]).follows).toBe(false);
  });

  it('οι χρεοπιστώσεις ΧΩΡΙΣ λογαριασμό δεν μετράνε καθόλου', () => {
    const rows = [
      ...Array.from({ length: 30 }, (_, i) => row(`62.0${i}`, `62.0${i}`)),
      ...Array.from({ length: 50 }, (_, i) => row(`90000${i}`, null)),
      ...Array.from({ length: 5 }, (_, i) => row(`X${i}`, '')),
    ];
    expect(codeFollowsAccount(rows)).toMatchObject({ follows: true, matched: 30, total: 30 });
  });

  it('η σύγκριση αγνοεί κενά και πεζά/κεφαλαία', () => {
    const rows = Array.from({ length: 25 }, (_, i) => row(` 62.0${i} `, `62.0${i}`));
    expect(codeFollowsAccount(rows).matched).toBe(25);
  });
});
