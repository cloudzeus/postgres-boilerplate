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
