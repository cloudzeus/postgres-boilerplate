// lib/templates/coerce.ts — PURE. Turns a raw reader string into a typed value.
import { parseGreekNumber, parseGreekCurrency } from '@/lib/greek-format';
import type { TemplateValueType } from './schema';

export type Coerced = string | number | string[] | null;

/**
 * `parseGreekNumber` treats `.` as *always* a thousands separator (per its own doc comment), so
 * a plain-decimal string like "1234.56" would parse as 123456 if handed to it directly. But a
 * single dot is genuinely ambiguous: Greek invoices also print whole-euro thousands-grouped
 * amounts with a single dot and no comma (e.g. "1.234" meaning 1234, not 1.234). OCR output also
 * carries labels and units around the number ("ΦΠΑ 13.5%", "1234.56 τεμ"), so strip down to the
 * numeric core *first* — otherwise the disambiguation below never fires and everything falls
 * through to the dot-is-thousands parser. Then:
 *
 *   1. Contains a comma → unambiguously Greek-formatted → delegate as-is.
 *   2. Groups of exactly 3 digits after each dot, with a 1-3 digit leading group and no comma
 *      (e.g. "1.234", "100.000", "1.234.567") → Greek thousands grouping, no decimal part →
 *      strip the dots and read as a plain integer.
 *   3. Any other single-dot shape (e.g. "1.5", "0.750", "1234.56", "1234.567") → plain decimal.
 *      A leading "0", or a leading group longer than 3 digits, cannot be thousands grouping.
 *   4. Anything else → delegate as-is.
 */
function disambiguateGreekNumeric(s: string, fallbackParse: (v: string) => number | null): number | null {
  const core = s.replace(/[^\d.,-]/g, '');
  if (!core || /^[.,-]+$/.test(core)) return null;
  if (core.includes(',')) return fallbackParse(core);
  const sign = core.startsWith('-') ? -1 : 1;
  const body = core.replace(/^-/, '');
  if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(body)) return sign * Number(body.replace(/\./g, ''));
  if (/^\d+\.\d+$/.test(body)) return sign * Number(body);
  return fallbackParse(core);
}

function parsePlainOrGreekNumber(s: string): number | null {
  return disambiguateGreekNumeric(s, parseGreekNumber);
}

function parsePlainOrGreekCurrency(s: string): number | null {
  return disambiguateGreekNumeric(s, parseGreekCurrency);
}

/** Builds a UTC date and rejects overflowed calendar days ("31/02/2026" → null). */
function utcDate(year: number, month: number, day: number): Date | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(d.getTime())) return null;
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d;
}

/**
 * Parses only the two shapes invoices actually print, always in UTC so the result never shifts
 * with the server timezone. `new Date(<string>)` is deliberately never used: it reads
 * "2026-03-05" as UTC midnight but "2026/03/05" as *local* midnight (one day off east of GMT),
 * and it happily mis-reads "05/03/2026" as May 3rd.
 */
function parseDateFlexible(s: string): Date | null {
  const iso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ].*)?$/);
  if (iso) return utcDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // Greek/European dd/mm/yyyy anywhere in the string, so labels and trailing times are tolerated.
  const eu = s.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})/);
  if (eu) {
    const yy = eu[3];
    const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy); // invoices are current-century
    return utcDate(year, Number(eu[2]), Number(eu[1]));
  }
  return null;
}

export function coerceValue(raw: unknown, valueType: TemplateValueType): Coerced {
  const original = raw == null ? '' : String(raw);
  const s = original.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  switch (valueType) {
    case 'TEXT':
      return s;
    case 'NUMBER': {
      if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
      const n = parsePlainOrGreekNumber(s);
      return n == null || !Number.isFinite(n) ? null : n;
    }
    case 'CURRENCY': {
      if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
      const cleaned = s.replace(/EUR|€/gi, '').trim();
      const n = parsePlainOrGreekCurrency(cleaned);
      return n == null || !Number.isFinite(n) ? null : n;
    }
    case 'DATE': {
      const d = raw instanceof Date ? (Number.isNaN(raw.getTime()) ? null : raw) : parseDateFlexible(s);
      if (!d) return null;
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
