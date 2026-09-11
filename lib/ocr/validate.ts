import { countMissingRequired, type DocType } from '@/lib/ocr/templates';

/**
 * Greek ΑΦΜ check-digit validation (mod-11 over the first 8 digits, weighted
 * by descending powers of two). Non-digit characters are stripped first.
 */
export function isValidAfm(input: string | null | undefined): boolean {
  const afm = String(input ?? '').replace(/\D+/g, '');
  if (!/^\d{9}$/.test(afm)) return false;
  if (afm === '000000000') return false;
  const d = afm.split('').map(Number);
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += d[i] * 2 ** (8 - i);
  const check = (sum % 11) % 10;
  return check === d[8];
}

/**
 * Classify a financial document from its extracted payload.
 *
 * The recipient/Πελάτης is always us (the company running the app), so its
 * PRESENCE — not its value — is the signal: a document that names a recipient is
 * a proper invoice (τιμολόγιο / τιμολόγιο–δελτίο αποστολής), while one with no
 * recipient block at all is a retail receipt (ΑΠΟΔΕΙΞΗ). Returns 'receipt' only
 * for inputs that were financial to begin with; callers pass through general_text.
 */
export function inferDocKind(data: any): 'invoice' | 'receipt' {
  const has = (v: unknown) => v != null && String(v).trim() !== '';
  const hasRecipient = has(data?.customerName) || has(data?.customerVatNumber);
  return hasRecipient ? 'invoice' : 'receipt';
}

/**
 * Country codes we recognise as a VAT-id prefix (EU + EEA/UK/CH). `XI` is the
 * Northern-Ireland VAT prefix — the id keeps it, the country is `GB`.
 * `EL`/`GR` are handled separately: a Greek ΑΦΜ is stored as bare digits.
 */
export const VAT_COUNTRY_CODES = [
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'HR', 'HU',
  'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
  'XI', 'GB', 'CH', 'NO',
] as const;
export type VatCountryCode = (typeof VAT_COUNTRY_CODES)[number];

const VAT_PREFIXES = new Set<string>(VAT_COUNTRY_CODES);
/** Χώρες που ΔΕΝ είναι μέλη του VIES (το lookup δεν έχει νόημα). */
const NON_VIES = new Set(['CH', 'NO', 'GB']);

/** `XI` (Β. Ιρλανδία) είναι ξεχωριστό VAT prefix αλλά η χώρα είναι το Ηνωμένο Βασίλειο. */
const countryOfPrefix = (p: string): string => (p === 'XI' ? 'GB' : p);

/**
 * Ξεφορτώνεται μια ΠΡΟΤΑΣΣΟΜΕΝΗ ετικέτα («ΑΦΜ:», «VAT No.», «Tax ID») και κάθε
 * σημείο στίξης/κενό. Η ετικέτα κόβεται ΜΟΝΟ από την αρχή: ένα σκέτο «NO» στη μέση
 * δεν είναι ετικέτα αλλά το πρόθεμα χώρας της Νορβηγίας.
 */
function cleanVatInput(input: unknown): string {
  return String(input ?? '')
    .toUpperCase()
    .replace(/^[\s.:]*(?:Α\.?Φ\.?Μ\.?|VAT(?:\s*REG(?:\.|ISTRATION)?)?(?:\s*(?:NO|NUMBER|ID))?|TAX\s*(?:ID|NO))\s*[.:\-]?/, '')
    .replace(/[^A-Z0-9]+/g, '');
}

