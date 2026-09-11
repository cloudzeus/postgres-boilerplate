// lib/ocr/__tests__/canonical.test.ts
// Το κανονικό JSON εγγράφου (spec §17.1): σχήμα, γέφυρες προς/από τα legacy flat κλειδιά,
// βοηθοί διαδρομών, κανονικοποίηση και αριθμητική συμφωνία.
import { describe, it, expect } from 'vitest';
import {
  DOCUMENT_PATHS,
  DOCUMENT_VERSION,
  DocumentSchema,
  LEGACY_KEY_TO_PATH,
  coerceDocument,
  emptyDocument,
  fromLegacy,
  getPath,
  isCanonical,
  legacyKeyToPath,
  normalizeDocument,
  parseNumber,
  reconcileDocument,
  setPath,
  toLegacy,
} from '../canonical';
import { parseGreekNumber } from '@/lib/greek-format';

const LEGACY = {
  companyName: 'ΚΑΠΑΛΙΝΕ ΑΕ',
  vatNumber: '999863881',
  companyAddress: 'Λεωφ. Αθηνών 1',
  companyDoy: 'ΦΑΕ ΑΘΗΝΩΝ',
  companyProfession: 'Εμπόριο',
  companyPhone: '2101234567',
  companyEmail: 'info@example.gr',
  customerName: 'ΠΕΛΑΤΗΣ ΕΠΕ',
  customerVatNumber: '094019245',
  customerAddress: 'Ερμού 5',
  customerDoy: 'Α ΑΘΗΝΩΝ',
  customerProfession: 'Υπηρεσίες',
  documentTypeLabel: 'ΤΙΜΟΛΟΓΙΟ ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙΩΝ',
  invoiceNumber: '17',
  aadeMark: '400014123456789',
  date: '2026-06-22',
  time: '12:30',
  itemsCount: 2,
  subtotal: 100,
  vatAmount: 24,
  totalAmount: 124,
  bankAccounts: [{ bank: 'Eurobank', iban: 'GR1234567890' }],
  items: [
    { code: 'A1', name: 'Είδος Α', quantity: 2, price: 25, discount: 0, vatRate: 24, total: 50 },
    { code: 'B2', name: 'Είδος Β', quantity: 1, price: 50, discount: 0, vatRate: 24, total: 50 },
  ],
  customFields: { poso_pliromis: '124,00' },
};

describe('DocumentSchema / emptyDocument', () => {
  it('parses an empty invoice document and fills every container', () => {
    const doc = emptyDocument('invoice');
    expect(DocumentSchema.parse(doc)).toEqual(doc);
    expect(doc.kind).toBe('invoice');
    expect(doc.lines).toEqual([]);
    expect(doc.vatBreakdown).toEqual([]);
    expect(doc.payment.ibans).toEqual([]);
    expect(doc.references.plates).toEqual([]);
    expect(doc.handwritten.allocations).toEqual([]);
    expect(doc.custom).toEqual({});
    expect(doc.currency).toBe('EUR');
    expect(doc.totals.total).toBeNull();
    expect(doc.issuer.name).toBeNull();
  });

  it('keeps `version` on the envelope only — never inside the document', () => {
    expect(DOCUMENT_VERSION).toBe(3);
    expect('version' in emptyDocument('invoice')).toBe(false);
  });

  it('strips unknown keys and coerces numeric strings', () => {
    const parsed = DocumentSchema.parse({ kind: 'invoice', totals: { total: '1.234,56' }, bogus: 1 });
    expect(parsed.totals.total).toBe(1234.56);
    expect('bogus' in parsed).toBe(false);
  });
});

