// lib/ocr/purchase-purpose.ts — ΚΑΘΑΡΟ. «Τι είναι αυτή η αγορά;» σε απλή γλώσσα.
//
// Η εφαρμογή χρησιμοποιείται από υπαλλήλους, όχι από λογιστές. Οι όροι του ERP — είδος, υπηρεσία,
// έξοδο, χρεοπίστωση, πάγιο, επιμερισμός — δεν λένε τίποτα σε όποιον έχει μπροστά του ένα τιμολόγιο
// για ένα laptop. Εδώ ο χρήστης απαντά σε ΜΙΑ απλή ερώτηση («τι αγοράσαμε;») και η εφαρμογή
// διαλέγει μόνη της το σωστό μητρώο, ανάλογα με τη σειρά του παραστατικού.
import { lineKindFits } from './resolution-plan';
import { assetFits, type PostingTarget } from './posting-target';
import { assetLikeLabel } from './asset-code';
import { classifyExpenseFamily, EXPENSE_FAMILY_LABEL } from './expense-families';
import type { MatchKind } from './line-match';

export type Purpose = 'goods' | 'expense' | 'asset' | 'split';

export const PURPOSE_COPY: Record<Purpose, { title: string; description: string; examples: string }> = {
  goods: {
    title: 'Εμπόρευμα ή υλικό',
    description: 'Αγαθά που μπαίνουν στην αποθήκη, μεταπωλούνται ή χρησιμοποιούνται στην παραγωγή.',
    examples: 'π.χ. πρώτες ύλες, ανταλλακτικά, εμπορεύματα',
  },
  expense: {
    title: 'Έξοδο ή υπηρεσία',
    description: 'Κάτι που η επιχείρηση πληρώνει για να λειτουργεί — δεν το κρατάει ως εξοπλισμό.',
    examples: 'π.χ. ρεύμα, καύσιμα, ενοίκιο, τηλέφωνο, συντήρηση, μεταφορικά, αμοιβές, συνδρομές',
  },
  asset: {
    title: 'Εξοπλισμός για χρόνια (πάγιο)',
    description: 'Αγορά που η επιχείρηση κρατά και χρησιμοποιεί για περισσότερο από έναν χρόνο.',
    examples: 'π.χ. υπολογιστής, laptop, μηχάνημα, έπιπλο, όχημα',
  },
  split: {
    title: 'Μοιράζεται σε πολλά',
    description: 'Ένα ποσό που αφορά περισσότερα από ένα είδη εξόδου και πρέπει να χωριστεί.',
    examples: 'π.χ. τιμολόγιο που αφορά μισό ρεύμα, μισό τηλέφωνο',
  },
};

/** Οι επιλογές που ΔΕΧΕΤΑΙ η σειρά του παραστατικού, με σταθερή σειρά. */
export function availablePurposes(target: PostingTarget | null | undefined): Purpose[] {
  const out: Purpose[] = [];
  if (lineKindFits(target, 'product')) out.push('goods');
  if (lineKindFits(target, 'expense') || lineKindFits(target, 'lineitem')) out.push('expense');
  if (assetFits(target)) out.push('asset');
  // Ο επιμερισμός γίνεται σε χρεοπιστώσεις (ή λογαριασμούς εσόδων/εξόδων) — μόνο εκεί εκφράζεται.
  if (target?.lines === 'LINLINES' || target?.lines === 'SXDOCLINES') out.push('split');
  return out;
}

/** Ποιο μητρώο ψάχνουμε για κάθε επιλογή. Το «έξοδο» είναι ΕΞΟΔΟ σε αγορές, ΧΡΕΟΠΙΣΤΩΣΗ σε ειδικές συναλλαγές. */
export function registryKindFor(purpose: Purpose, target: PostingTarget | null | undefined): MatchKind | null {
  if (purpose === 'goods') return 'product';
  if (purpose === 'expense') return lineKindFits(target, 'expense') ? 'expense' : 'lineitem';
  return null;
}

/** Σε ποια επιλογή ανήκει μια ήδη γραμμένη αντιστοίχιση. Η «υπηρεσία» ζει στις προχωρημένες επιλογές. */
export function purposeOfMatch(m: { asset?: number | null; mtrl: number | null; expn: number | null; lin: number | null; isService: boolean | null } | null | undefined): Purpose | null {
  if (!m) return null;
  if (m.asset != null) return 'asset';
  if (m.lin != null || m.expn != null) return 'expense';
  if (m.mtrl != null) return m.isService ? null : 'goods';
  return null;
}

