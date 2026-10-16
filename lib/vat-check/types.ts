// Κοινοί τύποι του ελέγχου ξένου ΑΦΜ (ΕΕ/VIES, Ηνωμένο Βασίλειο/HMRC, Νορβηγία/Brønnøysund, Ελβετία/UID).
// Ανεξάρτητο module: μόνο `fetch` — χωρίς Next.js, Prisma ή ρυθμίσεις εφαρμογής (βλ. skill «VIES»).

export type VatCountry = string; // ISO-2 της αρχής που ρωτάμε (EL για Ελλάδα, XI για Β. Ιρλανδία)

export type VatProvider = 'vies' | 'hmrc' | 'brreg' | 'uid' | 'fallback';

export type VatCheckError =
  | 'invalid_format'   // το ΑΦΜ δεν έχει τη μορφή της χώρας
  | 'unsupported'      // χώρα χωρίς δημόσιο μητρώο (Τουρκία, ΗΠΑ, …)
  | 'not_configured'   // π.χ. ΗΒ χωρίς διαπιστευτήρια HMRC
  | 'unauthorized'     // απορρίφθηκαν τα διαπιστευτήρια
  | 'rate_limited'     // όριο αιτημάτων της αρχής (μετά τις επαναλήψεις)
  | 'unavailable'      // η αρχή της χώρας δεν απαντά τώρα
  | 'blocked'          // VAT_BLOCKED / IP_BLOCKED του VIES
  | 'network';

/** Αποτέλεσμα σύγκρισης στοιχείων (VIES «approximate matching»). */
export type MatchFlag = 'VALID' | 'INVALID' | 'NOT_PROCESSED';

export interface VatTraderInput {
  name?: string | null;
  street?: string | null;
  postalCode?: string | null;
  city?: string | null;
}

export interface VatCheckResult {
  /** Κανονική μορφή: πρόθεμα + σώμα (IT01808880270, CHE116281710, NO923609016, GB553557881). */
  vat: string;
  countryCode: VatCountry;
  /** `true` ενεργό · `false` μη ενεργό/ανύπαρκτο · `null` δεν έγινε έλεγχος (βλ. `error`). */
  valid: boolean | null;
  name: string | null;
  address: string | null;
  provider: VatProvider | null;
  /** Η αρχή που απάντησε, για εμφάνιση (VIES, HMRC, Brønnøysundregistrene, UID-Register). */
  source: string | null;
  /** Επίσημος αριθμός ελέγχου (VIES `requestIdentifier`, HMRC `consultationNumber`) — αποδεικτικό. */
  consultationNumber: string | null;
  /** Πότε απάντησε η αρχή (ISO). */
  checkedAt: string;
  /** Σύγκριση των στοιχείων που στείλαμε (μόνο VIES, όπου το κράτος το υποστηρίζει). */
  match?: { name?: MatchFlag; street?: MatchFlag; postalCode?: MatchFlag; city?: MatchFlag } | null;
  error?: VatCheckError;
  /** Ελληνικό μήνυμα για τον χρήστη (σε αποτυχία ή σημείωση, π.χ. «δεν είναι εγγεγραμμένο στο ΦΠΑ»). */
  message?: string;
  /** Ο κωδικός σφάλματος της αρχής (π.χ. MS_UNAVAILABLE), για logs. */
  detail?: string;
}

export interface VatCheckConfig {
  /**
   * ΔΙΚΟΣ ΜΑΣ ΑΦΜ με πρόθεμα (π.χ. «EL123456789»). Με αυτόν το VIES επιστρέφει αριθμό ελέγχου
   * (`requestIdentifier`) — αποδεικτικό ότι ελέγξαμε τον πελάτη πριν από ενδοκοινοτική πράξη.
   */
  requesterVat?: string | null;
  /** HMRC «Check a UK VAT number» v2 (OAuth client credentials, scope read:vat). */
  hmrc?: {
    clientId: string;
    clientSecret: string;
    /** production (προεπιλογή) ή sandbox. */
    env?: 'production' | 'sandbox';
    /** ΔΙΚΟΣ ΜΑΣ ΑΦΜ ΗΒ (9/12 ψηφία) — μόνο αν υπάρχει: δίνει αριθμό ελέγχου. */
    requesterVrn?: string | null;
  } | null;
  /** Εφεδρεία όταν μια χώρα δεν μπορεί να ελεγχθεί αλλιώς (π.χ. ΗΒ χωρίς HMRC → εμπορικός πάροχος). */
  fallback?: ((target: { countryCode: VatCountry; number: string; vat: string }) => Promise<VatCheckResult | null>) | null;
  /** Χρονικό όριο ανά κλήση (ms). Προεπιλογή 12000. */
  timeoutMs?: number;
  /** Αναμονές πριν από κάθε επανάληψη σε φόρτο/καθυστέρηση της αρχής (ms). Προεπιλογή [1500, 4000]. */
  retryDelaysMs?: number[];
  /** Για tests. */
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}
