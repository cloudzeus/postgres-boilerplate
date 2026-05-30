import { getSetting } from '@/lib/settings';

let cache: { value: string | null; day: string } | null = null;
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Our own company ΑΦΜ, used only to detect issuer/recipient swaps on extracted
 * documents (where we are the buyer, the model sometimes puts us in the issuer
 * slot). Source priority: `company.ownVat` setting → `COMPANY_OWN_VAT` env.
 * Cached for the calendar day. Never throws.
 *
 * NOTE: there is no upstream service that reveals our *own* ΑΦΜ without already
 * knowing it, so this is a one-time configuration value (admin sets the
 * `company.ownVat` setting). If a SoftOne company-info client is added later,
 * resolve it from there first and keep this as the fallback.
 */
export async function resolveOwnAfm(): Promise<string | null> {
  if (cache && cache.day === today()) return cache.value;
  let value: string | null = null;

  const setting = await getSetting<string>('company.ownVat').catch(() => null);
  if (setting) value = String(setting).replace(/\D+/g, '') || null;

  if (!value && process.env.COMPANY_OWN_VAT) {
    value = process.env.COMPANY_OWN_VAT.replace(/\D+/g, '') || null;
  }

  cache = { value, day: today() };
  return value;
}
