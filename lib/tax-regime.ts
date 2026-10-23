// lib/tax-regime.ts — ΚΑΘΑΡΟ (χωρίς prisma / δίκτυο / server-only).
//
// **Χώρα εγκατάστασης** → τι ισχύει φορολογικά για ΑΥΤΗ την εγκατάσταση.
//
// Η εφαρμογή γράφτηκε με την Ελλάδα δεδομένη: myDATA παντού, ΑΦΜ εννέα ψηφίων, Δ.Ο.Υ., ΑΑΔΕ. Σε
// εγκατάσταση **Κύπρου** τίποτα από αυτά δεν υπάρχει — και μια προειδοποίηση «λείπει χαρακτηρισμός
// myDATA» εκεί δεν είναι απλώς άχρηστη: λέει στον χρήστη ότι κάτι πάει στραβά ενώ όλα είναι εντάξει.
//
// Η απόφαση παίρνεται ΜΙΑ φορά, στην αρχικοποίηση (`setup.country`), και διαβάζεται από εδώ.
// Καμία άλλη μονάδα δεν ελέγχει κωδικό χώρας μόνη της: αλλιώς η επόμενη χώρα θα απαιτούσε κυνήγι
// σε ογδόντα οκτώ αρχεία.

/** Οι χώρες εγκατάστασης που στηρίζει σήμερα η εφαρμογή. */
export const INSTALL_COUNTRIES = ['GR', 'CY'] as const;
export type InstallCountry = typeof INSTALL_COUNTRIES[number];

export const INSTALL_COUNTRY_OPTIONS: { value: InstallCountry; label: string }[] = [
  { value: 'GR', label: 'Ελλάδα' },
  { value: 'CY', label: 'Κύπρος' },
];

export interface TaxRegime {
  country: InstallCountry;
  /** Ηλεκτρονική διαβίβαση παραστατικών (myDATA). Μόνο Ελλάδα. */
  myData: boolean;
  /** Υπάρχει μητρώο Δ.Ο.Υ. στο οποίο ανήκει ο συναλλασσόμενος; Μόνο Ελλάδα. */
  taxOffices: boolean;
  /** Η ονομασία του φορολογικού μητρώου, για τα κείμενα. */
  vatLabel: string;
  /** Η αρχή που εκδίδει τα στοιχεία μητρώου — για τα κείμενα και τις αναζητήσεις. */
  registryLabel: string;
}

const REGIMES: Record<InstallCountry, TaxRegime> = {
  GR: { country: 'GR', myData: true,  taxOffices: true,  vatLabel: 'ΑΦΜ', registryLabel: 'ΑΑΔΕ' },
  // Κύπρος: ΤΦ (Τμήμα Φορολογίας). Δεν υπάρχει myDATA, δεν υπάρχουν Δ.Ο.Υ.· το ΑΦΜ λέγεται ΑΦΤ.
  CY: { country: 'CY', myData: false, taxOffices: false, vatLabel: 'ΑΦΤ', registryLabel: 'Τμήμα Φορολογίας' },
};

/** Η χώρα από τη ρύθμιση, με **Ελλάδα** ως προεπιλογή όταν λείπει ή είναι άγνωστη. */
export function asInstallCountry(raw: unknown): InstallCountry {
  const v = String(raw ?? '').trim().toUpperCase();
  return (INSTALL_COUNTRIES as readonly string[]).includes(v) ? (v as InstallCountry) : 'GR';
}

/** Το καθεστώς της εγκατάστασης. Δέχεται ό,τι κι αν κρατά η ρύθμιση. */
export function taxRegime(raw: unknown): TaxRegime {
  return REGIMES[asInstallCountry(raw)];
}

/** Συντομία για το πιο συχνό ερώτημα: στέλνουμε/ζητάμε χαρακτηρισμό myDATA; */
export const hasMyData = (raw: unknown): boolean => taxRegime(raw).myData;
