// Σχόλιο «τι αφορά», μηνύματα SoftOne σε γλώσσα χρήστη, χειροκίνητη επεξεργασία γραμμών (καθαρά).
import { describe, it, expect } from 'vitest';
import { clip, periodText, postingComment } from '../posting-comment';
import { explainSoftoneError, oversizedFields } from '../softone-error-text';
import { computeNet, planLineEdit, type LineValues } from '../line-edit';
import { normalizeDocument } from '../canonical';

const doc = (over: Record<string, unknown>) => normalizeDocument({ kind: 'invoice', lines: [], ...over });

describe('postingComment — τι αφορά, όχι το ελεύθερο κείμενο του χαρτιού', () => {
  it('λογαριασμός κοινής ωφέλειας: τίτλος + περίοδος', () => {
    const d = doc({ notes: 'Ο λογαριασμός σας παρουσιάζει προηγούμενο ανεξόφλητο υπόλοιπο…'.repeat(5), references: { period: { from: '2026-08-28', to: '2026-09-29' } } });
    expect(postingComment(d, { utilityTitle: 'Λογαριασμός ρεύματος' })).toBe('Λογαριασμός ρεύματος · 28/08–29/09/2026');
  });
  it('χωρίς τίτλο: οι δύο μεγαλύτερες γραμμές + πόσες ακόμη', () => {
    const d = doc({ lines: [
      { name: 'Cloud VPS I', net: 6.25 }, { name: 'Cloud VPS V', net: 43 }, { name: 'Cloud VPS 20', net: 7 }, { name: 'Cloud VPS 10', net: 4.5 },
    ] });
    expect(postingComment(d)).toBe('Cloud VPS V, Cloud VPS 20 +2');
  });
  it('ο χρήστης το ορίζει ο ίδιος (custom.postingComment)', () => {
    expect(postingComment(doc({ custom: { postingComment: 'Φιλοξενία site Ιουνίου' } }))).toBe('Φιλοξενία site Ιουνίου');
  });
  it('ποτέ πάνω από 255 χαρακτήρες', () => {
    expect(clip('λέξη '.repeat(100)).length).toBeLessThanOrEqual(255);
    expect(periodText('2025-12-28', '2026-01-27')).toBe('28/12/2025–27/01/2026');
  });
});

describe('explainSoftoneError', () => {
  it('Range Error ⇒ «δεν χωρά» + ποιο πεδίο', () => {
    const e = explainSoftoneError("SoftOne Range Error (Name: '')", { DATA: { LINCREDOC: [{ COMMENTS: 'x'.repeat(380) }] } });
    expect(e.title).toMatch(/δεν χωρά/);
    expect(e.action).toMatch(/LINCREDOC\.COMMENTS: 380\/255/);
  });
  it('ελλιπή πεδία ⇒ ονομάζει τα πεδία και τι να κάνεις', () => {
    const e = explainSoftoneError('Δεν έχετε συμπληρώσει τα παρακάτω πεδία:\nΈξοδο\nΕπιβαρύνει ');
    expect(e.title).toMatch(/«Έξοδο», «Επιβαρύνει»/);
    expect(e.action).toMatch(/στήλη «SoftOne»/);
  });
  it('record not found ⇒ συγχρονισμός μητρώων', () => {
    expect(explainSoftoneError('Selected record with key: 115601 not found!').title).toMatch(/115601/);
  });
  it('oversizedFields: μόνο όσα ξεπερνούν', () => {
    expect(oversizedFields({ DATA: { PURDOC: [{ COMMENTS: 'ok', FINCODE: '1'.repeat(31) }] } })).toEqual(['PURDOC.FINCODE: 31/30 χαρακτήρες']);
  });
});

describe('planLineEdit', () => {
  const L = (name: string, net: number): LineValues => ({ name, code: null, unit: null, quantity: 1, unitPrice: net, discount: 0, net, vatRate: 0 });
  const cur = [L('A', 6.25), L('B', 7), L('C', 4.5)];

  it('προσθήκη της γραμμής που λείπει (43,00) στο τέλος', () => {
    const p = planLineEdit(cur, { add: [{ name: 'Cloud VPS V AS SSD', code: null, unit: null, quantity: 1, unitPrice: 43, discount: 0, net: null, vatRate: 0 }] });
    expect(p.errors).toEqual([]);
    expect(p.lines).toHaveLength(4);
    expect(p.lines[3]).toMatchObject({ from: null, values: { net: 43 } });
  });
  it('αφαίρεση μεσαίας γραμμής: οι επόμενες μετακινούνται (κρατούν τη δική τους εγγραφή)', () => {
    const p = planLineEdit(cur, { remove: [1] });
    expect(p.removed).toEqual([1]);
    expect([...p.moved.entries()]).toEqual([[0, 0], [2, 1]]);
  });
  it('αλλαγή περιγραφής ⇒ η αυτόματη αντιστοίχιση ξαναγίνεται· αλλαγή ποσού όχι', () => {
    expect(planLineEdit(cur, { update: [{ rowIndex: 0, name: 'Άλλο' }] }).identityChanged).toEqual([0]);
    expect(planLineEdit(cur, { update: [{ rowIndex: 0, net: 8 }] }).identityChanged).toEqual([]);
  });
  it('σφάλματα: ανύπαρκτη γραμμή, χωρίς περιγραφή, καμία γραμμή', () => {
    expect(planLineEdit(cur, { remove: [9] }).errors.length).toBe(1);
    expect(planLineEdit(cur, { update: [{ rowIndex: 0, name: ' ' }] }).errors.length).toBe(1);
    expect(planLineEdit(cur, { remove: [0, 1, 2] }).errors).toContain('Το παραστατικό πρέπει να έχει τουλάχιστον μία γραμμή.');
  });
  it('computeNet = ποσ. × τιμή × (1 − έκπτ.%)', () => {
    expect(computeNet(2, 10, 25)).toBe(15);
    expect(computeNet(null, 10, 0)).toBeNull();
  });
});
