// lib/ocr/__tests__/chart-grounding.test.ts
// Ο εμπλουτισμός υποψηφίων με το λογιστικό σχέδιο: ΜΟΝΟ όπου ο σύνδεσμος είναι αξιόπιστος, ΠΟΤΕ
// κλάδος δανεισμένος από τα ψηφία ενός κωδικού ΕΛΠ, και ιστορικό εκδότη μόνο από ανθρώπους.
import { describe, it, expect } from 'vitest';
import {
  BRANCH_LEVEL, branchCodeOf, articleLink, groundArticles, candidateLine, branchCatalogue,
  articlesInBranches, mergeWhitelist, issuerHistory, parseBranchAnswer, candidateSignaturePart,
  type ArticleRow, type GroundedArticle,
} from '../chart-grounding';
import type { ChartAccount } from '../account-check';

/** Κομμάτι του ζωντανού ΕΓΛΣ του πελάτη. */
const CHART: ChartAccount[] = [
  { code: '62.04', name: 'Ενοίκια', postable: false },
  { code: '62.04.00', name: 'Ενοίκια κτιρίων', postable: false },
  { code: '62.04.00.0024', name: 'Ενοίκια κτιρίων με ΦΠΑ 24%', postable: true },
  { code: '62.04.00.0013', name: 'Ενοίκια κτιρίων με ΦΠΑ 13%', postable: true },
  // Το «61.02» του ΕΓΛΣ — άλλο πράγμα από το «61.02» του ΕΛΠ που φορτώθηκε στις χρεοπιστώσεις.
  { code: '61.02', name: 'Λοιπές προμήθειες τρίτων', postable: false },
  { code: '61.02.00', name: 'Λοιπές προμήθειες', postable: false },
  { code: '64.00', name: 'Έξοδα μεταφορών', postable: false },
  { code: '64.00.00.0224', name: 'Έξοδα κινήσεως ΦΙΧ με ΦΠΑ 24%', postable: true },
  { code: '64.00.00.0299', name: 'Άγνωστη σημαία', postable: null },
  { code: '64.00.00.0300', name: 'Ανενεργός', postable: true, isActive: false },
];
const chart = new Map(CHART.map((a) => [a.code, a]));

const art = (over: Partial<ArticleRow> & { mtrl: number }): ArticleRow => ({
  code: `ΧΡ${over.mtrl}`, name: `Χρεοπίστωση ${over.mtrl}`, acnmsk: null, acnmskKnown: true, ...over,
});

const SOUND = art({ mtrl: 1, code: 'ΧΡ01', name: 'Ενοίκια', acnmsk: '62.04.00.0024' });
const SOUND2 = art({ mtrl: 2, code: 'ΧΡ02', name: 'Ενοίκια 13', acnmsk: '62.04.00.0013' });
const FUEL = art({ mtrl: 3, code: '64.00.00.0224', name: 'ΚΑΥΣΙΜΑ', acnmsk: '64.00.00.0224' });
// ΕΛΠ «61.02.00.0024 Απομείωση βιολογικών» — ο κωδικός ΔΕΝ υπάρχει στο ΕΓΛΣ, ο κλάδος 61.02 ΝΑΙ.
const ELP = art({ mtrl: 4, code: '61.02.00.0024', name: 'Απομείωση βιολογικών περιουσιακών στοιχείων', acnmsk: '61.02.00.0024' });
const BLANK = art({ mtrl: 5, code: '62.04.00.0099', name: 'Κενός λογαριασμός', acnmsk: null });
const MASK = art({ mtrl: 6, code: '32.01', name: 'Μάσκα', acnmsk: '32.*' });
const SUMMARY = art({ mtrl: 7, code: '62.04.00', name: 'Σε συγκεντρωτικό', acnmsk: '62.04.00' });
const UNKNOWN = art({ mtrl: 8, name: 'Άγνωστη σημαία', acnmsk: '64.00.00.0299' });
const UNSYNCED = art({ mtrl: 9, name: 'Ασυγχρόνιστη', acnmsk: '62.04.00.0024', acnmskKnown: false });
const INACTIVE = art({ mtrl: 10, name: 'Ανενεργός λογαριασμός', acnmsk: '64.00.00.0300' });