export interface PurposeSuggestion {
  purpose: Purpose;
  /** Γιατί — σε απλή γλώσσα, για να εμπιστευτεί ο χρήστης την πρόταση. */
  reason: string;
  /** Η σειρά του παραστατικού ΔΕΝ δέχεται αυτή την επιλογή — ο χρήστης χρειάζεται κατεύθυνση. */
  blocked: boolean;
}

/**
 * Η προτεινόμενη επιλογή για μια γραμμή χωρίς αντιστοίχιση:
 *   1. εξοπλισμός (laptop, μηχάνημα…) με αξιόλογο ποσό → πάγιο·
 *   2. αναγνωρίσιμη κατηγορία εξόδου (καύσιμα, ρεύμα, συντήρηση…) ή έτοιμη πρόταση μητρώου → έξοδο·
 *   3. αλλιώς ό,τι προτείνει η σειρά (είδος → εμπόρευμα, έξοδο/χρεοπίστωση → έξοδο).
 */
export function suggestPurpose(input: {
  lineName: string | null | undefined;
  amount?: number | null;
  hasRegistrySuggestion?: boolean;
  defaultKind: MatchKind | null;
  target: PostingTarget | null | undefined;
}): PurposeSuggestion | null {
  const available = availablePurposes(input.target);
  const asset = assetLikeLabel(input.lineName, input.amount);
  if (asset) {
    return { purpose: 'asset', reason: `Η περιγραφή μοιάζει με ${asset} — αγορά που η επιχείρηση κρατά για χρόνια.`, blocked: !available.includes('asset') };
  }
  const family = classifyExpenseFamily(input.lineName);
  if (family || input.hasRegistrySuggestion) {
    return {
      purpose: 'expense',
      reason: family ? `Η περιγραφή μοιάζει με «${EXPENSE_FAMILY_LABEL[family]}».` : 'Υπάρχει έτοιμη πρόταση από προηγούμενα παραστατικά.',
      blocked: !available.includes('expense'),
    };
  }
  if (input.defaultKind === 'product' && available.includes('goods')) {
    return { purpose: 'goods', reason: 'Οι άλλες γραμμές του παραστατικού είναι εμπορεύματα/υλικά.', blocked: false };
  }
  if ((input.defaultKind === 'expense' || input.defaultKind === 'lineitem') && available.includes('expense')) {
    return { purpose: 'expense', reason: 'Το παραστατικό καταχωρείται ως έξοδο.', blocked: false };
  }
  return null;
}

/** Τι να κάνει ο χρήστης όταν η σωστή επιλογή δεν χωράει στη σειρά του παραστατικού. */
export function blockedAdvice(purpose: Purpose): string {
  switch (purpose) {
    case 'asset':
      return 'Η σειρά αυτού του παραστατικού δεν δέχεται πάγια. Αν πρόκειται πράγματι για εξοπλισμό, άλλαξε τη σειρά σε «Τιμολόγιο αγοράς» από την κάρτα του παραστατικού — ή ρώτα τον λογιστή.';
    case 'goods':
      return 'Η σειρά αυτού του παραστατικού δεν δέχεται εμπορεύματα. Άλλαξε τη σειρά σε «Τιμολόγιο αγοράς» — ή ρώτα τον λογιστή.';
    case 'expense':
      return 'Η σειρά αυτού του παραστατικού δεν δέχεται έξοδα. Άλλαξε σειρά — ή ρώτα τον λογιστή.';
    case 'split':
      return 'Ο επιμερισμός γίνεται μόνο σε παραστατικά ειδικών συναλλαγών.';
  }
}

/**
 * «Δεν είμαι σίγουρος»: δύο-τρεις ερωτήσεις ναι/όχι που καταλήγουν σε επιλογή. Η λογική είναι η
 * ίδια που θα έκανε ένας λογιστής: διάρκεια χρήσης → αξία → σκοπός.
 */
export interface QuizAnswers {
  /** Θα το χρησιμοποιείτε για περισσότερο από έναν χρόνο; */
  longTerm?: boolean;
  /** Κοστίζει πάνω από ~150 €; (μόνο αν longTerm) */
  expensive?: boolean;
  /** Το μεταπωλείτε ή γίνεται μέρος του προϊόντος σας; (μόνο αν !longTerm) */
  resale?: boolean;
}

