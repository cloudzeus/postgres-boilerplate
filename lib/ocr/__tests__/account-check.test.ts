// lib/ocr/__tests__/account-check.test.ts
// Ο έλεγχος λογαριασμού γενικής πριν την καταχώριση. Τα δεδομένα είναι ΠΡΑΓΜΑΤΙΚΟΙ κωδικοί από το
// λογιστικό σχέδιο (ΕΓΛΣ) του πελάτη και από τις χρεοπιστώσεις του (ΕΛΠ) — read-only audit.
import { describe, it, expect } from 'vitest';
import {
  accountBlockers, accountDetails, accountWarnings, chartNeeds, checkAccounts, parentOf, patternRegex,
  type AccountChart, type AccountCheckInput,
} from '../account-check';
import { accountCheckInputs, postingBlockers, postingWarnings, type PurdocLineCtx } from '../purdoc-payload';
import { resolvePostingTarget } from '../posting-target';
import { emptyDocument, type DocumentJson } from '../canonical';

const CHART: AccountChart = {
  synced: true,
  accounts: [
    { code: '61', name: 'ΑΜΟΙΒΕΣ ΚΑΙ ΕΞΟΔΑ ΤΡΙΤΩΝ' },
    { code: '61.02', name: 'Λοιπές προμήθειες τρίτων' },
    { code: '61.02.00', name: 'Προμήθειες τρίτων' },
    { code: '61.02.00.0024', name: 'Προμήθειες τρίτων 24%' },
    { code: '61.02.00.0013', name: 'Προμήθειες τρίτων 13%' },
    { code: '61.02.00.0000', name: 'Προμήθειες τρίτων χωρίς ΦΠΑ', isActive: false },
    { code: '64.05.00', name: 'Έξοδα εκθέσεων εσωτερικού' },
    { code: '64.05.00.0009', name: 'Έξοδα εκθέσεων εσωτερικού 9%' },
    { code: '32', name: 'ΠΡΟΚΑΤΑΒΟΛΕΣ ΓΙΑ ΑΓΟΡΕΣ ΑΠΟΘΕΜΑΤΩΝ' },
    { code: '32.00', name: 'Προκαταβολές σε προμηθευτές' },
  ],
};

const lin = (over: Partial<AccountCheckInput> = {}): AccountCheckInput => ({
  rowIndex: 0, path: 'LINLINES', article: 'ΥΔΡ9 — Ύδρευση 9%', acnmsk: '64.05.00.0009', acnmskKnown: true, ...over,
});