/**
 * Κανονικοποίηση ΑΦΜ / VAT id σε αυτό που αποθηκεύουμε ΚΑΙ στη χώρα του.
 *
 * - «EL999863881» / «ΑΦΜ: 999 863.881» → `{ id: '999863881', country: 'GR' }`
 *   (ελληνικά ΑΦΜ μένουν σκέτα ψηφία — έτσι τα θέλουν ΑΑΔΕ και SoftOne).
 * - «CY 10123456 A» → `{ id: 'CY10123456A', country: 'CY' }` — το πρόθεμα χώρας
 *   ΔΙΑΤΗΡΕΙΤΑΙ: είναι μέρος της ταυτότητας του ξένου εκδότη.
 * - Οτιδήποτε άλλο → μόνο τα ψηφία· `country` 'GR' αν περνά τον έλεγχο mod-11,
 *   αλλιώς `null` (άγνωστη χώρα — τη μεταχειριζόμαστε ως ελληνική).
 *
 * Επιστρέφει `null` όταν δεν μένει τίποτα αξιοποιήσιμο.
 */
export function normalizeVatId(input: unknown): { id: string; country: string | null } | null {
  const s = cleanVatInput(input);
  if (!s) return null;
  const prefix = s.slice(0, 2);
  const rest = s.slice(2);
  if ((prefix === 'EL' || prefix === 'GR') && /\d/.test(rest)) {
    const digits = rest.replace(/\D+/g, '');
    return digits ? { id: digits, country: 'GR' } : null;
  }
  if (VAT_PREFIXES.has(prefix) && rest && /\d/.test(rest)) {
    return { id: prefix + rest, country: countryOfPrefix(prefix) };
  }
  const digits = s.replace(/\D+/g, '');
  if (!digits) return null;
  return { id: digits, country: isValidAfm(digits) ? 'GR' : null };
}

/**
 * Η χώρα ενός ΑΠΟΘΗΚΕΥΜΕΝΟΥ id (`OcrDocument.issuerAfm`, κλειδί ομάδας ουράς):
 * πρόθεμα χώρας → ο κωδικός της, σκέτα ψηφία → 'GR' αν είναι έγκυρο ΑΦΜ, αλλιώς `null`.
 */
export function vatCountry(id: string | null | undefined): string | null {
  const s = String(id ?? '').trim().toUpperCase();
  if (!s) return null;
  const prefix = s.slice(0, 2);
  if (/^[A-Z]{2}[A-Z0-9]+$/.test(s)) {
    if (prefix === 'EL' || prefix === 'GR') return 'GR';
    return VAT_PREFIXES.has(prefix) ? countryOfPrefix(prefix) : null;
  }
  return isValidAfm(s) ? 'GR' : null;
}

/** Ένα id είναι «ξένο» όταν ξέρουμε τη χώρα του και δεν είναι η Ελλάδα. */
export function isForeignVatId(id: string | null | undefined): boolean {
  const c = vatCountry(id);
  return c != null && c !== 'GR';
}

/**
 * Το πρόθεμα με το οποίο ρωτάμε το VIES, ή `null` όταν το lookup δεν έχει νόημα.
 * Το `XI` το κρατά το ΙΔΙΟ το id (η Β. Ιρλανδία είναι στο VIES, το `GB` όχι) —
 * γι' αυτό διαβάζουμε το πρόθεμα από το id και όχι τη χώρα.
 */
export function viesPrefix(id: string | null | undefined): string | null {
  const s = String(id ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}[A-Z0-9]+$/.test(s)) return null;
  const p = s.slice(0, 2);
  if (!VAT_PREFIXES.has(p) || NON_VIES.has(p)) return null;
  return p;
}

/**
 * Normalize an ΑΦΜ / VAT string to what we store. Thin wrapper over
 * {@link normalizeVatId} — κρατά την υπογραφή που χρησιμοποιεί όλο το pipeline
 * (`issuerAfm`, `vatNumber`, κλειδιά ουράς, `LineMatchRule.afm`, `IgnoredIssuer.afm`).
 */
export function normalizeAfm(input: unknown): string | null {
  return normalizeVatId(input)?.id ?? null;
}

/**
 * ΑΦΜ που έρχεται ως route parameter (`/new-traders/[afm]/…`). Δεν κανονικοποιούμε εδώ:
 * το path είναι ταυτότητα ομάδας και πρέπει να είναι είτε 8–12 ψηφία (ελληνικό/άγνωστο)
 * είτε ξένο VAT id με γνωστό πρόθεμα χώρας (π.χ. `CY10123456A`). Το «EL…» ΔΕΝ γίνεται
 * δεκτό: τα ελληνικά αποθηκεύονται πάντα σκέτα, οπότε τέτοιο path είναι λάθος αίτημα.
 */