describe('fromLegacy', () => {
  const doc = fromLegacy(LEGACY, LEGACY.items, 'invoice');

  it('maps the issuer block', () => {
    expect(doc.issuer.name).toBe('ΚΑΠΑΛΙΝΕ ΑΕ');
    expect(doc.issuer.vat).toBe('999863881');
    expect(doc.issuer.address).toBe('Λεωφ. Αθηνών 1');
    expect(doc.issuer.doy).toBe('ΦΑΕ ΑΘΗΝΩΝ');
    expect(doc.issuer.profession).toBe('Εμπόριο');
    expect(doc.issuer.phone).toBe('2101234567');
    expect(doc.issuer.email).toBe('info@example.gr');
  });

  it('maps the recipient block', () => {
    expect(doc.recipient.name).toBe('ΠΕΛΑΤΗΣ ΕΠΕ');
    expect(doc.recipient.vat).toBe('094019245');
    expect(doc.recipient.address).toBe('Ερμού 5');
    expect(doc.recipient.doy).toBe('Α ΑΘΗΝΩΝ');
    expect(doc.recipient.profession).toBe('Υπηρεσίες');
  });

  it('maps type, date, digital mark and the receipt-only keys into custom', () => {
    expect(doc.type.label).toBe('ΤΙΜΟΛΟΓΙΟ ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙΩΝ');
    expect(doc.type.number).toBe('17');
    expect(doc.digital.mark).toBe('400014123456789');
    expect(doc.date).toBe('2026-06-22');
    expect(doc.custom.time).toBe('12:30');
    expect(doc.custom.itemsCount).toBe(2);
  });

  it('maps totals and defaults payable to the grand total', () => {
    expect(doc.totals.net).toBe(100);
    expect(doc.totals.vatAmount).toBe(24);
    expect(doc.totals.total).toBe(124);
    expect(doc.totals.payable).toBe(124);
  });

  it('maps bank accounts and custom fields', () => {
    expect(doc.payment.ibans).toEqual([{ bank: 'Eurobank', iban: 'GR1234567890' }]);
    expect(doc.custom.poso_pliromis).toBe('124,00');
  });

  it('maps items[] → lines[] with unitPrice/net and a computed line VAT', () => {
    expect(doc.lines).toHaveLength(2);
    expect(doc.lines[0]).toMatchObject({
      code: 'A1', name: 'Είδος Α', quantity: 2, unitPrice: 25, discount: 0,
      net: 50, vatRate: 24, vatAmount: 12, total: 62,
    });
    expect(doc.lines[0].custom).toEqual({});
  });

  it('is an invoice when a recipient is present, a receipt when not', () => {
    expect(doc.kind).toBe('invoice');
    const { customerName, customerVatNumber, ...noRecipient } = LEGACY;
    expect(fromLegacy(noRecipient, LEGACY.items, 'invoice').kind).toBe('receipt');
  });

  it('accepts the legacy receipt keys (storeName/phone/email)', () => {
    const r = fromLegacy({ storeName: 'ΜΙΝΙ ΜΑΡΚΕΤ', vatNumber: '123456789', phone: '2109999999', email: 'a@b.gr' }, [], 'receipt');
    expect(r.issuer.name).toBe('ΜΙΝΙ ΜΑΡΚΕΤ');
    expect(r.issuer.phone).toBe('2109999999');
    expect(r.issuer.email).toBe('a@b.gr');
    expect(r.kind).toBe('receipt');
  });

  it('maps general_text into custom with notes = summary', () => {
    const g = fromLegacy({ title: 'Τίτλος', fullText: 'Πλήρες κείμενο', summary: 'Περίληψη', keywords: ['α', 'β'] }, [], 'general_text');
    expect(g.kind).toBe('general');
    expect(g.custom.title).toBe('Τίτλος');
    expect(g.custom.fullText).toBe('Πλήρες κείμενο');
    expect(g.custom.summary).toBe('Περίληψη');
    expect(g.custom.keywords).toEqual(['α', 'β']);
    expect(g.notes).toBe('Περίληψη');
  });
});