describe('checkAccounts — γραμμές LINLINES', () => {
  it('ο λογαριασμός υπάρχει ⇒ ok, με το ΟΝΟΜΑ του σχεδίου δίπλα στη χρεοπίστωση, ποτέ εμπόδιο', () => {
    // Το «Ύδρευση 9% → Έξοδα εκθέσεων εσωτερικού» του audit: υπάρχει, άρα περνά — αλλά ΦΑΙΝΕΤΑΙ.
    const r = checkAccounts([lin()], CHART);
    expect(r.lines[0]).toMatchObject({
      status: 'ok', account: '64.05.00.0009', accountName: 'Έξοδα εκθέσεων εσωτερικού 9%', inactive: false,
    });
    expect(r.lines[0].message).toContain('Ύδρευση 9%');
    expect(r.lines[0].message).toContain('Έξοδα εκθέσεων εσωτερικού 9%');
    expect(accountBlockers(r)).toEqual([]);
    expect(accountWarnings(r)).toEqual([]);
  });

  it('κενός λογαριασμός ⇒ account_missing', () => {
    for (const acnmsk of [null, '', '   ']) {
      const r = checkAccounts([lin({ acnmsk })], CHART);
      expect(r.lines[0].status).toBe('missing');
      expect(accountBlockers(r)).toEqual(['account_missing']);
    }
  });

  it('εκτός σχεδίου, με γονικό 3ης βαθμίδας ⇒ εμπόδιο που ΑΠΑΡΙΘΜΕΙ τους λογαριασμούς κάτω από τον γονικό', () => {
    // Το τυπικό από τα 148: ο κωδικός ΕΛΠ «.0001» δεν υπάρχει, ο γονικός ΕΓΛΣ ναι.
    const r = checkAccounts([lin({ acnmsk: '61.02.00.0001', article: 'ΠΡΜ — Προμήθειες' })], CHART);
    const l = r.lines[0];
    expect(l.status).toBe('not_in_chart');
    expect(l.parent).toMatchObject({ code: '61.02.00' });
    expect(l.siblings.map((s) => s.code)).toEqual(['61.02.00.0000', '61.02.00.0013', '61.02.00.0024']);
    expect(l.message).toContain('61.02.00.0001');
    expect(l.message).toContain('61.02.00.0024 «Προμήθειες τρίτων 24%»');
    expect(l.message).toContain('61.02.00.0013 «Προμήθειες τρίτων 13%»');
    // Προτείνει, δεν διαλέγει: κανένα πεδίο «διορθωμένου» λογαριασμού.
    expect(l.account).toBe('61.02.00.0001');
    expect(accountBlockers(r)).toEqual(['account_not_in_chart']);
  });

  it('εκτός σχεδίου, ΧΩΡΙΣ γονικό ⇒ εμπόδιο, χωρίς προτάσεις', () => {
    const r = checkAccounts([lin({ acnmsk: '66.07.01.0000' })], CHART);
    expect(r.lines[0]).toMatchObject({ status: 'not_in_chart', parent: null, siblings: [] });
    expect(r.lines[0].message).toContain('ούτε ο γονικός του 66.07.01');
    expect(accountBlockers(r)).toEqual(['account_not_in_chart']);
  });

  it('ανενεργός λογαριασμός: υπάρχει ⇒ δεν εμποδίζει, αλλά το λέει', () => {
    const r = checkAccounts([lin({ acnmsk: '61.02.00.0000' })], CHART);
    expect(r.lines[0]).toMatchObject({ status: 'ok', inactive: true });
    expect(r.lines[0].message).toContain('ανενεργός');
    expect(accountBlockers(r)).toEqual([]);
  });

  it('ΑΔΕΙΟ / ασυγχρόνιστο σχέδιο ⇒ ξεχωριστή κατάσταση «άγνωστο», ΚΑΝΕΝΑ εμπόδιο — όχι χιονοστιβάδα «λείπει»', () => {
    const lines = [
      lin({ rowIndex: 0, acnmsk: '64.05.00.0009' }),
      lin({ rowIndex: 1, acnmsk: '61.02.00.0001' }),
      lin({ rowIndex: 2, acnmsk: '32.*' }),
    ];
    const r = checkAccounts(lines, { synced: false, accounts: [] });
    expect(r.chartSynced).toBe(false);
    expect(r.lines.map((l) => l.status)).toEqual(['unknown', 'unknown', 'unknown']);
    expect(r.lines.every((l) => l.unknownReason === 'chart_not_synced')).toBe(true);
    // Ούτε ψευδές «δεν υπάρχει», ούτε ψευδές «υπάρχει».
    expect(r.lines.some((l) => l.accountName != null)).toBe(false);
    expect(accountBlockers(r)).toEqual([]);
    expect(accountWarnings(r)).toEqual(['account_unknown']);
  });

  it('ασυγχρόνιστο σχέδιο ΔΕΝ κρύβει κενό λογαριασμό: αυτό το ξέρουμε από την ίδια τη χρεοπίστωση', () => {
    const r = checkAccounts([lin({ acnmsk: null })], { synced: false, accounts: [] });
    expect(r.lines[0].status).toBe('missing');
    expect(accountBlockers(r)).toEqual(['account_missing']);
  });

  it('χρεοπίστωση που δεν έχει ξανασυγχρονιστεί ⇒ άγνωστο, ΟΧΙ «λείπει»', () => {
    const r = checkAccounts([lin({ acnmsk: null, acnmskKnown: false })], CHART);
    expect(r.lines[0]).toMatchObject({ status: 'unknown', unknownReason: 'line_item_not_synced' });
    expect(accountBlockers(r)).toEqual([]);
    expect(accountWarnings(r)).toEqual(['account_unknown']);
  });

  it('μάσκα με `*` που ταιριάζει ⇒ pattern: παρατήρηση με τους λογαριασμούς, όχι εμπόδιο', () => {
    const r = checkAccounts([lin({ acnmsk: '32.*' })], CHART);
    expect(r.lines[0]).toMatchObject({ status: 'pattern', matchCount: 1 });
    expect(r.lines[0].matches.map((m) => m.code)).toEqual(['32.00']);
    expect(accountBlockers(r)).toEqual([]);
    expect(accountWarnings(r)).toEqual(['account_pattern']);
  });

  it('μάσκα χωρίς τελεία («32*») πιάνει και τον ίδιο τον πρωτοβάθμιο', () => {
    const r = checkAccounts([lin({ acnmsk: '32*' })], CHART);
    expect(r.lines[0].matches.map((m) => m.code)).toEqual(['32', '32.00']);
  });

  it('μάσκα που δεν ταιριάζει με τίποτα ⇒ εμπόδιο', () => {
    const r = checkAccounts([lin({ acnmsk: '65.90*' })], CHART);
    expect(r.lines[0].status).toBe('not_in_chart');
    expect(accountBlockers(r)).toEqual(['account_not_in_chart']);
  });

  it('δεν συγκρίνει περιγραφές: «Μεταφορικά εμπορευμάτων» σε λογαριασμό άλλου νοήματος περνά — και φαίνεται', () => {
    const r = checkAccounts([lin({ article: 'ΜΕΤ — Μεταφορικά εμπορευμάτων', acnmsk: '61.02.00.0024' })], CHART);
    expect(r.lines[0].status).toBe('ok');
    expect(accountWarnings(r)).toEqual([]);
  });
});