export function parseAfmParam(input: unknown): string | null {
  const s = String(input ?? '').trim();
  if (/^\d{8,12}$/.test(s)) return s;
  if (/^[A-Z]{2}[A-Z0-9]{2,13}$/.test(s) && VAT_PREFIXES.has(s.slice(0, 2))) return s;
  return null;
}

/** Overwrite issuer/recipient ΑΦΜ fields in-place with their normalized form. */
export function normalizeAfmFields<T extends Record<string, any>>(data: T): T {
  if (!data || typeof data !== 'object') return data;
  for (const key of ['vatNumber', 'customerVatNumber'] as const) {
    const n = normalizeAfm((data as any)[key]);
    if (n) (data as any)[key] = n;
  }
  return data;
}

const TOTALS_TOLERANCE = 0.02;

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Invoice arithmetic sanity: subtotal + vat ≈ total. Neutral if any part missing. */
export function checkTotals(data: any): { ok: boolean; issues: string[] } {
  const sub = num(data?.subtotal), vat = num(data?.vatAmount), tot = num(data?.totalAmount);
  if (sub == null || vat == null || tot == null) return { ok: true, issues: [] };
  const ok = Math.abs(sub + vat - tot) <= TOTALS_TOLERANCE;
  return ok ? { ok, issues: [] } : { ok, issues: [`subtotal(${sub}) + vat(${vat}) ≠ total(${tot})`] };
}

/**
 * If the extracted ISSUER ΑΦΜ equals OUR OWN ΑΦΜ, the model swapped issuer and
 * recipient (common on documents where we are the buyer). Swap them back.
 */
export function fixSwappedParties<T extends Record<string, any>>(data: T, ownAfm: string | null): T {
  if (!ownAfm || !data) return data;
  const issuer = String(data.vatNumber ?? '').replace(/\D+/g, '');
  if (issuer !== ownAfm) return data;
  return {
    ...data,
    companyName: data.customerName ?? null,        vatNumber: data.customerVatNumber ?? null,
    companyAddress: data.customerAddress ?? null,  companyDoy: data.customerDoy ?? null,
    companyProfession: data.customerProfession ?? null,
    customerName: data.companyName ?? null,        customerVatNumber: data.vatNumber ?? null,
    customerAddress: data.companyAddress ?? null,  customerDoy: data.companyDoy ?? null,
    customerProfession: data.companyProfession ?? null,
  };
}

/**
 * +1 όταν ένα ΑΦΜ υπάρχει αλλά κόβεται στον έλεγχο mod-11. Ένα ΞΕΝΟ VAT id δεν
 * ελέγχεται ποτέ με τον ελληνικό αλγόριθμο — αλλιώς κάθε ξένο τιμολόγιο θα
 * φαινόταν «χειρότερο» και θα ξαναπερνούσε από μεγαλύτερο μοντέλο χωρίς λόγο.
 */
function vatPenalty(v: unknown): number {
  const s = String(v ?? '').trim();
  if (!s) return 0;
  if (isForeignVatId(normalizeAfm(s))) return 0;
  return isValidAfm(s) ? 0 : 1;
}

/**
 * Combined quality signal: missing required fields + failed deterministic checks.
 * LOWER is better. Replaces bare missing-count in the retry-keep decision so a
 * present-but-wrong field can lose to a better pass.
 */
export function qualityScore(data: any, docType: DocType): number {
  let score = countMissingRequired(data, docType);
  if (docType === 'invoice') {
    score += vatPenalty(data?.vatNumber) + vatPenalty(data?.customerVatNumber);
    if (!checkTotals(data).ok) score += 1;
  }
  if (docType === 'receipt') score += vatPenalty(data?.vatNumber);
  return score;
}
