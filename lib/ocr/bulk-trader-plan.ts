// lib/ocr/bulk-trader-plan.ts — ΚΑΘΑΡΟ (χωρίς prisma / δίκτυο).
//
// Η ΚΡΙΣΗ ΚΑΘΕ ΓΡΑΜΜΗΣ της μαζικής δημιουργίας συναλλασσομένων: τι προεπιλέγεται και τι όχι.
//
// ΓΙΑΤΙ ΔΕΝ ΠΡΟΕΠΙΛΕΓΟΝΤΑΙ ΟΛΕΣ. Η μαζική δημιουργία γράφει δεκάδες καρτέλες στο ERP με ένα πάτημα,
// και μια λάθος καρτέλα εκεί δεν σβήνεται εύκολα (δεν υπάρχει `delData` στην εφαρμογή). Στα
// πραγματικά δεδομένα βρέθηκαν, πριν γραφτεί αυτό το αρχείο:
//   • ΛΑΘΗ ΑΝΑΓΝΩΣΗΣ ΑΦΜ — «09401924» (8 ψηφία· ο ΟΤΕ είναι 094019245), «999867881» (η Entersoft
//     είναι 999863881). Δημιουργία με αυτά = καρτέλα με ψεύτικο ΑΦΜ στο μητρώο του πελάτη.
//   • ΞΕΝΟΙ ΧΩΡΙΣ ΠΡΟΘΕΜΑ ΧΩΡΑΣ — Senlikoglu, Azelis, BESSEY, INO. Το route υποθέτει «GR» όταν
//     δεν δοθεί χώρα, άρα θα έφτιαχνε ΕΛΛΗΝΙΚΟ συναλλασσόμενο με τουρκικό/ιταλικό αριθμό.
// Προεπιλέγεται ΜΟΝΟ ό,τι είναι ασφαλές. Τα υπόλοιπα φαίνονται με τον λόγο τους και ο χρήστης
// αποφασίζει.
import { isValidAfm, normalizeVatId } from '@/lib/ocr/validate';

export type TraderKind = 'supplier' | 'creditor' | 'debtor';

export type PlanStatus =
  /** Ασφαλές — προεπιλέγεται. */
  | 'ready'
  /** Ξένος χωρίς πρόθεμα χώρας: χρειάζεται χώρα. Μπορεί να υπάρχει ΠΡΟΤΑΣΗ, ποτέ σιωπηλή επιλογή. */
  | 'needs_country'
  /** Το ΑΦΜ δεν περνά τον έλεγχο ψηφίου: σχεδόν σίγουρα λάθος ανάγνωσης. */
  | 'invalid_afm';

export interface PlanInput {
  afm: string;
  name: string | null;
  /** Η χώρα όπως την έβγαλε η ουρά (`null` = άγνωστη). */
  country: string | null;
  suggestedKind: TraderKind;
  /** Οι τύποι που ζητούν οι σειρές των παραστατικών, με σειρά προτεραιότητας. */
  missingKinds: TraderKind[];
}

export interface PlanRow {
  afm: string;
  name: string;
  kind: TraderKind;
  /** Η χώρα που θα σταλεί. `null` μόνο όταν `status === 'needs_country'` χωρίς πρόταση. */
  country: string | null;
  /** `true` όταν η χώρα είναι ΠΡΟΤΑΣΗ από το όνομα — θέλει ματιά. */
  countryGuessed: boolean;
  status: PlanStatus;
  /** Γιατί — στα Ελληνικά, για τη στήλη «Κατάσταση». */
  reason: string;
  /** Ελληνικό ΑΦΜ → άντληση στοιχείων από ΑΑΔΕ πριν τη δημιουργία. */
  useAade: boolean;
  selected: boolean;
}

/**
 * Πρόταση χώρας από τη ΝΟΜΙΚΗ ΜΟΡΦΗ στο όνομα. Μόνο μορφές που ανήκουν ΜΟΝΟΣΗΜΑΝΤΑ σε μία χώρα —
 * το «Ltd» ή το «SA» υπάρχουν σε δεκάδες και δεν προτείνουν τίποτα.
 */
