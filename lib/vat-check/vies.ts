// VIES on the Web — REST API της Ευρωπαϊκής Επιτροπής (EIS v1.21, DG TAXUD). Δημόσιο, δωρεάν,
// χωρίς κλειδί. Περιορισμοί της ΙΔΙΑΣ της Επιτροπής (ισχύουν για όλους, και για τους εμπορικούς
// παρόχους που το «τυλίγουν»): όριο ταυτόχρονων αιτημάτων ανά κράτος και συνολικά, κράτη εκτός
// λειτουργίας. Εδώ τα απορροφάμε: έλεγχος διαθεσιμότητας πρώτα, επαναλήψεις με αναμονή.
import type { MatchFlag, VatCheckConfig, VatCheckResult, VatTraderInput } from './types';
import type { VatTarget } from './target';
import { parseRequester } from './target';
import { abortDetail, failure, sleeper, text, timedFetch } from './http';

export const VIES_BASE = 'https://ec.europa.eu/taxation_customs/vies/rest-api';

/** Σφάλματα που λύνονται με αναμονή (EIS §4.2.2, HTTP 200). */
const TRANSIENT = new Set(['MS_MAX_CONCURRENT_REQ', 'GLOBAL_MAX_CONCURRENT_REQ', 'MS_UNAVAILABLE', 'TIMEOUT', 'SERVICE_UNAVAILABLE', 'SERVER_BUSY']);

let statusCache: { at: number; byCountry: Map<string, string>; vowAvailable: boolean } | null = null;
const STATUS_TTL_MS = 5 * 60_000;

/** `check-status`: ποια κράτη απαντούν τώρα (cache 5′). `null` = δεν ξέρουμε (τότε απλώς δοκιμάζουμε). */
export async function viesStatus(cfg: VatCheckConfig): Promise<{ vowAvailable: boolean; byCountry: Map<string, string> } | null> {
  if (statusCache && Date.now() - statusCache.at < STATUS_TTL_MS) return statusCache;
  try {
    const res = await timedFetch(cfg, `${VIES_BASE}/check-status`, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const d = (await res.json()) as { vow?: { available?: boolean }; countries?: { countryCode: string; availability: string }[] };
    statusCache = {
      at: Date.now(), vowAvailable: d.vow?.available !== false,
      byCountry: new Map((d.countries ?? []).map((c) => [c.countryCode, c.availability])),
    };
    return statusCache;
  } catch { return null; }
}

/** Για tests. */
export function resetViesStatusCache(): void { statusCache = null; }

function errorCode(d: Record<string, unknown>): string | null {
  const wrappers = d.errorWrappers as { error?: string }[] | undefined;
  const fromWrapper = Array.isArray(wrappers) && wrappers[0]?.error ? String(wrappers[0].error) : null;
  const user = String(d.userError ?? '').toUpperCase();
  const fromUser = user && user !== 'VALID' && user !== 'INVALID' ? user : null;
  return (fromWrapper ?? fromUser)?.toUpperCase() ?? null;
}

const flag = (v: unknown): MatchFlag | undefined => {
  const s = String(v ?? '').toUpperCase();
  return s === 'VALID' || s === 'INVALID' || s === 'NOT_PROCESSED' ? s : undefined;
};

export async function checkVies(t: VatTarget, cfg: VatCheckConfig, trader?: VatTraderInput | null): Promise<VatCheckResult> {
  const status = await viesStatus(cfg);
  if (status && !status.vowAvailable) return failure(t, 'vies', 'unavailable', 'VOW_UNAVAILABLE');
  const avail = status?.byCountry.get(t.countryCode);
  if (avail && avail.toLowerCase() !== 'available') return failure(t, 'vies', 'unavailable', `MS ${avail}`);

  const requester = parseRequester(cfg.requesterVat);
  const body: Record<string, string> = { countryCode: t.countryCode, vatNumber: t.number };
  if (requester) { body.requesterMemberStateCode = requester.countryCode; body.requesterNumber = requester.number; }
  const tr = trader ?? {};
  if (tr.name?.trim()) body.traderName = tr.name.trim();
  if (tr.street?.trim()) body.traderStreet = tr.street.trim();
  if (tr.postalCode?.trim()) body.traderPostalCode = tr.postalCode.trim();
  if (tr.city?.trim()) body.traderCity = tr.city.trim();

  const delays = cfg.retryDelaysMs ?? [1500, 4000];
  const sleep = sleeper(cfg);
  let last: VatCheckResult | null = null;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) await sleep(delays[attempt - 1]);
    let res: Response;
    try {
      res = await timedFetch(cfg, `${VIES_BASE}/check-vat-number`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body),
      });
    } catch (e) { last = failure(t, 'vies', 'network', abortDetail(e)); continue; }
    const d = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 400) {
      const code = errorCode(d) ?? String((d.errorWrappers as { error?: string }[] | undefined)?.[0]?.error ?? 'HTTP 400');
      // Λάθος ΑΦΜ αιτούντος: ξαναδοκιμάζουμε ΧΩΡΙΣ αυτόν (χάνεται μόνο ο αριθμός ελέγχου).
      if (code.includes('2700') || code.includes('2500')) {
        delete body.requesterMemberStateCode; delete body.requesterNumber; continue;
      }
      return failure(t, 'vies', 'invalid_format', code);
    }
    if (res.status >= 500) { last = failure(t, 'vies', 'unavailable', `HTTP ${res.status}`); continue; }
    const code = errorCode(d);
    if (code) {
      if (code === 'INVALID_INPUT') return failure(t, 'vies', 'invalid_format', code);
      if (code === 'VAT_BLOCKED' || code === 'IP_BLOCKED') return failure(t, 'vies', 'blocked', code);
      if (TRANSIENT.has(code)) {
        last = failure(t, 'vies', code.includes('CONCURRENT') ? 'rate_limited' : 'unavailable', code);
        continue;
      }
      return failure(t, 'vies', 'unavailable', code);
    }
    if (typeof d.valid !== 'boolean') { last = failure(t, 'vies', 'network', 'no valid flag'); continue; }
    const match = {
      name: flag(d.traderNameMatch), street: flag(d.traderStreetMatch),
      postalCode: flag(d.traderPostalCodeMatch), city: flag(d.traderCityMatch),
    };
    const anyMatch = Object.values(match).some((m) => m && m !== 'NOT_PROCESSED');
    return {
      vat: t.vat, countryCode: t.countryCode, valid: d.valid, provider: 'vies', source: 'VIES',
      name: text(d.name), address: text(d.address),
      consultationNumber: text(d.requestIdentifier),
      checkedAt: typeof d.requestDate === 'string' ? d.requestDate : new Date().toISOString(),
      match: anyMatch ? match : null,
    };
  }
  return last ?? failure(t, 'vies', 'network');
}
