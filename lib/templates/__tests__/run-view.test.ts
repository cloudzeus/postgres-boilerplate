import { describe, it, expect } from 'vitest';
import { buildRunRegions, defaultTemplateId, editSeed, formatValue, matchesVat, pageCountOf, parseColumns, regionIndexOf, regionKeyAt, runSeverity, type TemplateChoice } from '../run-view';
import type { Bbox, FieldValue } from '../schema';

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
  it('never goes below the floor it is given — pages nothing was read from stay reachable', () => {
    // The sample has five pages, the run only read page 0: a field can still be marked on page 4.
    expect(pageCountOf({ a: v({ page: 0 }) }, 5)).toBe(5);
    expect(pageCountOf({}, 3)).toBe(3);
  });
  it('keeps the deepest page when it is past the floor, and ignores a floor of zero', () => {
    expect(pageCountOf({ a: v({ page: 7 }) }, 3)).toBe(8);
    expect(pageCountOf({ a: v({ page: 2 }) }, 0)).toBe(3);
  });
});

describe('parseColumns', () => {
  it('splits on commas, trims, and slugs a key per column', () => {
    expect(parseColumns('Περιγραφή, Ποσότητα , Αξία')).toEqual([
      { key: 'perigrafi', label: 'Περιγραφή', valueType: 'TEXT' },
      { key: 'posotita', label: 'Ποσότητα', valueType: 'TEXT' },
      { key: 'axia', label: 'Αξία', valueType: 'TEXT' },
    ]);
  });
  it('drops empty entries — trailing commas and whitespace are not columns', () => {
    expect(parseColumns('')).toEqual([]);
    expect(parseColumns('  ')).toEqual([]);
    expect(parseColumns(', ,')).toEqual([]);
    expect(parseColumns('Αξία, ,').map((c) => c.label)).toEqual(['Αξία']);
  });
  it('keeps the keys unique when two labels slug the same', () => {
    const keys = parseColumns('Αξία, Αξία, Αξία').map((c) => c.key);
    expect(new Set(keys).size).toBe(3);
    expect(keys[0]).toBe('axia');
  });
});

describe('buildRunRegions', () => {
  const box = (n: number): Bbox => [n, n, 0.1, 0.1];

  it('keeps only the boxes of the page it is asked for, and pairs each with its field key', () => {
    const values = { a: v({ bbox: box(0.1), page: 0 }), b: v({ bbox: box(0.2), page: 1 }), c: v({ bbox: box(0.3), page: 0 }) };
    const { regions, keys } = buildRunRegions(values, {}, 0);
    expect(keys).toEqual(['a', 'c']);
    expect(regions.map((r) => r.bbox)).toEqual([box(0.1), box(0.3)]);
  });

  it('treats a value with no page as page 0, and skips one with no box at all', () => {
    const values = { a: v({ bbox: box(0.1), page: null }), b: v({ bbox: null, page: 0 }) };
    expect(buildRunRegions(values, {}, 0).keys).toEqual(['a']);
    expect(buildRunRegions(values, {}, 1).keys).toEqual([]);
  });

  it('lets a pending box win over the one the run was executed with', () => {
    const values = { a: v({ bbox: box(0.1), page: 0, color: '#111111' }) };
    const { regions, keys } = buildRunRegions(values, { a: { page: 0, bbox: box(0.5) } }, 0);
    expect(keys).toEqual(['a']);
    // The geometry is the user's; the colour still belongs to the field.
    expect(regions[0]).toEqual({ bbox: box(0.5), color: '#111111' });
  });

  it('follows a pending box to ANOTHER page — it leaves the old page and appears on the new one', () => {
    const values = { a: v({ bbox: box(0.1), page: 0 }) };
    const pending = { a: { page: 2, bbox: box(0.5) } };
    expect(buildRunRegions(values, pending, 0).keys).toEqual([]);
    expect(buildRunRegions(values, pending, 2).keys).toEqual(['a']);
  });

  it('shows a box drawn for a field the run never read', () => {
    const values = { a: v({ bbox: null, page: null, source: 'none' }) };
    expect(buildRunRegions(values, { a: { page: 0, bbox: box(0.4) } }, 0).keys).toEqual(['a']);
  });

  it('returns nothing for a run with no values', () => {
    expect(buildRunRegions({}, {}, 0)).toEqual({ regions: [], keys: [] });
  });
});

describe('regionIndexOf / regionKeyAt', () => {
  const keys = ['a', 'b', 'c'];
  it('translates a field key to the index the marker knows it by, and back', () => {
    expect(regionIndexOf(keys, 'b')).toBe(1);
    expect(regionKeyAt(keys, 1)).toBe('b');
  });
  it('answers null for nothing focused, for a field that has no box on this page, and for a stale index', () => {
    expect(regionIndexOf(keys, null)).toBeNull();
    expect(regionIndexOf(keys, 'zz')).toBeNull();
    expect(regionKeyAt(keys, null)).toBeNull();
    expect(regionKeyAt(keys, 7)).toBeNull();
  });
  it('round-trips every key of a built page', () => {
    const { keys: built } = buildRunRegions({ a: v({ bbox: [0, 0, 1, 1], page: 0 }), b: v({ bbox: [0, 0, 1, 1], page: 0 }) }, {}, 0);
    for (const k of built) expect(regionKeyAt(built, regionIndexOf(built, k))).toBe(k);
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
