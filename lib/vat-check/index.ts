// Έλεγχος ξένου ΑΦΜ από τις ΕΠΙΣΗΜΕΣ δωρεάν πηγές — χωρίς εμπορικό πάροχο:
//   ΕΕ-27 + Β. Ιρλανδία → VIES REST (Ευρωπαϊκή Επιτροπή)
//   Ηνωμένο Βασίλειο    → HMRC «Check a UK VAT number» v2 (θέλει εγγραφή εφαρμογής)
//   Νορβηγία            → Brønnøysundregistrene
//   Ελβετία             → UID-Register
// Δεν πετάει ποτέ: κάθε αποτυχία είναι `{ valid: null, error, message }`.
import type { VatCheckConfig, VatCheckResult, VatTraderInput } from './types';
import { parseVatTarget } from './target';
import { failure } from './http';
import { checkVies } from './vies';
import { checkHmrc } from './hmrc';
import { checkBrreg } from './brreg';
import { checkUid } from './uid';

export * from './types';
export { parseVatTarget, parseRequester, VIES_COUNTRIES } from './target';
export { viesStatus } from './vies';

export async function checkVat(raw: string, cfg: VatCheckConfig = {}, trader?: VatTraderInput | null): Promise<VatCheckResult> {
  const t = parseVatTarget(raw);
  if (!t) return failure({ vat: String(raw ?? '').trim(), countryCode: '' }, null, 'invalid_format');
  let out: VatCheckResult;
  switch (t.provider) {
    case 'vies': out = await checkVies(t, cfg, trader); break;
    case 'hmrc': out = await checkHmrc(t, cfg); break;
    case 'brreg': out = await checkBrreg(t, cfg); break;
    case 'uid': out = await checkUid(t, cfg); break;
    default: out = failure(t, null, 'unsupported');
  }
  // Εφεδρεία ΜΟΝΟ για ό,τι δεν μπορεί να ελεγχθεί αλλιώς (π.χ. ΗΒ χωρίς διαπιστευτήρια HMRC).
  if ((out.error === 'not_configured' || out.error === 'unsupported') && cfg.fallback) {
    const fb = await cfg.fallback({ countryCode: t.countryCode, number: t.number, vat: t.vat }).catch(() => null);
    if (fb) return fb;
  }
  return out;
}
