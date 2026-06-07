export type FinancialValueTypeStr = 'CURRENCY' | 'NUMBER' | 'PERCENT' | 'INTEGER' | 'DATE' | 'BOOLEAN';

/** Parses Greek-formatted numbers: "1.556.540,27" → 1556540.27 (dot=thousands, comma=decimal). */
export function parseGreekNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v == null) return null;
  let s = String(v).trim();
  if (!s) return null;
  s = s.replace(/[^\d.,-]/g, '');
  if (!s || /^[.,-]+$/.test(s)) return null;
  s = s.replace(/\./g, '').replace(',', '.');
  const num = Number(s);
  return Number.isFinite(num) ? num : null;
}

export function parseGreekCurrency(v: unknown): number | null {
  return parseGreekNumber(v);
}

export function parseGreekPercentage(v: unknown): number | null {
  return parseGreekNumber(v);
}

/** Parses dd/mm/yyyy, dd.mm.yyyy, dd-mm-yyyy, or ISO. */
export function parseGreekDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const iso = new Date(s);
  return Number.isNaN(iso.getTime()) ? null : iso;
}

const TRUTHY = new Set(['1', 'ναι', 'nai', 'yes', 'true', 'αληθες', 'x', '✓']);
const FALSY = new Set(['0', 'οχι', 'όχι', 'ochi', 'no', 'false', '']);

/** Coerces a raw OCR/manual value to a numeric Decimal-ready number per field valueType. */
export function coerceFinancialValue(raw: unknown, valueType: FinancialValueTypeStr): number | null {
  switch (valueType) {
    case 'INTEGER': {
      const n = parseGreekNumber(raw);
      return n == null ? null : Math.round(n);
    }
    case 'BOOLEAN': {
      const s = String(raw ?? '').trim().toLowerCase();
      if (TRUTHY.has(s)) return 1;
      if (FALSY.has(s)) return 0;
      const n = parseGreekNumber(raw);
      return n == null ? null : n !== 0 ? 1 : 0;
    }
    case 'DATE': {
      const d = parseGreekDate(raw);
      return d ? d.getTime() : null;
    }
    case 'PERCENT':
    case 'CURRENCY':
    case 'NUMBER':
    default:
      return parseGreekNumber(raw);
  }
}
