import { describe, it, expect } from 'vitest';
import {
  COLOR_PALETTE, nextColor, slugKey, isValidBbox, INVOICE_SCHEMA, invoiceKeyInfo, uniqueKey, templateSlug, slugDraft, SLUG_RE,
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
});

describe('templateSlug', () => {
  it('slugs Greek names like a field key', () => { expect(templateSlug('ΗΡΩΝ — Εκκαθαριστικός')).toBe('iron_ekkatharistikos'); });
  it('never returns empty', () => { expect(templateSlug('!!!')).toMatch(/^field_/); });
});