export function quizOutcome(a: QuizAnswers): Purpose | null {
  if (a.longTerm === true) {
    if (a.expensive == null) return null;
    return a.expensive ? 'asset' : 'expense';
  }
  if (a.longTerm === false) {
    if (a.resale == null) return null;
    return a.resale ? 'goods' : 'expense';
  }
  return null;
}

/** «Τι θα γίνει» σε απλή γλώσσα, μόλις ο χρήστης επιλέξει. */
export const PURPOSE_OUTCOME: Record<Purpose, string> = {
  goods: 'Θα καταχωριστεί ως αγορά εμπορεύματος/υλικού — μπαίνει στην αποθήκη με την ποσότητα και την τιμή του.',
  expense: 'Θα καταχωριστεί ως έξοδο της επιχείρησης, στην κατηγορία που θα διαλέξεις.',
  asset: 'Θα καταχωριστεί ως αγορά εξοπλισμού (πάγιο): η αξία του δεν «χάνεται» μονομιάς αλλά αποσβένεται σε βάθος χρόνου.',
  split: 'Το ποσό της γραμμής θα χωριστεί σε περισσότερες κατηγορίες εξόδου, με ποσό ή ποσοστό για την καθεμία.',
};

// ─────────────────────────────────────────────────────────────────────────────
// ΚΑΘΗΜΕΡΙΝΕΣ ΚΑΤΗΓΟΡΙΕΣ — αυτό που βλέπει ο χρήστης
// ─────────────────────────────────────────────────────────────────────────────
//
// Για τον υπάλληλο ΟΛΑ είναι «έξοδο»: το laptop, η βενζίνη, το leasing, ο λογαριασμός ρεύματος. Η
// διάκριση πάγιο / έξοδο / χρεοπίστωση είναι δουλειά της εφαρμογής. Γι' αυτό η πρώτη ερώτηση
// είναι «τι αφορά;» με καθημερινές κατηγορίες, και κάθε κατηγορία ξέρει (α) σε τι καταχωρείται
// λογιστικά (`purpose`) και (β) με ποια λέξη να ξεκινήσει η αναζήτηση του επόμενου βήματος.

export type Tile = 'equipment' | 'vehicle' | 'rent' | 'bills' | 'services' | 'goods' | 'split';

export interface TileDef {
  purpose: Purpose;
  title: string;
  examples: string;
  /** Η λέξη με την οποία ξεκινά η αναζήτηση στο 2ο βήμα (κενό = χωρίς). */
  searchHint: string;
  /** Τι σημαίνει λογιστικά — μία πρόταση, μόνο όπου διαφέρει από αυτό που περιμένει ο χρήστης. */
  accountingNote?: string;
}

export const TILES: Record<Tile, TileDef> = {
  equipment: {
    purpose: 'asset', title: 'Εξοπλισμός ή συσκευή', examples: 'laptop, υπολογιστής, κινητό, μηχάνημα, έπιπλο',
    searchHint: '',
    accountingNote: 'Για εσένα είναι έξοδο — δεν χρειάζεται να κάνεις κάτι παραπάνω· η εφαρμογή το περνά στον εξοπλισμό της επιχείρησης όπως θέλει ο λογιστής.',
  },
  vehicle: { purpose: 'expense', title: 'Αυτοκίνητο & μετακινήσεις', examples: 'βενζίνη, diesel, διόδια, πάρκινγκ, εισιτήρια', searchHint: 'καύσιμα' },
  rent: { purpose: 'expense', title: 'Ενοίκιο, leasing, μίσθωμα', examples: 'μίσθωμα αυτοκινήτου, ενοίκιο γραφείου ή αποθήκης', searchHint: 'ενοίκια' },
  bills: { purpose: 'expense', title: 'Λογαριασμοί', examples: 'ρεύμα, νερό, φυσικό αέριο, τηλέφωνο, internet', searchHint: '' },
  services: { purpose: 'expense', title: 'Υπηρεσίες & αμοιβές', examples: 'συντήρηση, επισκευή, μεταφορικά, λογιστής, συνδρομές λογισμικού', searchHint: '' },
  goods: {
    purpose: 'goods', title: 'Εμπορεύματα & υλικά', examples: 'για αποθήκη, μεταπώληση ή παραγωγή — πρώτες ύλες, ανταλλακτικά',
    searchHint: '',
    accountingNote: 'Μπαίνουν στην αποθήκη με ποσότητα και τιμή.',
  },
  split: {
    purpose: 'split', title: 'Αφορά πολλά μαζί', examples: 'θέλω να μοιράσω το ποσό σε περισσότερα έξοδα', searchHint: '',
    accountingNote: 'Λογιστικά λέγεται «επιμερισμός»: το ποσό χωρίζεται με ποσό ή ποσοστό ανά κατηγορία.',
  },
};

