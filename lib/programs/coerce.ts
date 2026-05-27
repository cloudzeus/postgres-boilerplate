import { formatKadDots, stripKadDots } from '@/lib/kad/resolve';

export function asDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = typeof v === 'string' ? v.trim() : String(v);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function asNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[€\s,]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function asStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export function normalizeKad(raw: string): { code: string; codeWithoutDots: string } {
  const code = formatKadDots(raw);
  const codeWithoutDots = stripKadDots(raw);
  return { code, codeWithoutDots };
}
