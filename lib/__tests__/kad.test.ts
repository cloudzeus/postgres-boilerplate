// lib/__tests__/kad.test.ts — ΚΑΔ ΑΑΔΕ → μητρώο ΚΑΔ SoftOne. Συνθετικές γραμμές, με τις ΙΔΙΕΣ
// συγκρούσεις κωδικών που έχει ένα μητρώο παλιάς ονοματολογίας απέναντι στους νέους ΚΑΔ της ΑΑΔΕ.
import { describe, it, expect } from 'vitest';
import {
  buildKadIndex, resolveKad, resolveTraderKads, normalizeKadCode, formatAadeKad, kadStems, kadNameScore,
  type KadRow,
} from '@/lib/kad';
import { kadPayload } from '@/components/admin/kad-field';

const ROWS: KadRow[] = [
  { id: 10, code: '46.72', name: 'Χονδρικό εμπόριο μετάλλων και μεταλλευμάτων', isActive: true },
  { id: 11, code: '45.31.11', name: 'Χονδρικό εμπόριο επισώτρων (ελαστικών οχημάτων) και εσωτερικών αεροθαλάμων επισώτρων', isActive: true },
  { id: 12, code: '45.32.11', name: 'Λιανικό εμπόριο επισώτρων (ελαστικών οχημάτων) και εσωτερικών αεροθαλάμων επισώτρων', isActive: true },
  { id: 13, code: '61.9', name: 'Άλλες τηλεπικοινωνιακές δραστηριότητες', isActive: true },
  { id: 14, code: '61.90.00.00', name: 'Άλλες υπηρεσίες τηλεπικοινωνιών', isActive: true },
  { id: 15, code: '46.71.11.02', name: 'Χονδρικό εμπόριο γαιανθράκων', isActive: true },
  { id: 16, code: '45.11.11.02', name: 'Χονδρικό εμπόριο αυτοκινούμενων τροχόσπιτων με εμβολοφόρο κινητήρα', isActive: true },
  { id: 17, code: '35.11', name: 'Παραγωγή ηλεκτρικής ενέργειας', isActive: false },
];
const idx = buildKadIndex(ROWS);

describe('normalize / format', () => {
  it('ο κωδικός συγκρίνεται χωρίς τελείες και μηδενικά ουράς', () => {
    expect(normalizeKadCode('46.72')).toBe('4672');
    expect(normalizeKadCode('46720000')).toBe('4672');
    expect(normalizeKadCode('61.90.00.00')).toBe('619');
  });
  it('ο κωδικός ΑΑΔΕ τυπώνεται με τελείες', () => {
    expect(formatAadeKad('46720100')).toBe('46.72.01.00');
  });
  it('χονδρικό ≠ λιανικό', () => {
    expect(kadNameScore(kadStems('ΧΟΝΔΡΙΚΟ ΕΜΠΟΡΙΟ ΕΛΑΣΤΙΚΩΝ'), kadStems('Λιανικό εμπόριο ελαστικών'))).toBe(0);
  });
});

describe('resolveKad', () => {
  it('ίδιος κωδικός ΜΕ άλλη σημασία ΔΕΝ γίνεται δεκτός — προτείνεται η γραμμή που συμφωνεί στην περιγραφή', () => {
    const m = resolveKad({ code: '46720100', descr: 'ΥΠΗΡΕΣΙΕΣ ΧΟΝΔΡΙΚΟΥ ΕΜΠΟΡΙΟΥ ΕΛΑΣΤΙΚΩΝ ΕΠΙΣΩΤΡΩΝ ΚΑΙ ΕΣΩΤΕΡΙΚΩΝ ΑΕΡΟΘΑΛΑΜΩΝ ΕΠΙΣΩΤΡΩΝ', kind: '1' }, idx);
    expect(m.status).toBe('suggested');
    expect(m.row?.id).toBe(11);          // όχι 10 (μέταλλα), όχι 12 (λιανικό)
    expect(m.note).toMatch(/κατά περιγραφή/);
  });

  it('ίδιος κωδικός που συμφωνεί και στην περιγραφή → matched', () => {
    const m = resolveKad({ code: '61900000', descr: 'ΑΛΛΕΣ ΥΠΗΡΕΣΙΕΣ ΤΗΛΕΠΙΚΟΙΝΩΝΙΩΝ', kind: '1' }, idx);
    expect(m).toMatchObject({ status: 'matched', row: { id: 14 } });
  });

  it('ίδιος κωδικός, άσχετη περιγραφή, καμία άλλη συμφωνία → missing (ποτέ «γαιάνθρακες» για τροχόσπιτα)', () => {
    const m = resolveKad({ code: '46711102', descr: 'ΧΟΝΔΡΙΚΟ ΕΜΠΟΡΙΟ ΑΥΤΟΚΙΝΟΥΜΕΝΩΝ ΤΡΟΧΟΣΠΙΤΩΝ ΜΕ ΕΜΒΟΛΟΦΟΡΟ ΚΙΝΗΤΗΡΑ', kind: '2' }, idx);
    expect(m.row?.id).toBe(16);
    expect(m.status).toBe('suggested');
    const none = resolveKad({ code: '46711102', descr: 'ΧΟΝΔΡΙΚΟ ΕΜΠΟΡΙΟ ΠΟΔΗΛΑΤΩΝ', kind: '2' }, idx);
    expect(none).toMatchObject({ status: 'missing', row: null });
  });

  it('ανενεργές γραμμές δεν προτείνονται', () => {
    expect(resolveKad({ code: '35110000', descr: 'ΠΑΡΑΓΩΓΗ ΗΛΕΚΤΡΙΚΗΣ ΕΝΕΡΓΕΙΑΣ', kind: '1' }, idx).row).toBeNull();
  });
});

describe('resolveTraderKads + kadPayload', () => {
  const acts = [
    { code: '61900000', descr: 'ΑΛΛΕΣ ΥΠΗΡΕΣΙΕΣ ΤΗΛΕΠΙΚΟΙΝΩΝΙΩΝ', kind: '1' },
    { code: '46000000', descr: 'ΧΟΝΔΡΙΚΟ ΕΜΠΟΡΙΟ ΠΟΔΗΛΑΤΩΝ', kind: '2' },
    { code: '46720100', descr: 'ΧΟΝΔΡΙΚΟ ΕΜΠΟΡΙΟ ΕΛΑΣΤΙΚΩΝ ΕΠΙΣΩΤΡΩΝ', kind: '2' },
  ];
  it('κύρια = kind 1· δευτερεύουσα = η πρώτη δευτερεύουσα που αντιστοιχίζεται', () => {
    const r = resolveTraderKads(acts, idx);
    expect(r.primary?.row?.id).toBe(14);
    expect(r.secondary?.row?.id).toBe(11);
  });
  it('στέλνονται τα κλειδιά, εκτός όσων αφαίρεσε ο χρήστης', () => {
    const r = resolveTraderKads(acts, idx);
    expect(kadPayload(r, new Set())).toEqual({ kad: 14, kad1: 11 });
    expect(kadPayload(r, new Set(['secondary']))).toEqual({ kad: 14, kad1: null });
    expect(kadPayload(null, new Set())).toEqual({ kad: null, kad1: null });
  });
});
