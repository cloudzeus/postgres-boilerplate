// Ηνωμένο Βασίλειο — HMRC «Check a UK VAT number» v2 (η v1 καταργήθηκε 17/02/2025).
// OAuth 2.0 client credentials (scope `read:vat`), δωρεάν, με εγγραφή εφαρμογής στο HMRC Developer
// Hub (~2 εβδομάδες έγκριση, πρώτα δοκιμές στο sandbox). Με δικό μας UK VRN δίνει αριθμό ελέγχου.
import type { VatCheckConfig, VatCheckResult } from './types';
import type { VatTarget } from './target';
import { abortDetail, failure, text, timedFetch } from './http';

const BASE = { production: 'https://api.service.hmrc.gov.uk', sandbox: 'https://test-api.service.hmrc.gov.uk' } as const;

let token: { key: string; value: string; exp: number } | null = null;

/** Για tests. */
export function resetHmrcToken(): void { token = null; }

async function accessToken(cfg: VatCheckConfig): Promise<string | 'unauthorized' | null> {
  const h = cfg.hmrc!;
  const base = BASE[h.env ?? 'production'];
  const key = `${base}|${h.clientId}`;
  if (token && token.key === key && Date.now() < token.exp - 60_000) return token.value;
  const res = await timedFetch(cfg, `${base}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: h.clientId, client_secret: h.clientSecret, grant_type: 'client_credentials', scope: 'read:vat' }).toString(),
  });
  if (res.status === 400 || res.status === 401) return 'unauthorized';
  if (!res.ok) return null;
  const d = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (!d.access_token) return null;
  token = { key, value: d.access_token, exp: Date.now() + (Number(d.expires_in) || 3600) * 1000 };
  return token.value;
}

export async function checkHmrc(t: VatTarget, cfg: VatCheckConfig): Promise<VatCheckResult> {
  if (!/^(\d{9}|\d{12})$/.test(t.number)) return failure(t, 'hmrc', 'invalid_format');
  const h = cfg.hmrc;
  if (!h?.clientId || !h.clientSecret) return failure(t, 'hmrc', 'not_configured');
  const base = BASE[h.env ?? 'production'];
  try {
    const tk = await accessToken(cfg);
    if (tk === 'unauthorized') return failure(t, 'hmrc', 'unauthorized', 'oauth');
    if (!tk) return failure(t, 'hmrc', 'unavailable', 'oauth');
    const requester = String(h.requesterVrn ?? '').replace(/\D+/g, '');
    const path = `/organisations/vat/check-vat-number/lookup/${t.number}${/^(\d{9}|\d{12})$/.test(requester) ? `/${requester}` : ''}`;
    const res = await timedFetch(cfg, `${base}${path}`, { headers: { Accept: 'application/vnd.hmrc.2.0+json', Authorization: `Bearer ${tk}` } });
    const base0 = { vat: t.vat, countryCode: 'GB', provider: 'hmrc' as const, source: 'HMRC', checkedAt: new Date().toISOString() };
    if (res.status === 404) return { ...base0, valid: false, name: null, address: null, consultationNumber: null, message: 'Ο αριθμός δεν αντιστοιχεί σε εγγεγραμμένη επιχείρηση στο HMRC.' };
    if (res.status === 401 || res.status === 403) { token = null; return failure(t, 'hmrc', 'unauthorized', `HTTP ${res.status}`); }
    if (res.status === 429) return failure(t, 'hmrc', 'rate_limited', 'HTTP 429');
    if (res.status === 400) return failure(t, 'hmrc', 'invalid_format', 'HTTP 400');
    if (!res.ok) return failure(t, 'hmrc', 'unavailable', `HTTP ${res.status}`);
    const d = (await res.json().catch(() => ({}))) as { target?: { name?: string; address?: Record<string, string> }; consultationNumber?: string; processingDate?: string };
    const a = d.target?.address ?? {};
    const address = text(['line1', 'line2', 'line3', 'line4', 'line5', 'postcode', 'countryCode'].map((k) => a[k]).filter(Boolean).join(', '));
    return {
      ...base0, valid: Boolean(d.target), name: text(d.target?.name), address,
      consultationNumber: text(d.consultationNumber), checkedAt: d.processingDate ?? base0.checkedAt,
    };
  } catch (e) { return failure(t, 'hmrc', 'network', abortDetail(e)); }
}
