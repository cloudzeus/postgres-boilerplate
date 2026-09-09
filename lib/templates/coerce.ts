// lib/templates/coerce.ts — PURE. Turns a raw reader string into a typed value.
import { parseGreekNumber, parseGreekCurrency, parseGreekDate } from '@/lib/greek-format';
import type { TemplateValueType } from './schema';

export type Coerced = string | number | string[] | null;

/**
 * `parseGreekNumber` treats `.` as *always* a thousands separator (per its own doc comment), so
 * a plain-decimal string like "1234.56" would parse as 123456 if handed to it directly. But a
 * single dot is genuinely ambiguous: Greek invoices also print whole-euro thousands-grouped
 * amounts with a single dot and no comma (e.g. "1.234" meaning 1234, not 1.234). Disambiguate
 * before delegating:
 *
 *   1. Contains a comma            → unambiguously Greek-formatted → delegate as-is.
 *   2. Single dot w/ exactly 3 fractional digits, or repeated 3-digit groups and no comma
 *      (e.g. "1.234", "100.000", "1.234.567") → Greek thousands grouping, no decimal part →
 *      strip the dots and read as a plain integer.
 *   3. Single dot w/ fractional-digit count != 3, no comma (e.g. "1.5", "1234.56") → plain
 *      decimal → read as a plain JS number.
 *   4. Anything else → delegate as-is.
 */
function disambiguateGreekNumeric(s: string, fallbackParse: (v: string) => number | null): number | null {
  if (s.includes(',')) return fallbackParse(s);
  if (/^\d+\.\d{3}$/.test(s) || /^\d{1,3}(\.\d{3})+$/.test(s)) {
    const n = Number(s.replace(/\./g, ''));
    return Number.isFinite(n) ? n : null;
  }
  if (/^\d+\.\d+$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return fallbackParse(s);
}

function parsePlainOrGreekNumber(s: string): number | null {
  return disambiguateGreekNumeric(s, parseGreekNumber);
}

function parsePlainOrGreekCurrency(s: string): number | null {
  return disambiguateGreekNumeric(s, parseGreekCurrency);
}

/**
 * `parseGreekDate` only matches dd/mm/yyyy (or . / - separated) with a *4-digit* year via
 * regex; anything else (including a 2-digit year, or the ISO yyyy-mm-dd shape) falls through
 * to `new Date(s)`, which is unreliable for non-ISO strings. Normalise separators and expand
 * a 2-digit year to 20YY before delegating, and fast-path ISO yyyy-mm-dd directly.
 */
function parseDateFlexible(s: string): Date | null {
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const [, yyyy, mm, dd] = iso;
    const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  let normalised = s.replace(/[.\-]/g, '/');
  const shortYear = normalised.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (shortYear) {
    const [, dd, mm, yy] = shortYear;
    normalised = `${dd}/${mm}/20${yy}`;
  }

  return parseGreekDate(normalised);
}

export function coerceValue(raw: unknown, valueType: TemplateValueType): Coerced {
  const original = raw == null ? '' : String(raw);
  const s = original.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  switch (valueType) {
    case 'TEXT':
      return s;
    case 'NUMBER': {
      const n = parsePlainOrGreekNumber(s);
      return n == null || !Number.isFinite(n) ? null : n;
    }
    case 'CURRENCY': {
      const cleaned = s.replace(/EUR|€/gi, '').trim();
      const n = parsePlainOrGreekCurrency(cleaned);
      return n == null || !Number.isFinite(n) ? null : n;
    }
    case 'DATE': {
      const d = parseDateFlexible(s);
      if (!d || Number.isNaN(d.getTime())) return null;
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
    case 'LIST': {
      const parts = original
        .split(/[\n;,]/)
        .map((p) => p.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      return parts.length ? parts : null;
    }
    default:
      return s;
  }
}
