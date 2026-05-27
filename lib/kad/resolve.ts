import { prisma } from '@/lib/db';

/**
 * Format raw digits to canonical Greek KAD dotted form (pairs joined by dots).
 *   "56101104" → "56.10.11.04"
 *   "5690"     → "56.90"
 *   "568000"   → "56.80.00"
 * Trailing zeros are NOT stripped here — we only insert dots. Use the canonical
 * dotted form so the UI is consistent regardless of whether KadCode has a match.
 */
/**
 * Strip all non-digit characters. Used to derive `codeWithoutDots`.
 */
export function stripKadDots(input: string): string {
  return (input ?? '').replace(/[^0-9]/g, '');
}

/**
 * Ensure exactly one activity is marked as PRIMARY. If the AADE/ΓΕΜΗ response
 * has none flagged (rare but happens for inactive firms or partial records),
 * promote the first item. Idempotent.
 */
export function ensurePrimaryActivity<T extends { kind: 'PRIMARY' | 'SECONDARY' }>(activities: T[]): T[] {
  if (activities.length === 0) return activities;
  const hasPrimary = activities.some((a) => a.kind === 'PRIMARY');
  if (hasPrimary) return activities;
  return activities.map((a, i) => (i === 0 ? { ...a, kind: 'PRIMARY' as const } : a));
}

export function formatKadDots(input: string): string {
  if (!input) return input;
  if (input.includes('.')) return input.trim();
  const digits = input.replace(/[^0-9]/g, '');
  if (digits.length === 0) return input;
  const out: string[] = [];
  for (let i = 0; i < digits.length; i += 2) out.push(digits.slice(i, i + 2));
  return out.join('.');
}

/**
 * Resolve a raw KAD code (dotted or digit-only) to its canonical KadCode entry.
 * Returns both dotted and digit-only forms so CompanyActivity rows always carry both.
 * Falls back to the input itself if no match is found in KadCode.
 */
export async function resolveKadForActivity(
  rawCode: string,
  fallbackDescription = '',
): Promise<{ code: string; codeWithoutDots: string; codeAade: string; description: string }> {
  const input = rawCode.trim();
  const digitsOnly = input.replace(/[^0-9]/g, '');
  // AADE convention: zero-padded to 8 digits (or longer if input already exceeds).
  const codeAade = digitsOnly ? digitsOnly.padEnd(Math.max(8, digitsOnly.length), '0') : input;

  // 1) direct hit on dotted code
  let hit = input.includes('.')
    ? await prisma.kadCode.findUnique({
        where: { code: input },
        select: { code: true, codeWithoutDots: true, title: true, description: true },
      })
    : null;

  // 2) lookup by digit-form. AADE returns zero-padded 8-digit codes ("43210000")
  //    but canonical entries store the un-padded form ("432100" for L6, "43210004"
  //    for L7). Try exact first, then progressively strip trailing zeros so an
  //    AADE-padded code falls back to its closest canonical entry.
  if (!hit && digitsOnly) {
    const candidates: string[] = [digitsOnly];
    let s = digitsOnly;
    while (s.endsWith('0') && s.length > 2) { s = s.slice(0, -1); candidates.push(s); }
    for (const cand of candidates) {
      hit = await prisma.kadCode.findFirst({
        where: { codeWithoutDots: cand },
        orderBy: { level: 'desc' },
        select: { code: true, codeWithoutDots: true, title: true, description: true },
      });
      if (hit) break;
    }
  }

  if (hit) {
    return {
      code: formatKadDots(hit.code),
      codeWithoutDots: hit.codeWithoutDots ?? digitsOnly,
      codeAade,
      description: fallbackDescription || hit.title || hit.description,
    };
  }

  // No KadCode match — still emit a canonical dotted code so the UI never shows
  // mixed "56101104" vs "56.11.01" formatting. codeWithoutDots is always digits.
  return {
    code: formatKadDots(input),
    codeWithoutDots: digitsOnly,
    codeAade,
    description: fallbackDescription,
  };
}
