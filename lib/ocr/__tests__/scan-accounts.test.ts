import { describe, it, expect } from 'vitest';
import { accountPath, nameForVat, proposeFamilyAccounts, vatOfAccount } from '../scan-accounts';

// Ένα κομμάτι ΕΓΛΣ όπως του Demo S1: τα φύλλα ΔΕΝ λένε «Επισκευές» — το λέει η ομάδα.
const NAMES = new Map<string, string>([
  ['62', 'Παροχές τρίτων'],
  ['62.07', 'Επισκευές και συντηρήσεις'],
  ['62.07.02', 'Μηχανημάτων-τεχνικών εγκαταστάσεων'],
  ['62.07.02.0019', 'Μηχανημάτων με  Φ.Π.Α. 19%'],
  ['62.07.02.0023', 'Μηχανημάτων με  Φ.Π.Α. 23%'],
  ['62.07.02.0024', 'Μηχανημάτων με  Φ.Π.Α. 24%'],
  ['64', 'Διάφορα έξοδα'],
  ['64.00', 'Έξοδα μεταφορών'],
  ['64.00.00', 'Καύσιμα και λιπαντικά μεταφορικών μέσων'],
  ['64.00.00.0013', 'Καύσιμα με Φ.Π.Α. 13%'],
  ['64.00.00.0024', 'Καύσιμα με Φ.Π.Α. 24%'],
]);
const accounts = [...NAMES.entries()]
  .filter(([c]) => c.split('.').length === 4)
  .map(([code, name]) => ({ code, name, path: accountPath(code, NAMES) }));

describe('accountPath / vatOfAccount', () => {
  it('η διαδρομή κουβαλά τα ονόματα των ομάδων', () => {
    expect(accountPath('62.07.02.0024', NAMES)).toBe('ΠΑΡΟΧΕΣ ΤΡΙΤΩΝ › ΕΠΙΣΚΕΥΕΣ ΚΑΙ ΣΥΝΤΗΡΗΣΕΙΣ › ΜΗΧΑΝΗΜΑΤΩΝ-ΤΕΧΝΙΚΩΝ ΕΓΚΑΤΑΣΤΑΣΕΩΝ › ΜΗΧΑΝΗΜΑΤΩΝ ΜΕ Φ.Π.Α. 24%');
    expect(vatOfAccount('62.07.02.0024')).toBe(24);
    expect(vatOfAccount('62.07.02')).toBeNull();
  });
  it('όνομα για νέο συντελεστή', () => {
    expect(nameForVat('Καύσιμα με Φ.Π.Α. 24%', 6)).toBe('Καύσιμα με Φ.Π.Α. 6%');
    expect(nameForVat('Καύσιμα με Φ.Π.Α. 24%', 0)).toBe('Καύσιμα άνευ Φ.Π.Α.');
  });
});

describe('proposeFamilyAccounts', () => {
  it('επισκευές 24%: βρίσκει τον 62.07.02.0024 από την ομάδα, πρώτος του σωστού ΦΠΑ, τίποτα για άνοιγμα', () => {
    const p = proposeFamilyAccounts(accounts, 'repairs', 24);
    expect(p.suggestions[0].code).toBe('62.07.02.0024');
    expect(p.toOpen).toBeNull();
  });

  it('καύσιμα 6%: δεν υπάρχει ⇒ πρόταση ανοίγματος 64.00.00.0006 με σωστό όνομα', () => {
    const p = proposeFamilyAccounts(accounts, 'fuel', 6);
    expect(p.suggestions.map((s) => s.code)).toEqual(['64.00.00.0013', '64.00.00.0024']);
    expect(p.toOpen).toEqual({ code: '64.00.00.0006', name: 'Καύσιμα με Φ.Π.Α. 6%', vatRate: 6, parent: '64.00.00' });
  });

  it('οικογένεια χωρίς λογαριασμό στο σχέδιο ⇒ καμία πρόταση', () => {
    expect(proposeFamilyAccounts(accounts, 'insurance', 24)).toEqual({ suggestions: [], toOpen: null });
  });
});