describe('toLegacy', () => {
  it('is the inverse of fromLegacy for every invoice key', () => {
    const back = toLegacy(fromLegacy(LEGACY, LEGACY.items, 'invoice'));
    for (const [k, v] of Object.entries(LEGACY)) {
      if (k === 'items') continue;
      expect(back[k], `key ${k}`).toEqual(v);
    }
  });

  it('regenerates items[] from lines[] (price = unitPrice, total = net)', () => {
    const back = toLegacy(fromLegacy(LEGACY, LEGACY.items, 'invoice'));
    expect(back.items).toEqual([
      { code: 'A1', name: 'Είδος Α', quantity: 2, price: 25, discount: 0, vatRate: 24, total: 50 },
      { code: 'B2', name: 'Είδος Β', quantity: 1, price: 50, discount: 0, vatRate: 24, total: 50 },
    ]);
  });

  it('emits bankAccounts from payment.ibans and customFields from custom', () => {
    const doc = emptyDocument('invoice');
    doc.payment.ibans = [{ bank: 'Πειραιώς', iban: 'GR99' }];
    doc.custom = { foo: 'bar', time: '10:00' };
    const back = toLegacy(doc);
    expect(back.bankAccounts).toEqual([{ bank: 'Πειραιώς', iban: 'GR99' }]);
    expect(back.customFields).toEqual({ foo: 'bar' });   // `time` has its own legacy key
    expect(back.time).toBe('10:00');
  });

  it('emits only the general_text keys for a general document', () => {
    const g = fromLegacy({ title: 'Τ', fullText: 'Κ', summary: 'Π', keywords: ['α'] }, [], 'general_text');
    const back = toLegacy(g);
    expect(back).toMatchObject({ title: 'Τ', fullText: 'Κ', summary: 'Π', keywords: ['α'] });
    expect('companyName' in back).toBe(false);
  });
});

describe('getPath / setPath', () => {
  const doc = fromLegacy(LEGACY, LEGACY.items, 'invoice');

  it('reads header paths', () => {
    expect(getPath(doc, 'totals.total')).toBe(124);
    expect(getPath(doc, 'issuer.vat')).toBe('999863881');
    expect(getPath(doc, 'type.number')).toBe('17');
    expect(getPath(doc, 'references.period.from')).toBeNull();
    expect(getPath(doc, 'nope.nope')).toBeNull();
  });

  it('reads a lines.* path as the array of line values', () => {
    expect(getPath(doc, 'lines.net')).toEqual([50, 50]);
    expect(getPath(doc, 'lines.code')).toEqual(['A1', 'B2']);
  });

  it('creates intermediate objects and returns a new document', () => {
    const next = setPath(doc, 'handwritten.glAccount', '64.00');
    expect(next.handwritten.glAccount).toBe('64.00');
    expect(doc.handwritten.glAccount).toBeNull();          // input untouched
    expect(setPath(doc, 'custom.foo', 1).custom.foo).toBe(1);
  });

  it('refuses a lines.* path and an unsafe key', () => {
    expect(() => setPath(doc, 'lines.net', 1)).toThrow();
    expect(() => setPath(doc, '__proto__.polluted', 1)).toThrow();
  });
});

describe('normalizeDocument', () => {
  it('normalizes ΑΦΜ, dates, numeric strings, VAT rates and currency', () => {
    const doc = normalizeDocument({
      kind: 'invoice',
      date: '22/06/2026',
      dueDate: '1/7/2026',
      currency: null,
      issuer: { name: '  ΚΑΠΑΛΙΝΕ  ', vat: 'EL 999 863 881', doy: '' },
      recipient: { vat: 'ΑΦΜ: 094019245' },
      totals: { net: '1.234,56', vatAmount: '296,29', total: '1.530,85' },
      lines: [{ name: 'Α', vatRate: '24%', net: '1.234,56' }],
      references: { period: { from: '01/06/2026', to: '30/06/2026' } },
    });
    expect(doc.date).toBe('2026-06-22');
    expect(doc.dueDate).toBe('2026-07-01');
    expect(doc.currency).toBe('EUR');
    expect(doc.issuer.name).toBe('ΚΑΠΑΛΙΝΕ');
    expect(doc.issuer.vat).toBe('999863881');
    expect(doc.issuer.doy).toBeNull();
    expect(doc.recipient.vat).toBe('094019245');
    expect(doc.totals.net).toBe(1234.56);
    expect(doc.totals.total).toBe(1530.85);
    expect(doc.lines[0].vatRate).toBe(24);
    expect(doc.lines[0].net).toBe(1234.56);
    expect(doc.references.period?.from).toBe('2026-06-01');
    expect(doc.references.period?.to).toBe('2026-06-30');
  });
});

