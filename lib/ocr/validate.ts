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
 * Combined quality signal: missing required fields + failed deterministic checks.
 * LOWER is better. Replaces bare missing-count in the retry-keep decision so a
 * present-but-wrong field can lose to a better pass.
 */
export function qualityScore(data: any, docType: DocType): number {
  let score = countMissingRequired(data, docType);
  if (docType === 'invoice') {
    if (data?.vatNumber && !isValidAfm(data.vatNumber)) score += 1;
    if (data?.customerVatNumber && !isValidAfm(data.customerVatNumber)) score += 1;
    if (!checkTotals(data).ok) score += 1;
  }
  if (docType === 'receipt' && data?.vatNumber && !isValidAfm(data.vatNumber)) score += 1;
  return score;
}