const ALL = groundArticles([SOUND, SOUND2, FUEL, ELP, BLANK, MASK, SUMMARY, UNKNOWN, UNSYNCED, INACTIVE], chart);
const byMtrl = new Map<number, GroundedArticle>(ALL.map((a) => [a.mtrl, a]));
const g = (m: number) => byMtrl.get(m)!;

describe('branchCodeOf', () => {
  it('κόβει στη 2η βαθμίδα', () => {
    expect(BRANCH_LEVEL).toBe(2);
    expect(branchCodeOf('62.04.00.0024')).toBe('62.04');
    expect(branchCodeOf('62')).toBeNull();
    expect(branchCodeOf('')).toBeNull();
  });
});

describe('αξιόπιστος σύνδεσμος ⇒ εμπλουτισμός', () => {
  it('λογαριασμός και κλάδος με τα ονόματα του σχεδίου', () => {
    expect(articleLink(SOUND, chart)).toEqual({
      sound: true,
      account: { code: '62.04.00.0024', name: 'Ενοίκια κτιρίων με ΦΠΑ 24%' },
      branch: { code: '62.04', name: 'Ενοίκια' },
    });
    expect(candidateLine(g(1))).toBe(
      'ΧΡ01 — Ενοίκια → λογαριασμός 62.04.00.0024 «Ενοίκια κτιρίων με ΦΠΑ 24%» · κλάδος 62.04 «Ενοίκια»',
    );
  });

  it('ίδιος κωδικός με τον λογαριασμό: το λέει σύντομα, χωρίς να χάνει το όνομα του λογαριασμού', () => {
    expect(candidateLine(g(3))).toBe(
      '64.00.00.0224 — ΚΑΥΣΙΜΑ → λογαριασμός (ίδιος κωδικός) «Έξοδα κινήσεως ΦΙΧ με ΦΠΑ 24%» · κλάδος 64.00 «Έξοδα μεταφορών»',
    );
    const same = groundArticles([art({ mtrl: 11, code: '64.00.00.0224', name: 'Έξοδα κινήσεως ΦΙΧ με Φ.Π.Α. 24%', acnmsk: '64.00.00.0224' })], chart)[0];
    expect(candidateLine(same)).toContain('λογαριασμός (ίδιος κωδικός και όνομα) · κλάδος 64.00');
  });
});

describe('ΚΑΝΕΝΑΣ εμπλουτισμός χωρίς αξιόπιστο σύνδεσμο', () => {
  it.each([
    ['κενός λογαριασμός', 5, 'blank'],
    ['λογαριασμός εκτός σχεδίου (κωδικός ΕΛΠ)', 4, 'not_in_chart'],
    ['μάσκα', 6, 'mask'],
    ['συγκεντρωτικός (δεν κινείται)', 7, 'not_postable'],
    ['άγνωστη σημαία «Κινείται»', 8, 'postability_unknown'],
    ['ο λογαριασμός δεν έχει διαβαστεί ακόμη', 9, 'unsynced'],
    ['ανενεργός λογαριασμός', 10, 'inactive'],
  ])('%s ⇒ μόνο κωδικός και όνομα', (_label, mtrl, reason) => {
    const a = g(mtrl as number);
    expect(a.link).toEqual({ sound: false, reason });
    expect(candidateLine(a)).toBe(`${a.code} — ${a.name}`);
    expect(candidateLine(a)).not.toContain('→');
    expect(candidateLine(a)).not.toContain('κλάδος');
  });

  it('ΠΟΤΕ κλάδος ΕΓΛΣ δανεισμένος από τα ψηφία ενός κωδικού ΕΛΠ', () => {
    // Το 61.02 υπάρχει στο ΕΓΛΣ ως «Λοιπές προμήθειες τρίτων»· η χρεοπίστωση λέει «Απομείωση
    // βιολογικών». Αν το prompt τα έβαζε μαζί, θα έδινε στο μοντέλο λάθος περιγραφή με κύρος.
    expect(candidateLine(g(4))).not.toContain('Λοιπές προμήθειες');
    expect(candidateLine(g(4))).not.toContain('61.02 «');
  });
});