describe('checkAccounts — διαδρομές που δεν καλύπτονται ακόμη', () => {
  it.each(['ITELINES', 'SRVLINES', 'EXPANAL'] as const)('%s ⇒ not_covered: δεν εμποδίζει, αλλά το λέει ρητά', (path) => {
    const r = checkAccounts([{ rowIndex: 3, path }], CHART);
    expect(r.lines[0]).toMatchObject({ status: 'not_covered', account: null });
    expect(r.lines[0].message).toMatch(/δεν καλύπτει ακόμη/);
    expect(accountBlockers(r)).toEqual([]);
    expect(accountWarnings(r)).toEqual(['account_not_covered']);
  });

  it('γραμμή που δεν θα σταλεί (path null) δεν ελέγχεται καθόλου', () => {
    expect(checkAccounts([{ rowIndex: 0, path: null }], CHART).lines).toEqual([]);
  });
});

describe('βοηθητικά', () => {
  it('parentOf', () => {
    expect(parentOf('61.02.00.0024')).toBe('61.02.00');
    expect(parentOf('61')).toBeNull();
  });

  it('patternRegex: μόνο το `*` είναι ειδικό — η τελεία είναι κατά γράμμα', () => {
    expect(patternRegex('32.*').test('32.00')).toBe(true);
    expect(patternRegex('32.*').test('3200')).toBe(false);
    expect(patternRegex('65.90*').test('65.90.00.0024')).toBe(true);
  });

  it('chartNeeds: κωδικοί, γονείς και προθέματα μοτίβων', () => {
    expect(chartNeeds(['61.02.00.0001', '32.*', null, ''])).toEqual({
      codes: ['61.02.00.0001', '61.02.00'], parents: ['61.02.00'], prefixes: ['32.'],
    });
  });

  it('accountDetails δίνει τις ανά γραμμή προτάσεις του συγκεκριμένου κωδικού', () => {
    const r = checkAccounts([lin({ rowIndex: 0, acnmsk: null }), lin({ rowIndex: 1 })], CHART);
    expect(accountDetails('account_missing', r)).toHaveLength(1);
    expect(accountDetails('account_missing', r)[0]).toMatch(/^Γραμμή 1/);
  });
});