describe('reconcileDocument', () => {
  const lines = [
    { name: 'Α', quantity: 2, unitPrice: 25, net: 50, vatRate: 24 },
    { name: 'Β', quantity: 1, unitPrice: 50, net: 50, vatRate: 24 },
  ];

  it('fills totals and the VAT breakdown from the lines when they are missing', () => {
    const { document, checks } = reconcileDocument(normalizeDocument({ kind: 'invoice', lines }));
    expect(document.totals.net).toBe(100);
    expect(document.totals.vatAmount).toBe(24);
    expect(document.totals.total).toBe(124);
    expect(document.totals.payable).toBe(124);
    expect(document.vatBreakdown).toEqual([{ rate: 24, net: 100, vat: 24 }]);
    expect(checks).toEqual({ linesVsNet: null, vatOk: null, totalOk: null });
  });

  it('never overwrites a printed total and reports the checks', () => {
    const { document, checks } = reconcileDocument(normalizeDocument({
      kind: 'invoice', lines, totals: { net: 100, vatAmount: 24, total: 124 },
    }));
    expect(document.totals.total).toBe(124);
    expect(checks).toEqual({ linesVsNet: true, vatOk: true, totalOk: true });
  });

  it('flags a mismatch between the lines and the printed net', () => {
    const { checks } = reconcileDocument(normalizeDocument({
      kind: 'invoice', lines, totals: { net: 180, vatAmount: 24, total: 204 },
    }));
    expect(checks.linesVsNet).toBe(false);
  });

  it('computes payable = total − withholding + fees', () => {
    const { document } = reconcileDocument(normalizeDocument({
      kind: 'invoice', totals: { net: 100, vatAmount: 24, total: 124, withholding: 20, fees: 5 },
    }));
    expect(document.totals.payable).toBe(109);
  });
});

describe('coerceDocument', () => {
  it('validates canonical-shaped input, nulling bad types and stripping unknowns', () => {
    const doc = coerceDocument({
      kind: 'invoice', issuer: { name: 'Α', vat: 123456789 }, lines: 'not-an-array',
      totals: { total: 'δεν είναι αριθμός' }, junk: true,
    }, 'invoice');
    expect(doc.issuer.name).toBe('Α');
    expect(doc.issuer.vat).toBe('123456789');
    expect(doc.lines).toEqual([]);
    expect(doc.totals.total).toBeNull();
    expect('junk' in doc).toBe(false);
  });

  it('routes flat legacy input through fromLegacy', () => {
    const doc = coerceDocument(LEGACY, 'invoice');
    expect(doc.issuer.name).toBe('ΚΑΠΑΛΙΝΕ ΑΕ');
    expect(doc.lines).toHaveLength(2);
  });

  it('returns an empty document for garbage', () => {
    expect(coerceDocument(null, 'invoice')).toEqual(emptyDocument('invoice'));
    expect(coerceDocument('τίποτα', 'invoice')).toEqual(emptyDocument('invoice'));
    expect(coerceDocument([1, 2], 'general_text').kind).toBe('general');
  });

  it('derives the kind when the model omitted it', () => {
    expect(coerceDocument({ issuer: { name: 'Α' }, recipient: { name: 'Β' } }, 'invoice').kind).toBe('invoice');
    expect(coerceDocument({ issuer: { name: 'Α' } }, 'invoice').kind).toBe('receipt');
  });

  it('never throws', () => {
    expect(() => coerceDocument({ kind: 'βλακεία', lines: [null, 3] }, 'invoice')).not.toThrow();
  });
});

