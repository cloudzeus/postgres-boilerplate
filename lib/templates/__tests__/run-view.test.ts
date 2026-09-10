import { describe, it, expect } from 'vitest';
import { defaultTemplateId, editSeed, formatValue, matchesVat, pageCountOf, runSeverity, type TemplateChoice } from '../run-view';
import type { FieldValue } from '../schema';

const v = (over: Partial<FieldValue> = {}): FieldValue =>
  ({ raw: null, value: null, confidence: 1, source: 'vision', page: null, bbox: null, color: '#0078D4', ...over });

const t = (id: string, vatNumber: string | null, status: TemplateChoice['status'] = 'ACTIVE'): TemplateChoice => ({ id, vatNumber, status });

describe('formatValue', () => {
  it('shows an empty value as a dash', () => {
    expect(formatValue(null, 'TEXT')).toBe('—');
    expect(formatValue('', 'TEXT')).toBe('—');
  });
  it('gives CURRENCY exactly two decimals, always', () => {
    expect(formatValue(12, 'CURRENCY')).toBe('12,00');
    expect(formatValue(1234.5, 'CURRENCY')).toBe('1.234,50');
    // Rounded, not truncated, and never a third decimal.
    expect(formatValue(1.005, 'CURRENCY')).toBe('1,01');
  });
  it('gives NUMBER up to four decimals and no trailing zeros', () => {
    expect(formatValue(12, 'NUMBER')).toBe('12');
    expect(formatValue(1.23456, 'NUMBER')).toBe('1,2346');
    expect(formatValue(1.5, 'NUMBER')).toBe('1,5');
  });
  it('reports an array by its size, singular and plural', () => {
    expect(formatValue([{ a: 1 }], 'LIST')).toBe('1 γραμμή');
    expect(formatValue([{ a: 1 }, { a: 2 }], 'LIST')).toBe('2 γραμμές');
    expect(formatValue([], 'LIST')).toBe('0 γραμμές');
  });
  it('passes text through untouched', () => {
    expect(formatValue('ΑΒΓ', 'TEXT')).toBe('ΑΒΓ');
  });
});

describe('editSeed', () => {
  it('prefers the raw reading over the coerced value', () => {
    expect(editSeed(v({ raw: '1.234,50', value: 1234.5 }))).toBe('1.234,50');
  });
  it('falls back to the coerced value, and to an empty box for nothing at all', () => {
    expect(editSeed(v({ raw: null, value: 1234.5 }))).toBe('1234.5');
    expect(editSeed(v())).toBe('');
    expect(editSeed(undefined)).toBe('');
  });
});

describe('pageCountOf', () => {
  it('is one page when nothing carries a page', () => {
    expect(pageCountOf({})).toBe(1);
    expect(pageCountOf({ a: v() })).toBe(1);
  });
  it('counts up to the DEEPEST page a value came from', () => {
    expect(pageCountOf({ a: v({ page: 0 }), b: v({ page: 3 }), c: v({ page: 1 }) })).toBe(4);
  });
});

describe('matchesVat', () => {
  it('matches through spaces, dots and an EL prefix on either side', () => {
    expect(matchesVat(t('a', '123456789'), 'EL 123 456 789')).toBe(true);
    expect(matchesVat(t('a', 'EL123456789'), '123456789')).toBe(true);
  });
  it('never matches on a missing or malformed ΑΦΜ', () => {
    expect(matchesVat(t('a', '123456789'), null)).toBe(false);
    expect(matchesVat(t('a', '123456789'), '')).toBe(false);
    expect(matchesVat(t('a', null), null)).toBe(false);
    // Eight digits is not an ΑΦΜ — it must not match a template whose ΑΦΜ starts the same way.
    expect(matchesVat(t('a', '12345678'), '12345678')).toBe(false);
    expect(matchesVat(t('a', '123456789'), '12345678')).toBe(false);
  });
});

describe('defaultTemplateId', () => {
  const templates = [t('draft', '123456789', 'DRAFT'), t('active', '123456789'), t('other', '999999999')];
  it('keeps the template of the newest run when it still exists', () => {
    expect(defaultTemplateId(templates, '123456789', 'other')).toBe('other');
    expect(defaultTemplateId(templates, '123456789', 'deleted')).toBe('active');
  });
  it('prefers an ACTIVE ΑΦΜ match over a DRAFT one', () => {
    expect(defaultTemplateId(templates, '123456789')).toBe('active');
  });
  it('falls back to a DRAFT ΑΦΜ match, then to nothing', () => {
    expect(defaultTemplateId([t('draft', '123456789', 'DRAFT')], '123456789')).toBe('draft');
    expect(defaultTemplateId(templates, '111111111')).toBe('');
    expect(defaultTemplateId(templates, null)).toBe('');
  });
});

describe('runSeverity', () => {
  it('ranks the statuses by how loudly they ask for attention', () => {
    const ranked = (['POSTED', 'BLOCKED', null, 'REVIEW', 'FAILED', 'EXTRACTED'] as const)
      .slice()
      .sort((a, b) => runSeverity(b) - runSeverity(a));
    expect(ranked).toEqual(['BLOCKED', 'FAILED', 'REVIEW', 'EXTRACTED', 'POSTED', null]);
  });
  it('puts a document with no run at the bottom', () => {
    expect(runSeverity(null)).toBe(0);
    expect(runSeverity(undefined)).toBe(0);
    expect(runSeverity('POSTED')).toBeGreaterThan(0);
  });
});