// ── Σύνδεση με τα εμπόδια της καταχώρισης ────────────────────────────────────────────────────

const LINSUP = resolvePostingTarget({ sosource: 1253 });

const doc = (): DocumentJson => ({
  ...emptyDocument('invoice'),
  date: '2026-09-01',
  type: { label: 'ΤΙΜΟΛΟΓΙΟ', series: 'Α', number: '1', myDataType: null },
  totals: { net: 100, discount: null, vatAmount: 24, withholding: null, fees: null, total: 124, payable: 124 },
  lines: [{ code: null, name: 'Ύδρευση', unit: null, quantity: 1, unitPrice: 100, discount: 0, net: 100, vatRate: 24, vatAmount: 24, total: 124, custom: {} }],
});

const postingDoc = {
  status: 'COMPLETED', category: 'EXPENSE', softoneTrdr: 1, softoneSeries: '1001', seriesSource: 1253,
  seriesKnown: true, seriesEnabled: true, traderSodtype: 12,
};

const linCtx = (over: Partial<PurdocLineCtx> = {}) => ({
  target: LINSUP,
  vatIdByRate: { 24: 1410 },
  lines: [{ rowIndex: 0, lin: 3001, linMtrType: 0, linLabel: 'ΥΔΡ9 — Ύδρευση 9%', linAcnmsk: '64.05.00.0009', linAcnmskKnown: true, ...over }],
});

describe('postingBlockers / postingWarnings με τον έλεγχο λογαριασμού', () => {
  it('ο λογαριασμός υπάρχει ⇒ κανένα εμπόδιο', () => {
    const c = linCtx();
    const acc = checkAccounts(accountCheckInputs(c), CHART);
    expect(postingBlockers(doc(), postingDoc, c, acc)).toEqual([]);
  });

  it('εκτός σχεδίου ⇒ account_not_in_chart στα εμπόδια', () => {
    const c = linCtx({ linAcnmsk: '61.02.00.0001' });
    const acc = checkAccounts(accountCheckInputs(c), CHART);
    expect(postingBlockers(doc(), postingDoc, c, acc)).toEqual(['account_not_in_chart']);
  });

  it('ασυγχρόνιστο σχέδιο ⇒ καμία αλλαγή στα εμπόδια, μία παρατήρηση', () => {
    const c = linCtx({ linAcnmsk: '61.02.00.0001' });
    const acc = checkAccounts(accountCheckInputs(c), { synced: false, accounts: [] });
    expect(postingBlockers(doc(), postingDoc, c, acc)).toEqual([]);
    expect(postingWarnings(c, acc)).toContain('account_unknown');
  });

  it('γραμμή είδους σε σειρά PURDOC ⇒ not_covered, όχι εμπόδιο', () => {
    const c = { target: resolvePostingTarget({ sosource: 1251 }), vatIdByRate: { 24: 1410 }, lines: [{ rowIndex: 0, mtrl: 555 }] };
    const acc = checkAccounts(accountCheckInputs(c), CHART);
    expect(acc.lines[0]).toMatchObject({ path: 'ITELINES', status: 'not_covered' });
    expect(postingBlockers(doc(), { ...postingDoc, seriesSource: 1251 }, c, acc)).toEqual([]);
  });

  it('χρεοπίστωση σε σειρά PURDOC (δεν χωράει) ⇒ δεν ελέγχεται ο λογαριασμός — το εμπόδιο είναι άλλο', () => {
    const c = { ...linCtx({ linAcnmsk: null }), target: resolvePostingTarget({ sosource: 1251 }) };
    const acc = checkAccounts(accountCheckInputs(c), CHART);
    expect(acc.lines).toEqual([]);
    expect(postingBlockers(doc(), { ...postingDoc, seriesSource: 1251 }, c, acc)).not.toContain('account_missing');
  });
});