const LEGAL_FORM_COUNTRY: [RegExp, string][] = [
  [/\bGmbH\b|\bKG\b|\bAG\b(?=.*\b(?:Deutschland|Germany)\b)/i, 'DE'],
  [/\bS\.?r\.?l\.?\b|\bS\.?p\.?A\.?\b/i, 'IT'],
  // ΟΧΙ `/\bAS\b/i`: θα έπιανε την αγγλική λέξη «as». Μόνο η γραφή με τελείες ή το «San. ve Tic.».
  [/A\.Ş\.|A\.S\.(?=\s*$)|San\.\s*ve\s*Tic\./i, 'TR'],
  [/\bD\.?O\.?O\.?\b/i, 'RS'],
  [/\bS\.?A\.?L\.?\b/i, 'LB'],
  [/\bIsrael\b/i, 'IL'],
  [/\bB\.?V\.?\b/i, 'NL'],
  [/\bS\.?A\.?R\.?L\.?\b/i, 'FR'],
  [/\bSp\.?\s?z\s?o\.?o\.?\b/i, 'PL'],
];

/** Ελληνικά γράμματα στο όνομα ⇒ ελληνική επιχείρηση (για να ξεχωρίσει «λάθος ΑΦΜ» από «ξένος»). */
const GREEK = /[Ͱ-Ͽἀ-῿]/;

export function guessCountry(name: string | null | undefined): string | null {
  const n = String(name ?? '');
  for (const [re, cc] of LEGAL_FORM_COUNTRY) if (re.test(n)) return cc;
  return null;
}

export function planRow(g: PlanInput): PlanRow {
  const name = (g.name ?? '').trim() || g.afm;
  // Ο τύπος που ΖΗΤΑ η σειρά προηγείται της γενικής πρότασης: αυτόν θα δεχτεί η κεφαλίδα.
  const kind = g.missingKinds[0] ?? g.suggestedKind;
  const vat = normalizeVatId(g.afm);
  const base = { afm: g.afm, name, kind, countryGuessed: false, useAade: false };

  // Γνωστό πρόθεμα χώρας ή έγκυρο ελληνικό ΑΦΜ.
  if (vat?.country === 'GR' || g.country === 'GR') {
    return { ...base, country: 'GR', status: 'ready', reason: 'Έγκυρο ΑΦΜ — στοιχεία από ΑΑΔΕ', useAade: true, selected: true };
  }
  if (vat?.country) {
    return { ...base, country: vat.country, status: 'ready', reason: `Ξένος (${vat.country}) — με πρόθεμα χώρας`, selected: true };
  }

  const digits = g.afm.replace(/\D+/g, '');
  // Ελληνικό όνομα με ΑΦΜ που δεν περνά τον έλεγχο: λάθος ανάγνωσης, όχι ξένος.
  if (GREEK.test(name) || (digits.length <= 9 && /^\d+$/.test(g.afm) && !guessCountry(name))) {
    const why = digits.length !== 9
      ? `Το ΑΦΜ έχει ${digits.length} ψηφία αντί για 9 — πιθανό λάθος ανάγνωσης`
      : 'Το ΑΦΜ δεν περνά τον έλεγχο ψηφίου — πιθανό λάθος ανάγνωσης';
    return { ...base, country: null, status: 'invalid_afm', reason: `${why}. Διόρθωσέ το στο παραστατικό.`, selected: false };
  }

  const guess = guessCountry(name);
  return {
    ...base,
    country: guess,
    countryGuessed: guess != null,
    status: 'needs_country',
    reason: guess
      ? `Ξένος χωρίς πρόθεμα χώρας — πρόταση ${guess} από τη νομική μορφή. Επιβεβαίωσε.`
      : 'Ξένος χωρίς πρόθεμα χώρας — διάλεξε χώρα.',
    selected: false,
  };
}

/** `true` όταν ένα ΑΦΜ που η ουρά θεωρεί ελληνικό είναι πράγματι έγκυρο (για τα τεστ / UI). */
export const greekAfmOk = (afm: string) => isValidAfm(afm);
