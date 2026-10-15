// lib/foreign-vat-check.ts — SERVER. Έλεγχος ΞΕΝΟΥ ΑΦΜ (εκτός Ελλάδας) κατά παραγγελία.
//
// Πάροχος: taxid.dev (`GET /api/v1/validate/{country}/{vat}`, Bearer `vat_…`) — VIES για την ΕΕ,
// HMRC για το ΗΒ, Brønnøysund για τη Νορβηγία, με cache 24ω. Το κλειδί μπαίνει στις Ρυθμίσεις
// (`integrations.taxidApiKey`) ή στο `.env` (`TAXID_API_KEY`). Χωρίς κλειδί: απευθείας στο VIES της
// ΕΕ (δωρεάν, αλλά αργό και συχνά κάτω, και χωρίς ΗΒ/Νορβηγία).
//
// ΜΟΝΟ όταν το ζητά ο χρήστης: το δωρεάν πλάνο έχει 100 ελέγχους τον μήνα. Κανένα αυτόματο
// κάλεσμα (ανάγνωση, μαζική δημιουργία, ουρές) δεν περνά από εδώ.
import 'server-only';
import { getSetting } from '@/lib/settings';
import { normalizeVatId } from '@/lib/ocr/validate';

const TAXID_URL = 'https://www.taxid.dev/api/v1/validate';
const VIES_URL = 'https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number';
const TIMEOUT_MS = 10_000;

/** Ό,τι καλύπτει το taxid.dev (ΕΕ-27 με «EL» για την Ελλάδα, ΒΙ, ΗΒ, Νορβηγία). */
const TAXID_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'HR', 'HU', 'IE', 'IT', 'LT',
  'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'XI', 'GB', 'NO',
]);
const EU_VIES = new Set([...TAXID_COUNTRIES].filter((c) => c !== 'GB' && c !== 'NO'));

export type ForeignVatError =
  | 'not_foreign'      // ελληνικό ή χωρίς πρόθεμα χώρας
  | 'unsupported'      // χώρα που δεν ελέγχεται (π.χ. Τουρκία, ΗΠΑ)
  | 'unauthorized'     // λάθος κλειδί
  | 'quota'            // τελείωσε το μηνιαίο όριο
  | 'unavailable'      // η αρχή της χώρας δεν απαντά τώρα
  | 'network';

export interface ForeignVatResult {
  vat: string;
  countryCode: string;
  /** `true` ενεργό · `false` άκυρο · `null` δεν ήταν δυνατός ο έλεγχος (βλ. `error`). */
  valid: boolean | null;
  name: string | null;
  address: string | null;
  /** «taxid» ή «vies» (απευθείας) — για να ξέρει ο χρήστης από πού ήρθε η απάντηση. */
  provider: 'taxid' | 'vies' | null;
  /** Η αρχή που απάντησε (VIES / HMRC / Brønnøysundregistrene). */
  source?: string | null;
  cached?: boolean;
  error?: ForeignVatError;
  message?: string;
}

/** Το «---» ή κενό σημαίνει «η αρχή το κρύβει», όχι τιμή. */
function value(v: unknown): string | null {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return !s || /^-+$/.test(s) ? null : s;
}

export async function taxidApiKey(): Promise<string | null> {
  const fromSettings = await getSetting<string>('integrations.taxidApiKey').catch(() => null);
  const k = String(fromSettings ?? process.env.TAXID_API_KEY ?? '').trim();
  return k || null;
}

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, cache: 'no-store', signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

const MESSAGES: Record<ForeignVatError, string> = {
  not_foreign: 'Ο έλεγχος VIES αφορά ΑΦΜ εκτός Ελλάδας με πρόθεμα χώρας (π.χ. IT01808880270).',
  unsupported: 'Η χώρα αυτή δεν ελέγχεται μέσω VIES (καλύπτονται ΕΕ, Ηνωμένο Βασίλειο, Νορβηγία).',
  unauthorized: 'Το TaxID API key δεν έγινε δεκτό — έλεγξέ το στις Ρυθμίσεις → Διασυνδέσεις.',
  quota: 'Τελείωσαν οι μηνιαίοι έλεγχοι του TaxID (δωρεάν: 100/μήνα).',
  unavailable: 'Η υπηρεσία της χώρας δεν απαντά τώρα — δοκίμασε ξανά σε λίγο.',
  network: 'Η υπηρεσία ελέγχου δεν απάντησε.',
};
const fail = (vat: string, cc: string, provider: ForeignVatResult['provider'], error: ForeignVatError, extra?: string): ForeignVatResult =>
  ({ vat, countryCode: cc, valid: null, name: null, address: null, provider, error, message: extra ? `${MESSAGES[error]} (${extra})` : MESSAGES[error] });

/** Έλεγχος ενός ΞΕΝΟΥ ΑΦΜ με πρόθεμα χώρας. Δεν πετάει ποτέ: κάθε αποτυχία είναι `valid: null`. */
export async function checkForeignVat(raw: string): Promise<ForeignVatResult> {
  const n = normalizeVatId(raw);
  const id = n?.id ?? '';
  const cc = /^[A-Z]{2}/.test(id) ? id.slice(0, 2) : '';
  if (!id || !cc || cc === 'EL' || cc === 'GR' || n?.country === 'GR') return fail(id || raw, cc, null, 'not_foreign');
  if (!TAXID_COUNTRIES.has(cc)) return fail(id, cc, null, 'unsupported');
  const body = id.slice(2);

  const key = await taxidApiKey();
  if (key) {
    try {
      const res = await timedFetch(`${TAXID_URL}/${cc}/${encodeURIComponent(body)}`, {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      });
      if (res.status === 401) return fail(id, cc, 'taxid', 'unauthorized');
      if (res.status === 429) return fail(id, cc, 'taxid', 'quota');
      if (res.status === 503) return fail(id, cc, 'taxid', 'unavailable');
      if (res.status === 400) return fail(id, cc, 'taxid', 'unsupported');
      if (!res.ok) return fail(id, cc, 'taxid', 'network', `HTTP ${res.status}`);
      const d = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (d.status === 'service_unavailable') return fail(id, cc, 'taxid', 'unavailable');
      return {
        vat: id, countryCode: cc, valid: d.valid === true, provider: 'taxid',
        name: value(d.company_name), address: value(d.company_address),
        source: value(d.source), cached: d.cached === true,
      };
    } catch (e) {
      return fail(id, cc, 'taxid', 'network', (e as Error).name === 'AbortError' ? 'χρονικό όριο' : undefined);
    }
  }

  // Χωρίς κλειδί: απευθείας VIES (μόνο ΕΕ).
  if (!EU_VIES.has(cc)) return fail(id, cc, null, 'unsupported', 'για ΗΒ/Νορβηγία χρειάζεται TaxID API key');
  try {
    const res = await timedFetch(VIES_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ countryCode: cc, vatNumber: body }),
    });
    if (!res.ok) return fail(id, cc, 'vies', 'network', `HTTP ${res.status}`);
    const d = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const userError = String(d.userError ?? '').toUpperCase();
    if (userError && userError !== 'VALID' && userError !== 'INVALID') return fail(id, cc, 'vies', 'unavailable', userError);
    return { vat: id, countryCode: cc, valid: d.valid === true, provider: 'vies', name: value(d.name), address: value(d.address), source: 'VIES' };
  } catch (e) {
    return fail(id, cc, 'vies', 'network', (e as Error).name === 'AbortError' ? 'χρονικό όριο' : undefined);
  }
}
