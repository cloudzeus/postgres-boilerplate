// lib/ocr/__tests__/account-check.test.ts
// Ο έλεγχος λογαριασμού γενικής πριν την καταχώριση. Τα δεδομένα είναι ΠΡΑΓΜΑΤΙΚΟΙ κωδικοί από το
// λογιστικό σχέδιο (ΕΓΛΣ) του πελάτη και από τις χρεοπιστώσεις του (ΕΛΠ) — read-only audit.
import { describe, it, expect } from 'vitest';
import {
  accountBlockers, accountDetails, accountVatRate, accountWarnings, chartNeeds, checkAccounts, parentOf, patternRegex,
  type AccountChart, type AccountCheckInput,
} from '../account-check';
import { accountCheckInputs, postingBlockers, postingWarnings, type PurdocLineCtx } from '../purdoc-payload';
import { resolvePostingTarget } from '../posting-target';
import { emptyDocument, type DocumentJson } from '../canonical';

// Η σημαία `postable` = ACNMOVING όπως είναι ΖΩΝΤΑΝΑ: οι ομάδες (32.00, 32.01, 61.02.00, 65.90, 60.00)
// είναι συγκεντρωτικές, οι λογαριασμοί 4ης βαθμίδας κινούνται.
const CHART: AccountChart = {
  synced: true,
  accounts: [
    { code: '61', name: 'ΑΜΟΙΒΕΣ ΚΑΙ ΕΞΟΔΑ ΤΡΙΤΩΝ', postable: false },
    { code: '61.02', name: 'Λοιπές προμήθειες τρίτων', postable: false },
    { code: '61.02.00', name: 'Προμήθειες τρίτων', postable: false },
    { code: '61.02.00.0024', name: 'Προμήθειες τρίτων 24%', postable: true },
    { code: '61.02.00.0013', name: 'Προμήθειες τρίτων 13%', postable: true },
    { code: '61.02.00.0000', name: 'Προμήθειες τρίτων χωρίς ΦΠΑ', isActive: false, postable: true },
    { code: '61.02.00.0099', name: 'Προμήθειες τρίτων — ομάδα', postable: false },
    { code: '64.05.00', name: 'Έξοδα εκθέσεων εσωτερικού', postable: false },
    { code: '64.05.00.0009', name: 'Έξοδα εκθέσεων εσωτερικού 9%', postable: true },
    { code: '32', name: 'ΠΡΟΚΑΤΑΒΟΛΕΣ ΓΙΑ ΑΓΟΡΕΣ ΑΠΟΘΕΜΑΤΩΝ', postable: false },
    { code: '32.00', name: 'Παραγγελίες πάγιων στοιχείων', postable: false },
    { code: '32.01', name: 'Παραγγελίες κυκλοφορούντων στοιχείων', postable: false },
    { code: '32.01.00.0019', name: 'Ειδικά έξοδα με Φ.Π.Α. 19%', postable: true },
    { code: '60', name: 'ΑΜΟΙΒΕΣ ΚΑΙ ΕΞΟΔΑ ΠΡΟΣΩΠΙΚΟΥ', postable: false },
    { code: '60.00', name: 'Αμοιβές έμμισθου προσωπικού', postable: false },
    { code: '65.90', name: 'Λοιπά χρηματοοικονομικά έξοδα', postable: false },
    // Σημαία που δεν διαβάστηκε ποτέ (παλιός καθρέφτης πριν το ACNMOVING).
    { code: '62.98.02.0000', name: 'Ύδρευση άνευ Φ.Π.Α.', postable: null },
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
    // ΜΟΝΟ κινούμενοι: ο συγκεντρωτικός 61.02.00.0099 δεν προτείνεται.
    expect(l.siblings.map((s) => s.code)).toEqual(['61.02.00.0000', '61.02.00.0013', '61.02.00.0024']);
    expect(l.message).not.toContain('0099');
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

  it('ανενεργός (αλλά κινούμενος) λογαριασμός: υπάρχει ⇒ δεν εμποδίζει, αλλά το λέει', () => {
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
    // Ακόμη και η μάσκα μένει «άγνωστο» εδώ: χωρίς σχέδιο δεν έχουμε υποψήφιους να δείξουμε.
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

  it('μάσκα με `*` ⇒ ΕΜΠΟΔΙΟ account_is_mask, με ΜΟΝΟ τους κινούμενους υποψήφιους ως προτάσεις', () => {
    // Η γέφυρα χρεώνει τον λογαριασμό της γραμμής αυτούσιο: «32.*» θα έφτανε στη λογιστική ως κείμενο.
    const r = checkAccounts([lin({ acnmsk: '32.*', article: '10000 — Εκτελωνιστικά' })], CHART);
    expect(r.lines[0]).toMatchObject({ status: 'mask', account: '32.*', matchCount: 1, accountName: null });
    // 32.00 και 32.01 ταιριάζουν στη μάσκα αλλά είναι συγκεντρωτικοί — δεν προτείνονται.
    expect(r.lines[0].matches.map((m) => m.code)).toEqual(['32.01.00.0019']);
    expect(r.lines[0].message).toContain('Υποψήφιοι κινούμενοι λογαριασμοί (1): 32.01.00.0019 «Ειδικά έξοδα με Φ.Π.Α. 19%»');
    expect(r.lines[0].message).not.toContain('32.00 «');
    expect(accountBlockers(r)).toEqual(['account_is_mask']);
    expect(accountWarnings(r)).toEqual([]);
    expect(accountDetails('account_is_mask', r)).toHaveLength(1);
  });

  it('μάσκα χωρίς τελεία («32*») — το regex πιάνει και τον πρωτοβάθμιο, αλλά προτείνονται μόνο κινούμενοι', () => {
    expect(patternRegex('32*').test('32')).toBe(true);
    const r = checkAccounts([lin({ acnmsk: '32*' })], CHART);
    expect(r.lines[0].matches.map((m) => m.code)).toEqual(['32.01.00.0019']);
  });

  it('μάσκα που καλύπτει ΜΟΝΟ συγκεντρωτικούς (65.90*) ⇒ account_is_mask, λέει ρητά «κανέναν που δέχεται εγγραφές»', () => {
    const r = checkAccounts([lin({ acnmsk: '65.90*' })], CHART);
    expect(r.lines[0]).toMatchObject({ status: 'mask', matchCount: 0, matches: [] });
    expect(r.lines[0].message).toMatch(/δεν καλύπτει ΚΑΝΕΝΑΝ λογαριασμό που δέχεται εγγραφές/);
    expect(r.lines[0].message).not.toMatch(/Υποψήφιοι/);
    expect(accountBlockers(r)).toEqual(['account_is_mask']);
  });

  it('μάσκα που δεν ταιριάζει με τίποτα ⇒ account_is_mask, χωρίς υποψήφιους', () => {
    const r = checkAccounts([lin({ acnmsk: '99.77*' })], CHART);
    expect(r.lines[0]).toMatchObject({ status: 'mask', matchCount: 0 });
    expect(r.lines[0].message).toMatch(/δεν ταιριάζει με κανέναν λογαριασμό του σχεδίου/);
  });

  it('συγκεντρωτικός λογαριασμός (ACNMOVING=0) ⇒ ΕΜΠΟΔΙΟ account_not_postable', () => {
    // Το «κάποιος έβαλε 60.00 στην καρτέλα»: υπάρχει στο σχέδιο, αλλά δεν δέχεται εγγραφές.
    const r = checkAccounts([lin({ acnmsk: '60.00' })], CHART);
    expect(r.lines[0]).toMatchObject({ status: 'not_postable', account: '60.00', accountName: 'Αμοιβές έμμισθου προσωπικού' });
    expect(r.lines[0].message).toContain('συγκεντρωτικός λογαριασμός — δεν δέχεται εγγραφές');
    expect(accountBlockers(r)).toEqual(['account_not_postable']);
  });

  it('άγνωστη κινησιμότητα (ACNMOVING NULL) ⇒ «άγνωστο», ΠΟΤΕ ok — και ποτέ εμπόδιο', () => {
    const r = checkAccounts([lin({ acnmsk: '62.98.02.0000' })], CHART);
    expect(r.lines[0]).toMatchObject({ status: 'unknown', unknownReason: 'postability_unknown' });
    expect(accountBlockers(r)).toEqual([]);
    expect(accountWarnings(r)).toEqual(['account_unknown']);
  });

  it('άγνωστη κινησιμότητα ΔΕΝ μπαίνει στις προτάσεις', () => {
    const chart: AccountChart = { synced: true, accounts: [
      { code: '62.98.02', name: 'Ύδρευση', postable: false },
      { code: '62.98.02.0024', name: 'Ύδρευση 24%', postable: null },
    ] };
    const r = checkAccounts([lin({ acnmsk: '62.98.02.0001' })], chart);
    expect(r.lines[0]).toMatchObject({ status: 'not_in_chart', siblings: [] });
    expect(r.lines[0].message).toContain('χωρίς κινούμενους λογαριασμούς κάτω του');
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

  it('accountCheckInputs: χωρίς ρητό linAcnmskKnown ο λογαριασμός είναι ΑΓΝΩΣΤΟΣ, όχι γνωστός', () => {
    const inputs = accountCheckInputs({ target: resolvePostingTarget({ sosource: 1253 }), lines: [{ rowIndex: 0, lin: 1, linAcnmsk: null }] });
    expect(inputs[0].acnmskKnown).toBe(false);
    expect(checkAccounts(inputs, CHART).lines[0].status).toBe('unknown');
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
  it('μάσκα ⇒ account_is_mask στα εμπόδια, όχι στις παρατηρήσεις', () => {
    const c = linCtx({ linAcnmsk: '32.*' });
    const acc = checkAccounts(accountCheckInputs(c), CHART);
    expect(postingBlockers(doc(), postingDoc, c, acc)).toEqual(['account_is_mask']);
    expect(postingWarnings(c, acc)).not.toContain('account_is_mask');
  });

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

describe('παρατήρηση ΦΠΑ (account_vat_mismatch) — προειδοποιεί, ΠΟΤΕ δεν εμποδίζει', () => {
  const acc = (code: string, name: string) => ({ code, name, postable: true, isActive: true });
  const CHART = {
    synced: true,
    accounts: [
      acc('62.00.00.0024', 'Ηλεκτρικό ρεύμα παραγωγής με Φ.Π.Α. 24%'),
      acc('62.00.00.0000', 'Ηλεκτρικό ρεύμα παραγωγής άνευ Φ.Π.Α.'),
      acc('64.00.00.0219', 'Έξοδα κινήσεως ΦΙΧ με Φ.Π.Α. 19%'),
      acc('62.04.03.0199', 'Ενοίκια ΕΙΧ αυτοκινήτων ΧΔΕ Φ.Π.Α.'),
      acc('30.87.00.8700', 'Προσαρμογές υπολοίπου πελατών ΕΛΠ - ΕΛΠ'),
      acc('54.00.99.0006', 'Απόδοση εκκαθάριση Φ.Π.Α. Ιουνίου'),
      acc('54.00.24.0053', 'Φ.Π.Α. ενδ.αποκτ.πρ&βυ-υλ.συσκ.εκπιπτ.άνευ.Ε.Φ.Κ. με Φ.Π.Α. 6%'),
      acc('60.00.00.0000', 'Τακτικές αποδοχές'),
    ],
  };
  const line = (acnmsk: string, vatRate: number | null) => checkAccounts(
    [{ rowIndex: 0, path: 'LINLINES', article: 'ΧΡ — δοκιμή', acnmsk, acnmskKnown: true, vatRate }], CHART,
  );

  it('ρεύμα 6% σε λογαριασμό 24% ⇒ παρατήρηση με τα δύο ποσοστά, ΚΑΝΕΝΑ εμπόδιο', () => {
    const c = line('62.00.00.0024', 6);
    expect(c.lines[0].status).toBe('ok');
    expect(c.lines[0].vatMismatch).toMatchObject({ accountRate: 24, lineRate: 6 });
    expect(c.lines[0].vatMismatch?.message).toContain('ο λογαριασμός 62.00.00.0024 είναι για ΦΠΑ 24% αλλά η γραμμή έχει ΦΠΑ 6%');
    expect(accountWarnings(c)).toContain('account_vat_mismatch');
    expect(accountBlockers(c)).toEqual([]);
    expect(accountDetails('account_vat_mismatch', c)).toHaveLength(1);
  });

  it('ίδιος συντελεστής ⇒ τίποτα', () => {
    expect(line('62.00.00.0024', 24).lines[0].vatMismatch).toBeNull();
  });

  it('άγνωστος ΦΠΑ γραμμής ⇒ τίποτα', () => {
    expect(line('62.00.00.0024', null).lines[0].vatMismatch).toBeNull();
  });

  it('«άνευ Φ.Π.Α.» (0000 με το όνομα να το λέει) με γραμμή 24% ⇒ παρατήρηση', () => {
    expect(line('62.00.00.0000', 24).lines[0].vatMismatch).toMatchObject({ accountRate: 0, lineRate: 24 });
  });

  it.each([
    ['0219 (ΦΙΧ 19%) — δεν είναι σκέτος συντελεστής', '64.00.00.0219'],
    ['0199 (ΕΙΧ ΧΔΕ)', '62.04.03.0199'],
    ['8700', '30.87.00.8700'],
    ['0006 που είναι ΜΗΝΑΣ («Ιουνίου»), όχι 6%', '54.00.99.0006'],
    ['0053 με όνομα «6%» — κατάληξη και όνομα διαφωνούν', '54.00.24.0053'],
    ['0000 χωρίς «άνευ» στο όνομα (μισθοδοσία)', '60.00.00.0000'],
  ])('%s ⇒ ΚΑΜΙΑ παρατήρηση', (_l, code) => {
    const c = line(code, 13);
    expect(c.lines[0].vatMismatch).toBeNull();
    expect(accountWarnings(c)).not.toContain('account_vat_mismatch');
  });

  it('accountVatRate: 24% ως ακέραιος — όχι «124%» ούτε «6,5%»', () => {
    expect(accountVatRate({ code: '62.00.00.0024', name: 'Κάτι 124%' })).toBeNull();
    expect(accountVatRate({ code: '62.00.00.0006', name: 'Κάτι με ΦΠΑ 6,5%' })).toBeNull();
    expect(accountVatRate({ code: '62.00.00.0006', name: 'ΔΕΗ με ΦΠΑ 6%' })).toBe(6);
  });

  it('ο ΦΠΑ της γραμμής περνά από το accountCheckInputs στην παρατήρηση της καταχώρισης', () => {
    const inputs = accountCheckInputs({
      target: { lines: 'LINLINES' } as never,
      lines: [{ rowIndex: 0, lin: 1, linMtrType: 1, linLabel: 'ΧΡ', linAcnmsk: '62.00.00.0024', linAcnmskKnown: true, vatRate: 6 }],
    });
    expect(inputs[0].vatRate).toBe(6);
    expect(accountWarnings(checkAccounts(inputs, CHART))).toContain('account_vat_mismatch');
  });
});