export const TILE_ORDER: Tile[] = ['equipment', 'vehicle', 'rent', 'bills', 'services', 'goods', 'split'];

/** Οι κατηγορίες που δέχεται η σειρά του παραστατικού (ο εξοπλισμός μένει ορατός, με κατεύθυνση). */
export function availableTiles(target: PostingTarget | null | undefined): { tile: Tile; blocked: boolean }[] {
  const ok = new Set(availablePurposes(target));
  return TILE_ORDER
    .map((tile) => ({ tile, blocked: !ok.has(TILES[tile].purpose) }))
    // Ό,τι δεν χωράει κρύβεται — εκτός από τον εξοπλισμό: ένα laptop σε λάθος σειρά πρέπει να ΦΑΙΝΕΤΑΙ,
    // με οδηγία, αντί να αναγκαστεί ο χρήστης να το περάσει ως κάτι άλλο.
    .filter((t) => !t.blocked || t.tile === 'equipment');
}

const BILLS = /ΡΕΥΜΑ|ΗΛΕΚΤΡ|ΚΑΤΑΝΑΛΩΣΗ ΕΝΕΡΓ|ΝΕΡΟ|ΥΔΡΕΥΣ|ΑΠΟΧΕΤΕΥΣ|ΦΥΣΙΚΟ ΑΕΡΙΟ|ΤΗΛΕΦΩΝ|ΚΙΝΗΤΗ ΤΗΛ|INTERNET|ΔΙΑΔΙΚΤΥ|ΔΕΗ|ΕΥΔΑΠ|ΕΥΑΘ|COSMOTE|VODAFONE|NOVA/;
const fold = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/** Η καθημερινή κατηγορία μιας ήδη γραμμένης αντιστοίχισης ή μιας προτεινόμενης επιλογής. */
export function tileForPurpose(purpose: Purpose): Tile {
  return purpose === 'asset' ? 'equipment' : purpose === 'goods' ? 'goods' : purpose === 'split' ? 'split' : 'services';
}

/**
 * Η προτεινόμενη καθημερινή κατηγορία για μια γραμμή, με εξήγηση. Πρώτα ο εξοπλισμός (με αξιόλογο
 * ποσό), μετά ό,τι λέει η περιγραφή (καύσιμα → αυτοκίνητο, μίσθωμα → ενοίκιο, ρεύμα → λογαριασμοί),
 * μετά η γενική πρόταση της `suggestPurpose`.
 */
export function suggestTile(input: Parameters<typeof suggestPurpose>[0]): { tile: Tile; reason: string; blocked: boolean } | null {
  const base = suggestPurpose(input);
  if (base?.purpose === 'asset') return { tile: 'equipment', reason: base.reason, blocked: base.blocked };
  const t = fold(input.lineName);
  const family = classifyExpenseFamily(input.lineName);
  const expenseOk = availablePurposes(input.target).includes('expense');
  const pick = (tile: Tile, reason: string) => ({ tile, reason, blocked: !expenseOk });
  if (family === 'fuel' || family === 'travel') return pick('vehicle', `Η περιγραφή μοιάζει με «${EXPENSE_FAMILY_LABEL[family]}».`);
  if (family === 'rent' || /LEASING|ΜΙΣΘΩΜ|ΜΙΣΘΩΣ/.test(t)) return pick('rent', 'Η περιγραφή μοιάζει με μίσθωμα ή ενοίκιο.');
  if (BILLS.test(t)) return pick('bills', 'Η περιγραφή μοιάζει με λογαριασμό ρεύματος, νερού ή τηλεφώνου.');
  if (base) return { tile: tileForPurpose(base.purpose), reason: base.reason, blocked: base.blocked };
  return null;
}