describe('isCanonical', () => {
  it('tells canonical documents from flat legacy payloads', () => {
    expect(isCanonical(emptyDocument('invoice'))).toBe(true);
    expect(isCanonical({ issuer: { name: 'Α' } })).toBe(true);
    expect(isCanonical(LEGACY)).toBe(false);
    expect(isCanonical(null)).toBe(false);
  });
});

describe('DOCUMENT_PATHS / LEGACY_KEY_TO_PATH', () => {
  it('registers every header path from the spec with a Greek label', () => {
    const byPath = new Map(DOCUMENT_PATHS.map((p) => [p.path, p]));
    for (const path of [
      'type.label', 'type.series', 'type.number', 'type.myDataType', 'date', 'dueDate', 'currency',
      'issuer.name', 'issuer.vat', 'issuer.doy', 'issuer.profession', 'issuer.address', 'issuer.city',
      'issuer.zip', 'issuer.country', 'issuer.phone', 'issuer.email', 'issuer.gemi',
      'recipient.name', 'recipient.vat', 'recipient.doy', 'recipient.profession', 'recipient.address',
      'recipient.city', 'recipient.zip', 'recipient.country', 'recipient.code',
      'totals.net', 'totals.discount', 'totals.vatAmount', 'totals.withholding', 'totals.fees',
      'totals.total', 'totals.payable',
      'digital.mark', 'digital.uid', 'digital.authCode', 'digital.provider',
      'payment.method', 'payment.terms',
      'references.orderNo', 'references.deliveryNote', 'references.contract', 'references.shipment',
      'references.period.from', 'references.period.to', 'notes',
      'handwritten.glAccount', 'handwritten.reference',
    ]) {
      const info = byPath.get(path);
      expect(info, `missing path ${path}`).toBeTruthy();
      expect(info!.isLine).toBe(false);
      expect(info!.label.length).toBeGreaterThan(0);
    }
    expect(byPath.get('totals.total')!.label).toBe('Γενικό σύνολο');
    expect(byPath.get('issuer.vat')!.valueType).toBe('TEXT');
    expect(byPath.get('totals.payable')!.valueType).toBe('CURRENCY');
    expect(byPath.get('date')!.valueType).toBe('DATE');
  });

  it('registers the line paths with isLine', () => {
    const byPath = new Map(DOCUMENT_PATHS.map((p) => [p.path, p]));
    for (const path of ['lines.code', 'lines.name', 'lines.unit', 'lines.quantity', 'lines.unitPrice',
      'lines.discount', 'lines.net', 'lines.vatRate', 'lines.vatAmount', 'lines.total']) {
      expect(byPath.get(path), `missing path ${path}`).toBeTruthy();
      expect(byPath.get(path)!.isLine).toBe(true);
    }
    expect(byPath.get('lines.unitPrice')!.label).toBe('Γραμμή: τιμή μονάδας');
    expect(byPath.get('lines.net')!.label).toBe('Γραμμή: καθαρή αξία');
  });

  it('has no duplicate paths', () => {
    expect(new Set(DOCUMENT_PATHS.map((p) => p.path)).size).toBe(DOCUMENT_PATHS.length);
  });

  it('maps every legacy flat key onto a registered path', () => {
    const known = new Set(DOCUMENT_PATHS.map((p) => p.path));
    // The 25 keys of the pre-canonical INVOICE schema, verbatim — a mapping saved against any of
    // them must keep resolving after the switch to paths.
    const legacy = [
      'companyName', 'vatNumber', 'companyAddress', 'companyDoy', 'companyProfession', 'companyPhone',
      'companyEmail', 'customerName', 'customerVatNumber', 'documentTypeLabel', 'invoiceNumber',
      'aadeMark', 'date', 'time', 'itemsCount', 'subtotal', 'vatAmount', 'totalAmount',
      'items.code', 'items.name', 'items.quantity', 'items.price', 'items.discount', 'items.vatRate', 'items.total',
    ];
    for (const k of legacy) {
      const path = LEGACY_KEY_TO_PATH[k];
      expect(path, `legacy key ${k}`).toBeTruthy();
      if (!path.startsWith('custom.')) expect(known.has(path), `path ${path}`).toBe(true);
    }
    expect(LEGACY_KEY_TO_PATH.subtotal).toBe('totals.net');
    expect(LEGACY_KEY_TO_PATH['items.price']).toBe('lines.unitPrice');
    expect(LEGACY_KEY_TO_PATH['items.total']).toBe('lines.net');
    expect(LEGACY_KEY_TO_PATH.time).toBe('custom.time');
  });

  it('legacyKeyToPath resolves customFields.<k> and passes canonical paths through', () => {
    expect(legacyKeyToPath('customFields.poso')).toBe('custom.poso');
    expect(legacyKeyToPath('totals.payable')).toBe('totals.payable');
    expect(legacyKeyToPath('companyName')).toBe('issuer.name');
    expect(legacyKeyToPath('τίποτα')).toBeNull();
  });
});

