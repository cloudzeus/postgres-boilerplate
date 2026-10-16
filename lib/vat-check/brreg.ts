// Νορβηγία — Enhetsregisteret (Brønnøysundregistrene). Δημόσιο, δωρεάν, χωρίς κλειδί.
// ΑΦΜ ΦΠΑ = «NO» + 9ψήφιος αριθμός οργανισμού + «MVA». Ενεργό για ΦΠΑ = `registrertIMvaregisteret`.
import type { VatCheckConfig, VatCheckResult } from './types';
import type { VatTarget } from './target';
import { abortDetail, failure, text, timedFetch } from './http';

export const BRREG_BASE = 'https://data.brreg.no/enhetsregisteret/api/enheter';

/** Έλεγχος mod-11 του αριθμού οργανισμού (βάρη 3,2,7,6,5,4,3,2). */
export function validNorwegianOrgNr(n: string): boolean {
  if (!/^\d{9}$/.test(n)) return false;
  const w = [3, 2, 7, 6, 5, 4, 3, 2];
  const sum = w.reduce((s, x, i) => s + x * Number(n[i]), 0);
  const r = 11 - (sum % 11);
  const check = r === 11 ? 0 : r;
  return check !== 10 && check === Number(n[8]);
}

export async function checkBrreg(t: VatTarget, cfg: VatCheckConfig): Promise<VatCheckResult> {
  if (!validNorwegianOrgNr(t.number)) return failure(t, 'brreg', 'invalid_format');
  let res: Response;
  try {
    res = await timedFetch(cfg, `${BRREG_BASE}/${t.number}`, { headers: { Accept: 'application/json' } });
  } catch (e) { return failure(t, 'brreg', 'network', abortDetail(e)); }
  const base = { vat: t.vat, countryCode: 'NO', provider: 'brreg' as const, source: 'Brønnøysundregistrene', consultationNumber: null, checkedAt: new Date().toISOString() };
  if (res.status === 404 || res.status === 410) {
    return { ...base, valid: false, name: null, address: null, message: 'Ο αριθμός δεν υπάρχει (ή έχει διαγραφεί) στο μητρώο της Νορβηγίας.' };
  }
  if (res.status === 429) return failure(t, 'brreg', 'rate_limited', 'HTTP 429');
  if (!res.ok) return failure(t, 'brreg', 'unavailable', `HTTP ${res.status}`);
  const d = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const a = (d.forretningsadresse ?? d.postadresse ?? {}) as { adresse?: string[]; postnummer?: string; poststed?: string; land?: string };
  const address = text([...(a.adresse ?? []), [a.postnummer, a.poststed].filter(Boolean).join(' '), a.land].filter(Boolean).join(', '));
  const deleted = Boolean(d.slettedato) || d.konkurs === true || d.underAvvikling === true;
  const vatRegistered = d.registrertIMvaregisteret === true;
  return {
    ...base, valid: vatRegistered && !deleted, name: text(d.navn), address,
    ...(!vatRegistered ? { message: 'Η επιχείρηση υπάρχει, αλλά ΔΕΝ είναι εγγεγραμμένη στο μητρώο ΦΠΑ (MVA) της Νορβηγίας.' } : {}),
    ...(deleted ? { message: 'Η επιχείρηση έχει διαγραφεί, πτωχεύσει ή βρίσκεται σε εκκαθάριση.' } : {}),
  };
}
