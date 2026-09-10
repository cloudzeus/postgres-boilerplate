import { describe, it, expect } from 'vitest';
import {
  COLOR_PALETTE, nextColor, slugKey, isValidBbox, INVOICE_SCHEMA, invoiceKeyInfo, uniqueKey, templateSlug, slugDraft, SLUG_RE, normalizeVat, padBbox,
} from '../schema';

describe('COLOR_PALETTE / nextColor', () => {
  it('has 12 distinct hex colours', () => {
    expect(COLOR_PALETTE).toHaveLength(12);
    expect(new Set(COLOR_PALETTE).size).toBe(12);
    for (const c of COLOR_PALETTE) expect(c).toMatch(/^#[0-9A-F]{6}$/);
  });
  it('returns the first unused colour', () => {
    expect(nextColor([])).toBe(COLOR_PALETTE[0]);
    expect(nextColor([COLOR_PALETTE[0]])).toBe(COLOR_PALETTE[1]);
    expect(nextColor([COLOR_PALETTE[0], COLOR_PALETTE[2]])).toBe(COLOR_PALETTE[1]);
  });
  it('wraps around when every colour is used', () => {
    expect(nextColor([...COLOR_PALETTE])).toBe(COLOR_PALETTE[0]);
    expect(nextColor([...COLOR_PALETTE, COLOR_PALETTE[0]])).toBe(COLOR_PALETTE[1]);
  });
  it('ignores case when comparing used colours', () => {
    expect(nextColor([COLOR_PALETTE[0].toLowerCase()])).toBe(COLOR_PALETTE[1]);
  });
});

describe('slugKey', () => {
  it('transliterates Greek to an ascii snake_case key', () => {
    expect(slugKey('Αριθμός Παραγγελίας')).toBe('arithmos_paraggelias');
  });
  it('keeps ascii, collapses punctuation', () => {
    expect(slugKey('PO Number / 2026')).toBe('po_number_2026');
  });
  it('is deterministic for empty input', () => {
    expect(slugKey('')).toBe(slugKey(''));
    expect(slugKey('').startsWith('field_')).toBe(true);
  });
});

describe('isValidBbox', () => {
  it('accepts a normalized box', () => { expect(isValidBbox([0.1, 0.2, 0.3, 0.4])).toBe(true); });
  it('rejects out-of-range, zero-size, or wrong arity', () => {
    expect(isValidBbox([0, 0, 1.2, 0.1])).toBe(false);
    expect(isValidBbox([0, 0, 0, 0.1])).toBe(false);
    expect(isValidBbox([0, 0, 0.5])).toBe(false);
    expect(isValidBbox('x')).toBe(false);
  });
  it('tolerates a box that touches the right/bottom edge within floating-point noise', () => {
    expect(isValidBbox([0.5, 0.5, 0.5, 0.5])).toBe(true);
    expect(isValidBbox([0.5, 0.5, 0.50005, 0.5])).toBe(true);
    expect(isValidBbox([0.5, 0.5, 0.51, 0.5])).toBe(false);
  });
});

describe('INVOICE_SCHEMA', () => {
  it('contains header keys and line keys with isLine flag', () => {
    expect(invoiceKeyInfo('invoiceNumber')?.isLine).toBe(false);
    expect(invoiceKeyInfo('items.quantity')?.isLine).toBe(true);
    expect(invoiceKeyInfo('nope')).toBeNull();
    expect(invoiceKeyInfo('totalAmount')?.valueType).toBe('CURRENCY');
    expect(invoiceKeyInfo('netTotal')).toBeNull();
  });
  it('treats any customFields.* key as a valid TEXT header key', () => {
    expect(invoiceKeyInfo('customFields.order_no')).toEqual({ key: 'customFields.order_no', label: 'order_no', valueType: 'TEXT', isLine: false });
  });
  it('has unique keys', () => {
    expect(new Set(INVOICE_SCHEMA.map((k) => k.key)).size).toBe(INVOICE_SCHEMA.length);
  });
});

describe('uniqueKey', () => {
  it('returns the base when free', () => { expect(uniqueKey('total', ['date'])).toBe('total'); });
  it('suffixes _2, _3… when taken', () => {
    expect(uniqueKey('total', ['total'])).toBe('total_2');
    expect(uniqueKey('total', ['total', 'total_2'])).toBe('total_3');
  });
  it('accepts any iterable', () => { expect(uniqueKey('a', new Set(['a']))).toBe('a_2'); });
  it('keeps the suffixed key inside the 60-char limit', () => {
    const base = 'a'.repeat(60);
    const k = uniqueKey(base, [base]);
    expect(k.length).toBeLessThanOrEqual(60);
    expect(k.endsWith('_2')).toBe(true);
    expect(k).toMatch(SLUG_RE);
  });
});

describe('slugDraft', () => {
  it('is empty while the box is empty', () => { expect(slugDraft('')).toBe(''); expect(slugDraft('  ')).toBe(''); });
  it('keeps a separator the user just typed so the next word can be joined', () => {
    expect(slugDraft('iron_')).toBe('iron_');
    expect(slugDraft('iron_2')).toBe('iron_2');
    expect(slugDraft('ΗΡΩΝ ')).toBe('iron_');
  });
  it('slugs like slugKey otherwise', () => { expect(slugDraft('ΗΡΩΝ — Εκκαθαριστικός')).toBe('iron_ekkatharistikos'); });
  it('never leaves the server charset', () => {
    for (const v of ['iron_', 'ΗΡΩΝ — Εκκαθαριστικός', 'Foo Bar!', 'a']) expect(slugDraft(v)).toMatch(SLUG_RE);
  });
  it('stays inside 60 chars even when a separator is appended to a maxed-out key', () => {
    const long = 'a'.repeat(65) + ' ';
    const d = slugDraft(long);
    expect(d.length).toBe(60);
    expect(d).toMatch(SLUG_RE);
  });
});

describe('templateSlug', () => {
  it('slugs Greek names like a field key', () => { expect(templateSlug('ΗΡΩΝ — Εκκαθαριστικός')).toBe('iron_ekkatharistikos'); });
  it('never returns empty', () => { expect(templateSlug('!!!')).toMatch(/^field_/); });
});

describe('normalizeVat', () => {
  it('keeps the nine digits of an ΑΦΜ however it was written', () => {
    expect(normalizeVat('123456789')).toBe('123456789');
    expect(normalizeVat('EL123456789')).toBe('123456789');
    expect(normalizeVat(' 123 456 789 ')).toBe('123456789');
    expect(normalizeVat('123.456.789')).toBe('123456789');
    expect(normalizeVat(123456789)).toBe('123456789');
  });
  it('rejects anything that is not exactly nine digits', () => {
    expect(normalizeVat('12345678')).toBeNull();       // eight
    expect(normalizeVat('1234567890')).toBeNull();     // ten
    expect(normalizeVat('')).toBeNull();
    expect(normalizeVat('ΑΦΜ')).toBeNull();
    expect(normalizeVat(null)).toBeNull();
    expect(normalizeVat(undefined)).toBeNull();
    expect(normalizeVat({})).toBeNull();
  });
  it('keeps a leading zero — an ΑΦΜ is a string, not a number', () => {
    expect(normalizeVat('012345678')).toBe('012345678');
  });
});

describe('padBbox', () => {
  it('grows the box by `pad` on every side', () => {
    const [x, y, w, h] = padBbox([0.4, 0.4, 0.2, 0.1], 0.01);
    expect(x).toBeCloseTo(0.39, 10);
    expect(y).toBeCloseTo(0.39, 10);
    expect(w).toBeCloseTo(0.22, 10);
    expect(h).toBeCloseTo(0.12, 10);
  });

  it('clamps at the page edges instead of running off them', () => {
    const [x, y, w, h] = padBbox([0, 0, 0.5, 0.5], 0.02);
    expect([x, y]).toEqual([0, 0]);
    expect(w).toBeCloseTo(0.52, 10);
    expect(h).toBeCloseTo(0.52, 10);

    const full = padBbox([0, 0, 1, 1], 0.05);
    expect(full).toEqual([0, 0, 1, 1]);

    const corner = padBbox([0.9, 0.95, 0.1, 0.05], 0.03);
    expect(corner[0]).toBeCloseTo(0.87, 10);
    expect(corner[1]).toBeCloseTo(0.92, 10);
    expect(corner[0] + corner[2]).toBeCloseTo(1, 10);
    expect(corner[1] + corner[3]).toBeCloseTo(1, 10);
  });

  it('returns the box untouched for a zero, negative or non-finite pad', () => {
    const b: [number, number, number, number] = [0.2, 0.2, 0.1, 0.1];
    expect(padBbox(b, 0)).toBe(b);
    expect(padBbox(b, -0.1)).toBe(b);
    expect(padBbox(b, Number.NaN)).toBe(b);
  });
});
