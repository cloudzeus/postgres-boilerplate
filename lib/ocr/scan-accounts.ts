// lib/ocr/scan-accounts.ts — ΚΑΘΑΡΟ. «Ποιους λογαριασμούς χρειάζονται τα σκαναρισμένα;»
//
// Οι αταίριαστες γραμμές των ανοιχτών παραστατικών, ομαδοποιημένες ανά ΟΙΚΟΓΕΝΕΙΑ δαπάνης και ΦΠΑ,
// και για κάθε ομάδα: ποιοι λογαριασμοί του σχεδίου ταιριάζουν, ποιος ΛΕΙΠΕΙ για αυτόν τον ΦΠΑ (για
// άνοιγμα), και αν υπάρχει ήδη μητρώο (χρεοπίστωση / έξοδο) που να δείχνει εκεί.
//
// Ο λογαριασμός ταιριάζει με τη ΔΙΑΔΡΟΜΗ ονομάτων του (ομάδα → υποομάδα → λογαριασμός), όχι μόνο με
// το δικό του όνομα: στο ΕΓΛΣ ο 62.07.02.0024 λέγεται «Μηχανημάτων με Φ.Π.Α. 24%» — το «Επισκευές»
// είναι στον 62.07.
import type { ExpenseFamily } from './expense-families';

/** Πώς λέγεται κάθε οικογένεια δαπάνης μέσα στο λογιστικό σχέδιο (στα κεφαλαία χωρίς τόνους). */
export const FAMILY_CHART_HINT: Record<ExpenseFamily, RegExp> = {
  customs: /ΕΚΤΕΛΩΝΙΣ|ΤΕΛΩΝΕΙ|ΔΑΣΜ/,
  courier: /ΤΑΧΥΔΡΟΜ|ΤΑΧΥΜΕΤΑΦ|COURIER/,
  freight: /ΕΞΟΔΑ ΜΕΤΑΦ|ΝΑΥΛ/,
  fuel: /ΚΑΥΣΙΜ/,
  software: /ΛΟΓΙΣΜΙΚ|ΜΗΧΑΝΟΓΡΑΦ/,
  hosting: /ΔΙΑΔΙΚΤ|ΙΣΤΟΣΕΛ|ΤΗΛΕΠΙΚΟΙΝ/,
  fees: /ΑΜΟΙΒ/,
  commission: /ΠΡΟΜΗΘΕΙ/,
  rent: /ΕΝΟΙΚΙ/,
  insurance: /ΑΣΦΑΛΙΣΤΡ/,
  repairs: /ΕΠΙΣΚΕΥ|ΣΥΝΤΗΡΗΣ/,
  stationery: /ΓΡΑΦΙΚΗ ΥΛΗ|ΕΝΤΥΠΑ/,
  travel: /ΟΔΟΙΠΟΡΙΚ|ΤΑΞΙΔ/,
  meals: /ΦΙΛΟΞΕΝ|ΕΣΤΙΑΣ/,
};

/** Μόνο λογαριασμοί εξόδων (ομάδα 6) και ειδικά έξοδα αγορών (32) — ποτέ πάγια, απαιτήσεις κ.λπ. */
export const EXPENSE_ACCOUNT_PREFIXES = ['6', '32'] as const;

export interface ChartAccount { code: string; name: string }

export const foldName = (s: string | null | undefined): string =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

/** «…0024» → 24, μόνο για συντελεστές που υπάρχουν στην Ελλάδα. */
export function vatOfAccount(code: string): number | null {
  const m = /\.00(\d\d)$/.exec(code);
  if (!m) return null;
  const n = Number(m[1]);
  return [0, 4, 6, 9, 13, 16, 17, 19, 23, 24].includes(n) ? n : null;
}

/** Η διαδρομή ονομάτων ενός λογαριασμού: «ΕΠΙΣΚΕΥΕΣ ΚΑΙ ΣΥΝΤΗΡΗΣΕΙΣ › ΜΗΧΑΝΗΜΑΤΩΝ … › ΜΗΧΑΝΗΜΑΤΩΝ ΜΕ ΦΠΑ 24%». */
export function accountPath(code: string, nameByCode: ReadonlyMap<string, string>): string {
  const parts = code.split('.');
  const names: string[] = [];
  for (let i = 1; i <= parts.length; i++) {
    const n = nameByCode.get(parts.slice(0, i).join('.'));
    if (n) names.push(foldName(n));
  }
  return names.join(' › ');
}

/** Πρόταση ονόματος νέου λογαριασμού από τον αδελφό του και τον ΦΠΑ. */
export function nameForVat(siblingName: string, vat: number): string {
  const base = siblingName.replace(/\s+(με|άνευ)\s+Φ\.?Π\.?Α\.?.*$/i, '').trim();
  return vat === 0 ? `${base} άνευ Φ.Π.Α.` : `${base} με Φ.Π.Α. ${vat}%`;
}

export interface FamilyAccountProposal {
  /** Κινούμενοι λογαριασμοί που ταιριάζουν — πρώτα του σωστού ΦΠΑ. */
  suggestions: ChartAccount[];
  /**
   * Ο λογαριασμός που ΛΕΙΠΕΙ για αυτόν τον ΦΠΑ: υπάρχουν αδέλφια με άλλους συντελεστές, αλλά όχι με
   * τον σωστό. Ο γονικός είναι ο συχνότερος ανάμεσα στους λογαριασμούς της οικογένειας.
   */
  toOpen: { code: string; name: string; vatRate: number; parent: string } | null;
}

/**
 * Οι λογαριασμοί του σχεδίου για μια οικογένεια και έναν ΦΠΑ. `accounts` = κινούμενοι λογαριασμοί
 * εξόδων, με τη διαδρομή ονομάτων τους ήδη υπολογισμένη.
 */
export function proposeFamilyAccounts(
  accounts: readonly (ChartAccount & { path: string })[],
  family: ExpenseFamily,
  vatRate: number | null,
  max = 6,
): FamilyAccountProposal {
  const hint = FAMILY_CHART_HINT[family];
  const all = accounts.filter((a) => hint.test(a.path));
  const rank = (code: string) => (vatRate != null && vatOfAccount(code) === vatRate ? 0 : 1);
  const suggestions = [...all].sort((a, b) => rank(a.code) - rank(b.code) || a.code.localeCompare(b.code))
    .slice(0, max).map(({ code, name }) => ({ code, name }));

  let toOpen: FamilyAccountProposal['toOpen'] = null;
  const withVat = all.filter((a) => vatOfAccount(a.code) != null);
  if (vatRate != null && withVat.length && !all.some((a) => vatOfAccount(a.code) === vatRate)) {
    const count = new Map<string, { n: number; sample: ChartAccount }>();
    for (const a of withVat) {
      const parent = a.code.replace(/\.\d+$/, '');
      const c = count.get(parent);
      count.set(parent, { n: (c?.n ?? 0) + 1, sample: c?.sample ?? a });
    }
    const [parent, { sample }] = [...count.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))[0];
    const code = `${parent}.00${String(vatRate).padStart(2, '0')}`;
    if (!accounts.some((a) => a.code === code)) toOpen = { code, name: nameForVat(sample.name, vatRate), vatRate, parent };
  }
  return { suggestions, toOpen };
}
