// lib/ocr/__tests__/example-lookup.test.ts
// Ποιο έγγραφο γίνεται παράδειγμα αναφοράς — και, κυρίως, πότε ΔΕΝ ρωτάμε καν τη βάση.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { db, settings } = vi.hoisted(() => ({
  db: { ocrDocument: { findFirst: vi.fn() } },
  settings: { getSetting: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/settings', () => settings);

import { loadIssuerExample, USE_ISSUER_EXAMPLE_KEY } from '../example-lookup';
import { fromLegacy } from '../canonical';

const VERIFIED = fromLegacy({
  companyName: 'ΚΑΠΑΛΙΝΕ ΑΕ', vatNumber: '999863881', invoiceNumber: '17',
  date: '2026-06-22', subtotal: 100, vatAmount: 24, totalAmount: 124,
  customerName: 'DGESPA ΑΕ',
}, [], 'invoice');

beforeEach(() => {
  vi.clearAllMocks();
  settings.getSetting.mockResolvedValue(undefined);      // ο διακόπτης δεν έχει οριστεί → ανοιχτός
  db.ocrDocument.findFirst.mockResolvedValue({ document: VERIFIED });
});

describe('loadIssuerExample', () => {
  it('γυρίζει συμπυκνωμένο παράδειγμα με την επωνυμία του εκδότη', async () => {
    const ex = await loadIssuerExample('999863881') as { issuer: { name: string; vat: string } };
    expect(ex.issuer.name).toBe('ΚΑΠΑΛΙΝΕ ΑΕ');
    expect(ex.issuer.vat).toBe('999863881');
  });

  it('ρωτάει ΜΟΝΟ για επιβεβαιωμένα, ολοκληρωμένα έγγραφα του ίδιου ΑΦΜ, με ένα ερώτημα', async () => {
    await loadIssuerExample('999863881');
    expect(db.ocrDocument.findFirst).toHaveBeenCalledTimes(1);
    const [args] = db.ocrDocument.findFirst.mock.calls[0];
    expect(args.where).toMatchObject({ issuerAfm: '999863881', status: 'COMPLETED' });
    expect(args.where.verifiedAt).toEqual({ not: null });
    expect(args.orderBy).toEqual({ verifiedAt: 'desc' });
    expect(args.select).toEqual({ document: true });
  });

  it('αποκλείει το έγγραφο που ξαναδιαβάζεται τώρα', async () => {
    await loadIssuerExample('999863881', { excludeId: 'doc1' });
    const [args] = db.ocrDocument.findFirst.mock.calls[0];
    expect(args.where.id).toEqual({ not: 'doc1' });
  });

  it('χωρίς επιβεβαιωμένο έγγραφο → null (και το prompt μένει όπως ήταν)', async () => {
    db.ocrDocument.findFirst.mockResolvedValue(null);
    expect(await loadIssuerExample('999863881')).toBeNull();
  });

  it('χωρίς ΑΦΜ → ούτε ερώτημα ούτε ανάγνωση ρύθμισης', async () => {
    expect(await loadIssuerExample(null)).toBeNull();
    expect(await loadIssuerExample('   ')).toBeNull();
    expect(db.ocrDocument.findFirst).not.toHaveBeenCalled();
    expect(settings.getSetting).not.toHaveBeenCalled();
  });

  it('με τον διακόπτη κλειστό → καμία ερώτηση στη βάση', async () => {
    settings.getSetting.mockResolvedValue(false);
    expect(await loadIssuerExample('999863881')).toBeNull();
    expect(settings.getSetting).toHaveBeenCalledWith(USE_ISSUER_EXAMPLE_KEY);
    expect(db.ocrDocument.findFirst).not.toHaveBeenCalled();
  });
});
