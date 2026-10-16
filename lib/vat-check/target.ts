// Από «ό,τι γράφει το χαρτί» στην αρχή που ρωτάμε: «CHE-116.281.710 MWST» → Ελβετία/UID,
// «NO 923 609 016 MVA» → Νορβηγία/Brønnøysund, «GB553557881» → HMRC, «IT01808880270» → VIES.
import type { VatProvider } from './types';

/** Κράτη-μέλη του VIES (κωδικοί VIES: EL για Ελλάδα, XI για Βόρεια Ιρλανδία). */
export const VIES_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES', 'FI', 'FR', 'HR', 'HU', 'IE', 'IT',
  'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'XI',
]);

export interface VatTarget {
  /** Η χώρα με τον κωδικό της αρχής (EL, XI, GB, NO, CH, …). */
  countryCode: string;
  /** Ό,τι στέλνεται στην αρχή (χωρίς πρόθεμα). */
  number: string;
  /** Κανονική μορφή για εμφάνιση/αποθήκευση. */
  vat: string;
  provider: Exclude<VatProvider, 'fallback'> | null;
}

/** Τυπικές λέξεις γύρω από τον αριθμό που ΔΕΝ είναι μέρος του (VAT No:, MWST, MVA, TVA, IVA). */
function clean(raw: string): string {
  return String(raw ?? '')
    .toUpperCase()
    .replace(/^[\s.:]*(?:Α\.?Φ\.?Μ\.?|VAT(?:\s*REG(?:\.|ISTRATION)?)?(?:\s*(?:NO|NUMBER|ID))?|TAX\s*(?:ID|NO)|USTID(?:NR)?|P\.?\s*IVA)\s*[.:\-]?/, '')
    .replace(/[^A-Z0-9]+/g, '')
    .replace(/(MWST|TVA|IVA|MVA)$/, '');
}

/** `null` = δεν αναγνωρίζεται καν πρόθεμα χώρας. */
export function parseVatTarget(raw: string): VatTarget | null {
  const s = clean(raw);
  if (s.length < 4) return null;
  // Ελβετία: CHE + 9 ψηφία (το «CH» σκέτο το γράφουν συχνά).
  const ch = s.match(/^CHE?(\d{9})$/);
  if (ch) return { countryCode: 'CH', number: ch[1], vat: `CHE${ch[1]}`, provider: 'uid' };
  let prefix = s.slice(0, 2);
  let rest = s.slice(2);
  if (prefix === 'GR') prefix = 'EL';
  if (prefix === 'UK') prefix = 'GB';
  if (!/\d/.test(rest)) return null;
  if (prefix === 'NO') {
    const no = rest.match(/^(\d{9})$/);
    return no ? { countryCode: 'NO', number: no[1], vat: `NO${no[1]}`, provider: 'brreg' } : { countryCode: 'NO', number: rest, vat: `NO${rest}`, provider: 'brreg' };
  }
  if (prefix === 'GB') {
    rest = rest.replace(/\D+/g, '');
    return { countryCode: 'GB', number: rest, vat: `GB${rest}`, provider: 'hmrc' };
  }
  if (VIES_COUNTRIES.has(prefix)) return { countryCode: prefix, number: rest, vat: `${prefix}${rest}`, provider: 'vies' };
  if (/^[A-Z]{2}$/.test(prefix)) return { countryCode: prefix, number: rest, vat: `${prefix}${rest}`, provider: null };
  return null;
}

/** Ο ΑΦΜ του αιτούντος για το VIES: «EL» + σώμα· σκέτα 9 ψηφία θεωρούνται ελληνικός ΑΦΜ. */
export function parseRequester(raw: string | null | undefined): { countryCode: string; number: string } | null {
  const s = clean(String(raw ?? ''));
  if (!s) return null;
  if (/^\d{9}$/.test(s)) return { countryCode: 'EL', number: s };
  const t = parseVatTarget(s);
  return t && t.provider === 'vies' ? { countryCode: t.countryCode, number: t.number } : null;
}
