// Μικρά κοινά: fetch με χρονικό όριο, καθαρισμός τιμών, κατασκευή αποτελέσματος.
import type { VatCheckConfig, VatCheckError, VatCheckResult } from './types';

export async function timedFetch(cfg: VatCheckConfig, url: string, init: RequestInit = {}): Promise<Response> {
  const f = cfg.fetch ?? fetch;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), cfg.timeoutMs ?? 12_000);
  try {
    return await f(url, { ...init, cache: 'no-store', signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

export const sleeper = (cfg: VatCheckConfig) => cfg.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

/** «---», κενά και αλλαγές γραμμής: η αρχή «κρύβει» το στοιχείο ή το σπάει σε γραμμές. */
export function text(v: unknown): string | null {
  const s = String(v ?? '').replace(/\s*\n\s*/g, ', ').replace(/\s+/g, ' ').replace(/^[,\s]+|[,\s]+$/g, '').trim();
  return !s || /^-+$/.test(s) ? null : s;
}

export const MESSAGES: Record<VatCheckError, string> = {
  invalid_format: 'Ο αριθμός δεν έχει τη μορφή ΑΦΜ αυτής της χώρας — έλεγξέ τον στο χαρτί.',
  unsupported: 'Η χώρα αυτή δεν έχει δημόσιο μητρώο ΑΦΜ (ελέγχονται ΕΕ, Β. Ιρλανδία, Ηνωμένο Βασίλειο, Νορβηγία, Ελβετία).',
  not_configured: 'Για ΑΦΜ Ηνωμένου Βασιλείου χρειάζονται στοιχεία εφαρμογής HMRC (client ID / secret).',
  unauthorized: 'Η αρχή απέρριψε τα διαπιστευτήρια — έλεγξέ τα στις Ρυθμίσεις.',
  rate_limited: 'Η υπηρεσία της χώρας έχει φόρτο αυτή τη στιγμή — δοκίμασε ξανά σε λίγο.',
  unavailable: 'Η υπηρεσία της χώρας δεν απαντά τώρα — δοκίμασε ξανά σε λίγο.',
  blocked: 'Η υπηρεσία αρνήθηκε τον έλεγχο (φίλτρο ΑΦΜ ή διεύθυνσης).',
  network: 'Η υπηρεσία ελέγχου δεν απάντησε.',
};

export function failure(
  t: { vat: string; countryCode: string }, provider: VatCheckResult['provider'], error: VatCheckError, detail?: string,
): VatCheckResult {
  return {
    vat: t.vat, countryCode: t.countryCode, valid: null, name: null, address: null, provider,
    source: null, consultationNumber: null, checkedAt: new Date().toISOString(),
    error, message: MESSAGES[error], ...(detail ? { detail } : {}),
  };
}

export const abortDetail = (e: unknown) => ((e as Error)?.name === 'AbortError' ? 'timeout' : String((e as Error)?.message ?? e));
