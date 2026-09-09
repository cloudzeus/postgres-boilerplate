// lib/templates/guess.ts — ISOMORPHIC. Heuristics for a value the model just read.
import type { TemplateValueType } from './schema';

const DATE_RE = /^(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}[./-]\d{1,2}[./-]\d{1,2})(\s+\d{1,2}:\d{2}(:\d{2})?)?$/;
// Greek "1.234,56" / "229,40" and English "4,122.85" — two decimals are the tell.
const CURRENCY_RE = /^[-+]?(\d{1,3}([.,]\d{3})*|\d+)[.,]\d{2}$/;
const CURRENCY_MARK_RE = /€|\beur\b|\bευρώ\b/i;
const NUMBER_RE = /^[-+]?(\d{1,3}(\.\d{3})*|\d+)([.,]\d+)?$/;
const UNIT_RE = /\s*(%|kwh|m3|m³|kg|lt|l|τεμ\.?|pcs?\.?|κιλά)$/i;
/** Ελληνικό λογιστικό άρθρο: 60.64.00.000.010 (≥3 groups). */
export const GL_ACCOUNT_RE = /^\d{2}(\.\d{2,3}){2,}$/;

export function isGlAccount(raw: string): boolean {
  return GL_ACCOUNT_RE.test(String(raw ?? '').replace(/\s+/g, ''));
}

export function guessValueType(raw: string): TemplateValueType {
  const s = String(raw ?? '').trim();
  if (!s) return 'TEXT';
  if (isGlAccount(s)) return 'TEXT';
  if (DATE_RE.test(s)) return 'DATE';
  const core = s.replace(CURRENCY_MARK_RE, '').trim();
  if (CURRENCY_MARK_RE.test(s) && /\d/.test(core)) return 'CURRENCY';
  if (CURRENCY_RE.test(core)) return 'CURRENCY';
  const num = core.replace(UNIT_RE, '').trim();
  if (NUMBER_RE.test(num) && !/^0\d/.test(num)) return 'NUMBER';
  return 'TEXT';
}
