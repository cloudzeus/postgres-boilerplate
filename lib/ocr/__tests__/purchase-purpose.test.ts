import { describe, it, expect } from 'vitest';
import { availablePurposes, purposeOfMatch, registryKindFor, suggestPurpose, quizOutcome } from '../purchase-purpose';
import { assetLikeLabel } from '../asset-code';
import { defaultPostingTarget, resolvePostingTarget } from '../posting-target';

const PURCHASE = defaultPostingTarget({ sosource: 1251, name: 'Τιμολόγιο Αγοράς' });       // PURDOC «ανά γραμμή»
const CREDITORS = defaultPostingTarget({ sosource: 1653, name: 'Πιστωτές' });             // LINLINES
const EXPENSES_ONLY = resolvePostingTarget({ sosource: 1251, postLines: 'EXPANAL' });

describe('availablePurposes / registryKindFor', () => {
  it('τιμολόγιο αγοράς: εμπόρευμα, έξοδο, πάγιο — όχι επιμερισμός', () => {
    expect(availablePurposes(PURCHASE)).toEqual(['goods', 'expense', 'asset']);
    expect(registryKindFor('expense', PURCHASE)).toBe('expense');
    expect(registryKindFor('goods', PURCHASE)).toBe('product');
  });
  it('ειδικές συναλλαγές: έξοδο (χρεοπίστωση) και επιμερισμός', () => {
    expect(availablePurposes(CREDITORS)).toEqual(['expense', 'split']);
    expect(registryKindFor('expense', CREDITORS)).toBe('lineitem');
  });
  it('σειρά μόνο εξόδων: χωρίς πάγιο', () => {
    expect(availablePurposes(EXPENSES_ONLY)).toEqual(['expense']);
  });
});

describe('assetLikeLabel', () => {
  it('laptop / μηχάνημα με αξιόλογο ποσό → εξοπλισμός', () => {
    expect(assetLikeLabel('NB APPLE MACBOOK PRO 14-INCH', 2523)).toMatch(/υπολογιστή/);
    expect(assetLikeLabel('Reactor 16m3', 74000)).toBe('μηχάνημα');
  });
  it('εργασία πάνω σε εξοπλισμό ή μικρό ποσό → όχι πάγιο', () => {
    expect(assetLikeLabel('Αλλαγή αντλίας κολώνας R1', 150)).toBeNull();
    expect(assetLikeLabel('Καθαρισμός κλιματιστικού', 600)).toBeNull();
    expect(assetLikeLabel('Ποντίκι για laptop', 25)).toBeNull();
  });
});

describe('suggestPurpose', () => {
  it('laptop σε τιμολόγιο αγοράς → πάγιο, με εξήγηση', () => {
    const s = suggestPurpose({ lineName: 'Laptop Dell 15"', amount: 900, defaultKind: 'product', target: PURCHASE });
    expect(s).toMatchObject({ purpose: 'asset', blocked: false });
    expect(s?.reason).toMatch(/υπολογιστή/);
  });
  it('laptop σε σειρά πιστωτών → πάγιο ΑΛΛΑ blocked (θέλει κατεύθυνση)', () => {
    expect(suggestPurpose({ lineName: 'MacBook Air', amount: 1400, defaultKind: 'lineitem', target: CREDITORS }))
      .toMatchObject({ purpose: 'asset', blocked: true });
  });
  it('καύσιμα → έξοδο· άγνωστο με είδη στο παραστατικό → εμπόρευμα', () => {
    expect(suggestPurpose({ lineName: 'ΑΜΟΛΥΒΔΗ 95', amount: 60, defaultKind: 'product', target: PURCHASE })?.purpose).toBe('expense');
    expect(suggestPurpose({ lineName: 'Βίδες M8', amount: 12, defaultKind: 'product', target: PURCHASE })?.purpose).toBe('goods');
    expect(suggestPurpose({ lineName: 'Κάτι', amount: 1, defaultKind: null, target: PURCHASE })).toBeNull();
  });
});

describe('purposeOfMatch', () => {
  it('αντιστοιχίσεις → επιλογή· η υπηρεσία ανήκει στις προχωρημένες', () => {
    expect(purposeOfMatch({ asset: 5, mtrl: null, expn: null, lin: null, isService: null })).toBe('asset');
    expect(purposeOfMatch({ mtrl: null, expn: 3, lin: null, isService: null })).toBe('expense');
    expect(purposeOfMatch({ mtrl: null, expn: null, lin: 4, isService: null })).toBe('expense');
    expect(purposeOfMatch({ mtrl: 1, expn: null, lin: null, isService: false })).toBe('goods');
    expect(purposeOfMatch({ mtrl: 1, expn: null, lin: null, isService: true })).toBeNull();
  });
});

describe('quizOutcome («Δεν είμαι σίγουρος»)', () => {
  it('για χρόνια + ακριβό → πάγιο· για χρόνια αλλά φθηνό → έξοδο', () => {
    expect(quizOutcome({ longTerm: true, expensive: true })).toBe('asset');
    expect(quizOutcome({ longTerm: true, expensive: false })).toBe('expense');
  });
  it('όχι για χρόνια: μεταπώληση/παραγωγή → εμπόρευμα, αλλιώς έξοδο', () => {
    expect(quizOutcome({ longTerm: false, resale: true })).toBe('goods');
    expect(quizOutcome({ longTerm: false, resale: false })).toBe('expense');
  });
  it('ελλιπείς απαντήσεις → καμία απόφαση ακόμη', () => {
    expect(quizOutcome({})).toBeNull();
    expect(quizOutcome({ longTerm: true })).toBeNull();
  });
});

import { availableTiles, suggestTile, TILES } from '../purchase-purpose';

describe('καθημερινές κατηγορίες (για τον χρήστη όλα είναι «έξοδο»)', () => {
  it('laptop → εξοπλισμός (λογιστικά πάγιο), βενζίνη → αυτοκίνητο, leasing → ενοίκιο, ρεύμα → λογαριασμοί', () => {
    expect(suggestTile({ lineName: 'Laptop Lenovo ThinkPad', amount: 1100, defaultKind: 'product', target: PURCHASE })?.tile).toBe('equipment');
    expect(suggestTile({ lineName: 'ΑΜΟΛΥΒΔΗ 95', amount: 50, defaultKind: 'product', target: PURCHASE })?.tile).toBe('vehicle');
    expect(suggestTile({ lineName: 'Μίσθωμα οχήματος LEASING 10/2026', amount: 480, defaultKind: 'lineitem', target: CREDITORS })?.tile).toBe('rent');
    expect(suggestTile({ lineName: 'Κατανάλωση ενέργειας (ρεύμα)', amount: 210, defaultKind: 'lineitem', target: CREDITORS })?.tile).toBe('bills');
    expect(TILES.equipment.purpose).toBe('asset');
    expect(TILES.vehicle.searchHint).toBe('καύσιμα');
  });
  it('σε σειρά πιστωτών: ο εξοπλισμός μένει ορατός ως «blocked», τα εμπορεύματα κρύβονται', () => {
    const tiles = availableTiles(CREDITORS);
    expect(tiles.find((t) => t.tile === 'equipment')).toEqual({ tile: 'equipment', blocked: true });
    expect(tiles.some((t) => t.tile === 'goods')).toBe(false);
    expect(tiles.find((t) => t.tile === 'split')?.blocked).toBe(false);
  });
});
