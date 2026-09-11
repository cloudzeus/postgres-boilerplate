/**
 * ISO-2 χώρα → πρόθεμα VAT identifier.
 *
 * Καθαρό module: καμία εξάρτηση από βάση/δίκτυο, ώστε να χρησιμοποιείται και από
 * server routes και από client components.
 *
 * Οι ΕΞΑΙΡΕΣΕΙΣ όπου το πρόθεμα ΔΕΝ ισούται με τον ISO-2 κωδικό:
 * - Ελλάδα: ISO `GR`, VAT πρόθεμα **`EL`**.
 * - Β. Ιρλανδία: δικό της πρόθεμα **`XI`** (πρωτόκολλο ΗΒ/ΕΕ) — δεν έχει ISO-2 χώρας.
 * - Ελβετία: **`CHE`** (τρία γράμματα, MWST/TVA/IVA).
 * - Μονακό: οι επιχειρήσεις παίρνουν ΓΑΛΛΙΚΟ αριθμό ΦΠΑ, άρα πρόθεμα **`FR`**.
 */
export const VAT_PREFIX_BY_COUNTRY: Readonly<Record<string, string>> = {
  // ΕΕ-27
  AT: 'AT', BE: 'BE', BG: 'BG', CY: 'CY', CZ: 'CZ', DE: 'DE', DK: 'DK',
  EE: 'EE', ES: 'ES', FI: 'FI', FR: 'FR', GR: 'EL', HR: 'HR', HU: 'HU',
  IE: 'IE', IT: 'IT', LT: 'LT', LU: 'LU', LV: 'LV', MT: 'MT', NL: 'NL',
  PL: 'PL', PT: 'PT', RO: 'RO', SE: 'SE', SI: 'SI', SK: 'SK',
  // Ηνωμένο Βασίλειο & Β. Ιρλανδία
  GB: 'GB', XI: 'XI',
  // ΕΖΕΣ / ΕΟΧ
  CH: 'CHE', NO: 'NO', IS: 'IS', LI: 'LI',
  // Μικρά κράτη με τυποποιημένο πρόθεμα
  MC: 'FR', SM: 'SM',
};

/** Δέχεται και τον «κωδικό χώρας» `EL`, που είναι στην πραγματικότητα πρόθεμα. */
const ALIASES: Readonly<Record<string, string>> = { EL: 'GR', UK: 'GB' };

/** Όλα τα έγκυρα προθέματα (για να αναγνωρίζουμε ένα ήδη προθεματισμένο VAT). */
const KNOWN_PREFIXES = new Set(Object.values(VAT_PREFIX_BY_COUNTRY));

/**
 * Το VAT πρόθεμα μιας χώρας, ή `null` όταν δεν την ξέρουμε.
 * `vatPrefixFor('GR') === 'EL'`, `vatPrefixFor('CH') === 'CHE'`.
 */
export function vatPrefixFor(countryCode: string | null | undefined): string | null {
  const raw = String(countryCode ?? '').trim().toUpperCase();
  if (!raw) return null;
  const iso = ALIASES[raw] ?? raw;
  return VAT_PREFIX_BY_COUNTRY[iso] ?? null;
}

/** Καθαρίζει ένα VAT σε κεφαλαία αλφαριθμητικά (κενά, τελείες, παύλες φεύγουν). */
const cleanVat = (v: unknown): string => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, '');

/**
 * Αναγνωρίζει ένα ΗΔΗ προθεματισμένο VAT. Ελέγχει πρώτα τα τρία γράμματα (CHE)
 * και μετά τα δύο, και απαιτεί να ακολουθεί τουλάχιστον ένα ψηφίο — αλλιώς
 * «DE12» θα μπερδευόταν με έναν αριθμό που τυχαίνει να αρχίζει με γράμματα.
 */
function existingPrefix(clean: string): string | null {
  for (const len of [3, 2]) {
    const p = clean.slice(0, len);
    if (p.length === len && KNOWN_PREFIXES.has(p) && /^[A-Z0-9]*\d/.test(clean.slice(len))) return p;
  }
  // «GR999863881» δεν είναι κανονικό πρόθεμα ΦΠΑ αλλά το γράφουν συχνά.
  if (clean.startsWith('GR') && /\d/.test(clean.slice(2))) return 'GR';
  return null;
}

/**
 * Προσθέτει το πρόθεμα της χώρας σε ένα ΑΦΜ που δεν το έχει.
 *
 * - Ήδη προθεματισμένο → επιστρέφεται ως έχει (καθαρισμένο).
 * - Ελλάδα (`GR`/`EL`) → ΜΟΝΟ τα ψηφία· ελληνικό ΑΦΜ δεν προθεματίζεται ποτέ.
 * - Άγνωστη χώρα → το VAT γυρίζει καθαρισμένο, χωρίς πρόθεμα.
 */
export function applyVatPrefix(vat: string, countryCode: string): string {
  const clean = cleanVat(vat);
  if (!clean) return '';
  const iso = (ALIASES[String(countryCode ?? '').trim().toUpperCase()]
    ?? String(countryCode ?? '').trim().toUpperCase());

  const already = existingPrefix(clean);
  // Ελληνικό: ό,τι κι αν γράφει το χαρτί («EL…», «GR…»), αποθηκεύουμε σκέτα ψηφία.
  if (already === 'EL' || already === 'GR') return clean.slice(2).replace(/\D+/g, '');
  // Κάθε άλλο έγκυρο πρόθεμα μένει άθικτο — δεν «διορθώνουμε» χώρα που ήδη δηλώθηκε.
  if (already) return clean;

  if (iso === 'GR') return clean.replace(/\D+/g, '');
  const prefix = vatPrefixFor(iso);
  if (!prefix) return clean;
  // Ένα «CH116281277» με στόχο πρόθεμα «CHE» δεν πρέπει να γίνει «CHECH…».
  if (clean.startsWith(prefix) || (prefix === 'CHE' && clean.startsWith('CH'))) return clean;
  return prefix + clean;
}