describe('parseNumber — δύο πηγές, δύο συμβάσεις', () => {
  it('κείμενο: ελληνική σύμβαση — τελεία = χιλιάδες, κόμμα = δεκαδικό', () => {
    expect(parseNumber('1.234,56')).toBe(1234.56);
    expect(parseNumber('1.556.540,27')).toBe(1556540.27);
    // Η τελεία ΠΟΤΕ δεν είναι δεκαδικό σε τυπωμένο ελληνικό ποσό — ίδιος κανόνας με το
    // `parseGreekNumber` που διαβάζει τις τιμές των προτύπων.
    expect(parseNumber('1.234')).toBe(1234);
    expect(parseNumber('1.234')).toBe(parseGreekNumber('1.234'));
    expect(parseNumber('12,34')).toBe(parseGreekNumber('12,34'));
    expect(parseNumber('24%')).toBe(24);
    expect(parseNumber('1.234,56 €')).toBe(1234.56);
    expect(parseNumber('-45,5')).toBe(-45.5);
  });

  it('αντικείμενο Decimal: μηχανική μορφή, όχι ελληνική', () => {
    expect(parseNumber({ toNumber: () => 25 })).toBe(25);
    expect(parseNumber({ toNumber: () => 1234.56 })).toBe(1234.56);
    expect(parseNumber({ toString: () => '25' })).toBe(25);
    expect(parseNumber({ toString: () => '1234.56' })).toBe(1234.56);
  });

  it('επιστρέφει null για ό,τι δεν είναι αριθμός — ποτέ NaN', () => {
    expect(parseNumber('')).toBeNull();
    expect(parseNumber(null)).toBeNull();
    expect(parseNumber('άκυρο')).toBeNull();
    expect(parseNumber(true)).toBeNull();
    expect(parseNumber([1, 2])).toBeNull();
    expect(parseNumber({})).toBeNull();
    expect(parseNumber(Number.NaN)).toBeNull();
  });

  it('μια γραμμή με Decimal τιμές δεν μηδενίζει τα σύνολα', () => {
    const dec = (v: string) => ({ toNumber: () => Number(v) });
    const doc = fromLegacy({}, [{ name: 'Α', quantity: dec('2'), price: dec('25'), total: dec('50'), vatRate: dec('24') }], 'invoice');
    expect(doc.lines[0].net).toBe(50);
    expect(doc.lines[0].unitPrice).toBe(25);
    expect(reconcileDocument(doc).document.totals.net).toBe(50);
  });
});

describe('legacyKeyToPath — κλειδιά που μολύνουν prototype', () => {
  it('απορρίπτει __proto__ / constructor / prototype / toString αντί να γυρίσει συνάρτηση', () => {
    for (const key of ['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty']) {
      expect(legacyKeyToPath(key), `key ${key}`).toBeNull();
    }
  });

  it('ο χάρτης δεν κληρονομεί τίποτα από το Object.prototype', () => {
    expect((LEGACY_KEY_TO_PATH as Record<string, unknown>).toString).toBeUndefined();
    expect((LEGACY_KEY_TO_PATH as Record<string, unknown>).__proto__).toBeUndefined();
  });
});