describe('κατάλογος κλάδων', () => {
  it('ΜΟΝΟ κλάδοι με αξιόπιστα συνδεδεμένη χρεοπίστωση, με πλήθος', () => {
    expect(branchCatalogue(ALL)).toEqual([
      { code: '62.04', name: 'Ενοίκια', articles: 2 },
      { code: '64.00', name: 'Έξοδα μεταφορών', articles: 1 },
    ]);
    // Ο 61.02 υπάρχει στο σχέδιο και μια χρεοπίστωση ΕΛΠ έχει τα ίδια ψηφία — δεν μπαίνει.
    expect(branchCatalogue(ALL).map((b) => b.code)).not.toContain('61.02');
  });

  it('οι χρεοπιστώσεις ενός κλάδου είναι μόνο οι αξιόπιστες (η κενή με κωδικό 62.04… μένει έξω)', () => {
    expect(articlesInBranches(ALL, new Set(['62.04'])).map((a) => a.mtrl)).toEqual([1, 2]);
  });
});

describe('ενωμένη λευκή λίστα', () => {
  it('χωρίς διπλότυπα, με τη σειρά των πηγών, φραγμένη στο πλαφόν', () => {
    const text = [g(4), g(1)];
    const grounded = [g(1), g(2), g(3)];
    expect(mergeWhitelist([text, grounded], 10).map((a) => a.mtrl)).toEqual([4, 1, 2, 3]);
    expect(mergeWhitelist([text, grounded], 2).map((a) => a.mtrl)).toEqual([4, 1]);
  });

  it('η υπογραφή αλλάζει όταν αλλάζει ο λογαριασμός — όχι μόνο όταν αλλάζει η χρεοπίστωση', () => {
    const renamed = new Map(chart);
    renamed.set('62.04.00.0024', { ...chart.get('62.04.00.0024')!, name: 'Άλλο όνομα' });
    const [before] = groundArticles([SOUND], chart);
    const [after] = groundArticles([SOUND], renamed);
    expect(candidateSignaturePart(before)).not.toBe(candidateSignaturePart(after));
  });
});

describe('ιστορικό εκδότη', () => {
  const AFM = '094073495';
  const rule = (lin: number | null, createdById: string | null = 'u1', afm = AFM) => ({ afm, lin, createdById });

  it('κατανομή ανά κλάδο από τους κανόνες που έγραψε άνθρωπος', () => {
    const h = issuerHistory(AFM, [rule(1), rule(2), rule(3)], byMtrl);
    expect(h?.branches).toEqual(['62.04', '64.00']);
    expect(h?.line).toContain('62.04 «Ενοίκια» ×2, 64.00 «Έξοδα μεταφορών» ×1');
    expect(h?.line).toContain('ΕΝΔΕΙΞΗ, όχι απόφαση');
  });

  it('κανόνας χωρίς δημιουργό, άλλου εκδότη, ή χωρίς χρεοπίστωση ΔΕΝ μετράει', () => {
    expect(issuerHistory(AFM, [rule(1, null), rule(1, 'u1', '999999999'), rule(null)], byMtrl)).toBeNull();
  });

  it('χωρίς επιβεβαιωμένο ιστορικό ⇒ τίποτα (κανένα εφευρεμένο prior)', () => {
    expect(issuerHistory(AFM, [], byMtrl)).toBeNull();
    expect(issuerHistory('', [rule(1, 'u1', '')], byMtrl)).toBeNull();
  });

  it('χρεοπίστωση χωρίς αξιόπιστο λογαριασμό μετρά με τον κωδικό της, ΠΟΤΕ με κλάδο', () => {
    const h = issuerHistory(AFM, [rule(4)], byMtrl);
    expect(h?.branches).toEqual([]);
    expect(h?.line).toContain('χρεοπίστωση 61.02.00.0024 ×1');
    expect(h?.line).not.toContain('Λοιπές προμήθειες');
  });
});

describe('απάντηση 1ου σταδίου (κλάδοι)', () => {
  const allowed = new Set(['62.04', '64.00']);
  it('δεκτοί μόνο κλάδοι του καταλόγου, το πολύ Ν ανά ομάδα', () => {
    const r = parseBranchAnswer(
      '```json\n{"branches":[{"key":"g1","codes":["62.04","99.99","64.00","62.04"]},{"key":"g2","codes":["61.02"]}]}\n```',
      allowed, 1,
    );
    expect([...r.entries()]).toEqual([['g1', ['62.04']]]);
  });
  it('σκουπίδια ⇒ κενός χάρτης', () => {
    expect(parseBranchAnswer('όχι json', allowed).size).toBe(0);
  });
});
