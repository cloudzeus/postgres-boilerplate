// lib/ocr/__tests__/queue-routes.test.ts
// Τα routes των δύο ουρών (spec 2026-09-11 §2/§3) καλούνται ΑΠΕΥΘΕΙΑΣ ως handlers, με
// mocked rbac / prisma / SoftOne / audit. Εδώ ελέγχουμε ό,τι δεν πιάνει το `lib/ocr/queues.ts`:
// τους φύλακες (permission, ΑΦΜ, SODTYPE) και ότι το dry-run δεν γράφει ΠΟΥΘΕΝΑ.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { db, rbac, s1, audit, s1read } = vi.hoisted(() => ({
  db: {
    ocrDocument: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn(), groupBy: vi.fn() },
    purchaseDocType: { findFirst: vi.fn(), findUnique: vi.fn() },
    softoneDocSeries: { findFirst: vi.fn() },
    ocrInvoiceItem: { findMany: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    ignoredIssuer: { findMany: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
    softoneTrader: { findUnique: vi.fn(), upsert: vi.fn() },
    softoneItem: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
    softoneExpense: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
    lineMatchRule: { findMany: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(),
  },
  rbac: { requirePermission: vi.fn() },
  s1: {
    softoneCreateSupplier: vi.fn(),
    softoneCreateCreditor: vi.fn(),
    softoneCreateItem: vi.fn(),
    softoneCreateExpense: vi.fn(),
    softoneLoadExpenseTemplate: vi.fn(),
  },
  audit: { logAudit: vi.fn() },
  // Read-only SoftOne lookups: ΔΕΝ μπαίνουν στο `s1` (το `expectNoWrites` απαιτεί
  // ότι κανένα από εκείνα δεν κλήθηκε — μια ανάγνωση όμως επιτρέπεται στο dry-run).
  s1read: { softoneFetchCountries: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/bunny', () => ({ bunnyDelete: vi.fn() }));
vi.mock('@/lib/rbac', () => rbac);
vi.mock('@/lib/audit', () => audit);
// Οι καθαροί payload builders μένουν ΑΛΗΘΙΝΟΙ (το dry-run τους επιστρέφει αυτούσιους)·
// μόνο ό,τι μιλάει στο δίκτυο αντικαθίσταται.
vi.mock('@/lib/softone', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/softone')>()),
  ...s1,
  ...s1read,
}));

import { POST as createTrader } from '@/app/api/admin/ocr/new-traders/[afm]/create/route';
import { POST as linkTrader } from '@/app/api/admin/ocr/new-traders/[afm]/link/route';
import { POST as ignoreTrader, DELETE as unignoreTrader } from '@/app/api/admin/ocr/new-traders/[afm]/ignore/route';
import { POST as createItem } from '@/app/api/admin/ocr/new-items/create/route';
import { GET as itemQueue } from '@/app/api/admin/ocr/new-items/route';
import { PATCH as patchDoc } from '@/app/api/admin/ocr/[id]/route';

const USER = { id: 'u1', email: 'a@b.gr' };
const AFM = '094073495';
const post = (body: unknown) =>
  new Request('http://localhost/api', { method: 'POST', body: JSON.stringify(body) });
const ctx = (afm: string) => ({ params: Promise.resolve({ afm }) });

/** Καμία εγγραφή πουθενά: ούτε SoftOne, ούτε βάση, ούτε audit. */
function expectNoWrites() {
  for (const fn of Object.values(s1)) expect(fn).not.toHaveBeenCalled();
  expect(db.softoneTrader.upsert).not.toHaveBeenCalled();
  expect(db.softoneItem.upsert).not.toHaveBeenCalled();
  expect(db.softoneExpense.upsert).not.toHaveBeenCalled();
  expect(db.ocrDocument.updateMany).not.toHaveBeenCalled();
  expect(db.ocrInvoiceItem.updateMany).not.toHaveBeenCalled();
  expect(db.lineMatchRule.upsert).not.toHaveBeenCalled();
  expect(audit.logAudit).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  rbac.requirePermission.mockResolvedValue(USER);
  audit.logAudit.mockResolvedValue(undefined);
  db.ocrDocument.findMany.mockResolvedValue([]);
  // Οι δοκιμές δεν χρειάζονται πραγματική συναλλαγή: εκτελούμε ό,τι μας δοθεί.
  db.$transaction.mockImplementation((ops: unknown) => Promise.resolve(ops));
  db.ocrDocument.updateMany.mockResolvedValue({ count: 0 });
  db.ocrDocument.groupBy.mockResolvedValue([]);
  db.ocrInvoiceItem.findMany.mockResolvedValue([]);
  db.ocrInvoiceItem.count.mockResolvedValue(0);
  db.ignoredIssuer.findMany.mockResolvedValue([]);
  db.lineMatchRule.findMany.mockResolvedValue([]);
  s1.softoneLoadExpenseTemplate.mockResolvedValue({ flags: { CLCMD: 1 }, expn: 7 });
  db.ocrDocument.findUnique.mockResolvedValue(null);
  db.ocrDocument.update.mockResolvedValue({ id: 'doc1' });
  db.purchaseDocType.findFirst.mockResolvedValue(null);
  db.purchaseDocType.findUnique.mockResolvedValue(null);
  db.softoneDocSeries.findFirst.mockResolvedValue(null);
  // Μητρώο χωρών SoftOne: μόνο όσα χρειάζονται οι δοκιμές (COUNTRY.COUNTRY = id).
  s1read.softoneFetchCountries.mockResolvedValue([
    { id: '1000', shortcut: 'GR', name: 'ΕΛΛΑΔΑ', intcode: 'GR', intercode: 'GR' },
    { id: '1012', shortcut: 'CY', name: 'ΚΥΠΡΟΣ', intcode: 'CY', intercode: 'CY' },
  ]);
});

describe('dry-run', () => {
  it('«νέος συναλλασσόμενος»: επιστρέφει το setData χωρίς καμία εγγραφή', async () => {
    const res = await createTrader(
      post({ kind: 'supplier', name: 'ΑΛΦΑ ΑΕ', phone: '2101234567', email: 'a@b.gr', dryRun: true }),
      ctx(AFM),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.dryRun).toBe(true);
    expect(body.payload.service).toBe('setData');
    expect(body.payload.OBJECT).toBe('SUPPLIER');
    // Το τηλέφωνο/email περνούν πράγματι στο payload (PHONE01/EMAIL).
    expect(body.payload.DATA.SUPPLIER[0]).toMatchObject({
      NAME: 'ΑΛΦΑ ΑΕ', AFM: AFM, PHONE01: '2101234567', EMAIL: 'a@b.gr',
    });
    expectNoWrites();
  });

  it('«νέο έξοδο»: διαβάζει μόνο το πρότυπο, δεν δημιουργεί τίποτα', async () => {
    const res = await createItem(post({
      afm: AFM, pattern: 'μισθωμα φιαλων', kind: 'expense',
      code: 'ΕΞ42', name: 'Μισθώματα', dryRun: true,
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.dryRun).toBe(true);
    expect(body.payload.OBJECT).toBe('EXPENSES');
    expect(body.templateExpn).toBe(7);
    expect(s1.softoneCreateExpense).not.toHaveBeenCalled();
    expect(s1.softoneCreateItem).not.toHaveBeenCalled();
    expect(db.softoneExpense.upsert).not.toHaveBeenCalled();
    expect(db.ocrInvoiceItem.updateMany).not.toHaveBeenCalled();
    expect(db.lineMatchRule.upsert).not.toHaveBeenCalled();
    expect(audit.logAudit).not.toHaveBeenCalled();
  });

  it('«νέο είδος»: επιστρέφει το setData χωρίς καμία εγγραφή', async () => {
    const res = await createItem(post({
      afm: AFM, pattern: 'υγρο αζωτο kg', kind: 'product',
      code: '76-71106', name: 'ΥΓΡΟ ΑΖΩΤΟ', vat: '1300', unit: '101', dryRun: true,
    }));
    const body = await res.json();

    expect(body.dryRun).toBe(true);
    expect(body.payload.OBJECT).toBe('ITEM');
    expectNoWrites();
  });
});

describe('ξένος εκδότης', () => {
  const CY = 'CY10123456A';

  it('το ΑΦΜ με πρόθεμα χώρας γίνεται δεκτό και φεύγει αυτούσιο στο SoftOne', async () => {
    const res = await createTrader(post({ kind: 'supplier', name: 'ALPHA LTD', dryRun: true }), ctx(CY));
    const body = await res.json();

    expect(res.status).toBe(200);
    // Το πρόθεμα ΔΕΝ κόβεται: είναι μέρος της ταυτότητας του ξένου εκδότη.
    expect(body.payload.DATA.SUPPLIER[0].AFM).toBe(CY);
    // Η χώρα βγαίνει από το ίδιο το ΑΦΜ και γίνεται αριθμητικό FK COUNTRY.
    expect(body.payload.DATA.SUPPLIER[0].COUNTRY).toBe(1012);
    expect(body.warnings).toEqual([]);
    expectNoWrites();
  });

  it('ελληνικός εκδότης παίρνει COUNTRY Ελλάδας χωρίς να το ζητήσει κανείς', async () => {
    const res = await createTrader(post({ kind: 'supplier', name: 'ΑΛΦΑ ΑΕ', dryRun: true }), ctx(AFM));
    expect((await res.json()).payload.DATA.SUPPLIER[0].COUNTRY).toBe(1000);
  });

  it('χώρα εκτός μητρώου: το πεδίο παραλείπεται και επιστρέφεται warning', async () => {
    const res = await createTrader(
      post({ kind: 'supplier', name: 'MUSTER GMBH', country: 'DE', dryRun: true }),
      ctx('DE144960040'),
    );
    const body = await res.json();
    expect(body.payload.DATA.SUPPLIER[0]).not.toHaveProperty('COUNTRY');
    expect(body.warnings).toEqual(['country_not_found']);
    expectNoWrites();
  });

  it('χώρα από τη διεύθυνση: το γυμνό ΑΦΜ παίρνει πρόθεμα σε SoftOne ΚΑΙ στα έγγραφα', async () => {
    s1.softoneCreateSupplier.mockResolvedValue({ trdr: 7001, code: 'Π.0007' });
    db.ocrDocument.findMany.mockResolvedValue([{ id: 'd1' }, { id: 'd2' }]);
    // Το ΑΦΜ γράφεται μέσα από το ΚΑΝΟΝΙΚΟ έγγραφο, οπότε κάθε έγγραφο διαβάζεται πρώτα.
    db.ocrDocument.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => (
      where.id === 'd1'
        ? { document: null, extractedData: { vatNumber: '144960040', companyName: 'MUSTER GMBH' }, docType: 'INVOICE' }
        : { document: null, extractedData: null, docType: 'INVOICE' }
    ));
    db.softoneTrader.upsert.mockResolvedValue({});

    const res = await createTrader(
      post({ kind: 'supplier', name: 'MUSTER GMBH', country: 'DE' }),
      ctx('144960040'),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, afm: 'DE144960040', docsUpdated: 2 });
    // SoftOne παίρνει το προθεματισμένο ΑΦΜ…
    expect(s1.softoneCreateSupplier.mock.calls[0][0]).toMatchObject({ afm: 'DE144960040' });
    // …και τα έγγραφα ξαναγράφονται — ένα transaction ανά έγγραφο, με το έγγραφο και τα
    // παράγωγά του (`extractedData`, `issuerAfm`) να γράφονται μαζί.
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    const d1 = db.ocrDocument.update.mock.calls.find((c) => c[0].where.id === 'd1')?.[0];
    expect(d1.data.issuerAfm).toBe('DE144960040');
    expect((d1.data.document as { issuer: { vat: string; name: string } }).issuer)
      .toMatchObject({ vat: 'DE144960040', name: 'MUSTER GMBH' });
    expect(d1.data.extractedData).toMatchObject({ vatNumber: 'DE144960040', companyName: 'MUSTER GMBH' });
    expect(d1.data).toMatchObject({ softoneTrdr: 7001, softoneCode: 'Π.0007' });
    // Έγγραφο χωρίς extractedData δεν σκάει — παίρνει το ΑΦΜ και τίποτα άλλο.
    const d2 = db.ocrDocument.update.mock.calls.find((c) => c[0].where.id === 'd2')?.[0];
    expect(d2.data.issuerAfm).toBe('DE144960040');
    expect(d2.data.extractedData).toMatchObject({ vatNumber: 'DE144960040' });
    expect(db.ocrDocument.updateMany).not.toHaveBeenCalled();
  });

  it('ελληνικός εκδότης ΔΕΝ παίρνει ποτέ πρόθεμα — ένα updateMany, καμία JSON εγγραφή', async () => {
    s1.softoneCreateSupplier.mockResolvedValue({ trdr: 7002, code: 'Π.0008' });
    db.ocrDocument.updateMany.mockResolvedValue({ count: 4 });
    db.softoneTrader.upsert.mockResolvedValue({});

    const res = await createTrader(post({ kind: 'supplier', name: 'ΑΛΦΑ ΑΕ', country: 'GR' }), ctx(AFM));

    expect(await res.json()).toMatchObject({ ok: true, afm: AFM, docsUpdated: 4 });
    expect(s1.softoneCreateSupplier.mock.calls[0][0]).toMatchObject({ afm: AFM });
    expect(db.ocrDocument.updateMany).toHaveBeenCalledTimes(1);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('«Είναι υπάρχων…» με χώρα: το κλειδί των εγγράφων διορθώνεται κι εκεί', async () => {
    db.softoneTrader.findUnique.mockResolvedValue({
      trdr: 8001, code: 'Π.1', name: 'MUSTER GMBH', kind: 'Προμηθευτής', sodtype: 12,
    });
    db.ocrDocument.findMany.mockResolvedValue([{ id: 'd9' }]);
    db.ocrDocument.findUnique.mockResolvedValue({
      document: null, extractedData: { vatNumber: '144960040' }, docType: 'INVOICE',
    });

    const res = await linkTrader(post({ trdr: 8001, country: 'DE' }), ctx('144960040'));

    expect(await res.json()).toMatchObject({ ok: true, afm: 'DE144960040', docsUpdated: 1 });
    const write = db.ocrDocument.update.mock.calls.at(-1)?.[0];
    expect(write.data.issuerAfm).toBe('DE144960040');
    expect((write.data.document as { issuer: { vat: string } }).issuer.vat).toBe('DE144960040');
  });

  it.each(['ZZ12345678', 'EL094073495', 'C1234567890'])('άγνωστο πρόθεμα %j → 400', async (afm) => {
    const res = await createTrader(post({ kind: 'supplier', name: 'X' }), ctx(afm));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_afm');
    expectNoWrites();
  });
});

describe('link — SODTYPE', () => {
  it('δέχεται προμηθευτή (12) και πιστωτή (16)', async () => {
    db.ocrDocument.updateMany.mockResolvedValue({ count: 3 });
    for (const sodtype of [12, 16]) {
      vi.clearAllMocks();
      rbac.requirePermission.mockResolvedValue(USER);
      audit.logAudit.mockResolvedValue(undefined);
      db.ocrDocument.updateMany.mockResolvedValue({ count: 3 });
      db.softoneTrader.findUnique.mockResolvedValue({
        trdr: 5001, code: 'Π.0001', name: 'ΑΛΦΑ ΑΕ', kind: 'Προμηθευτής', sodtype,
      });

      const res = await linkTrader(post({ trdr: 5001 }), ctx(AFM));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, trdr: 5001, docsUpdated: 3 });
    }
  });

  it.each([13, 14, 15])('απορρίπτει SODTYPE %i με 422 invalid_sodtype', async (sodtype) => {
    db.softoneTrader.findUnique.mockResolvedValue({
      trdr: 6001, code: 'Π.1', name: 'ΒΗΤΑ', kind: 'Πελάτης', sodtype,
    });

    const res = await linkTrader(post({ trdr: 6001 }), ctx(AFM));

    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('invalid_sodtype');
    expect(db.ocrDocument.updateMany).not.toHaveBeenCalled();
  });

  it('άγνωστος συναλλασσόμενος → 404', async () => {
    db.softoneTrader.findUnique.mockResolvedValue(null);
    const res = await linkTrader(post({ trdr: 1 }), ctx(AFM));
    expect(res.status).toBe(404);
    expect(db.ocrDocument.updateMany).not.toHaveBeenCalled();
  });
});

describe('invalid_afm', () => {
  // Ό,τι δεν είναι 8–12 ψηφία: γράμματα, κενά, πολύ κοντό/μακρύ, path tricks.
  const BAD = ['abc', 'EL094073495', '1234567', '1234567890123', '', '09407349x', '094073495/../x', '0940 73495'];

  it.each(BAD)('create(%j) → 400', async (afm) => {
    const res = await createTrader(post({ kind: 'supplier', name: 'ΑΛΦΑ' }), ctx(afm));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_afm');
    expectNoWrites();
  });

  it.each(BAD)('link(%j) → 400', async (afm) => {
    const res = await linkTrader(post({ trdr: 1 }), ctx(afm));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_afm');
    expect(db.softoneTrader.findUnique).not.toHaveBeenCalled();
  });

  it.each(BAD)('ignore(%j) → 400 (POST και DELETE)', async (afm) => {
    const p = await ignoreTrader(post({}), ctx(afm));
    expect(p.status).toBe(400);
    expect((await p.json()).error).toBe('invalid_afm');
    const d = await unignoreTrader(new Request('http://localhost/api', { method: 'DELETE' }), ctx(afm));
    expect(d.status).toBe(400);
    expect((await d.json()).error).toBe('invalid_afm');
    expect(db.ignoredIssuer.upsert).not.toHaveBeenCalled();
    expect(db.ignoredIssuer.delete).not.toHaveBeenCalled();
  });

  it('έγκυρο ΑΦΜ περνάει τον φύλακα (τα περιμετρικά κενά κόβονται)', async () => {
    db.ignoredIssuer.upsert.mockResolvedValue({});
    for (const afm of [AFM, ` ${AFM} `]) {
      db.ignoredIssuer.upsert.mockClear();
      const res = await ignoreTrader(post({ reason: 'χειρόγραφο' }), ctx(afm));
      expect(res.status).toBe(200);
      expect(db.ignoredIssuer.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { afm: AFM } }));
    }
  });
});

describe('permissions', () => {
  // Ο πραγματικός `requirePermission` κάνει redirect (πετάει) — ο φύλακας πρέπει να σκάει
  // ΠΡΙΝ διαβαστεί το σώμα και πριν αγγίξουμε SoftOne ή βάση.
  const denied = () => {
    const e = new Error('NEXT_REDIRECT');
    rbac.requirePermission.mockRejectedValue(e);
    return e;
  };

  it('create χωρίς δικαίωμα: το σφάλμα του rbac βγαίνει ως έχει', async () => {
    const e = denied();
    await expect(createTrader(post({ kind: 'supplier', name: 'ΑΛΦΑ' }), ctx(AFM))).rejects.toBe(e);
    expectNoWrites();
  });

  it('link χωρίς δικαίωμα', async () => {
    const e = denied();
    await expect(linkTrader(post({ trdr: 1 }), ctx(AFM))).rejects.toBe(e);
    expect(db.softoneTrader.findUnique).not.toHaveBeenCalled();
  });

  it('ignore χωρίς δικαίωμα', async () => {
    const e = denied();
    await expect(ignoreTrader(post({}), ctx(AFM))).rejects.toBe(e);
    expect(db.ignoredIssuer.upsert).not.toHaveBeenCalled();
  });

  it('δημιουργία είδους χωρίς δικαίωμα', async () => {
    const e = denied();
    await expect(createItem(post({ afm: '', pattern: 'x', kind: 'expense', code: 'Α', name: 'Β' }))).rejects.toBe(e);
    expectNoWrites();
  });

  it('ανάγνωση ουράς χωρίς δικαίωμα', async () => {
    const e = denied();
    await expect(itemQueue(new Request('http://localhost/api'))).rejects.toBe(e);
    expect(db.ocrInvoiceItem.findMany).not.toHaveBeenCalled();
  });
});


/**
 * PATCH καρτέλας: η «χειροκίνητη» σφραγίδα σειράς (`seriesBy: 'manual'`) κλειδώνει το
 * έγγραφο έξω από τον αυτόματο ταξινομητή — άρα πρέπει να μπαίνει ΜΟΝΟ όταν το ζεύγος
 * (ενότητα, κωδικός) όντως άλλαξε, όχι σε κάθε αποθήκευση της καρτέλας.
 */
describe('PATCH σειρά παραστατικού', () => {
  const DOC = 'doc1';
  const patch = (body: unknown) =>
    patchDoc(new Request('http://localhost/api', { method: 'PATCH', body: JSON.stringify(body) }), {
      params: Promise.resolve({ id: DOC }),
    });
  /** Ό,τι γράφτηκε τελικά στο `ocrDocument.update`. */
  const written = () => db.ocrDocument.update.mock.calls[0]?.[0]?.data ?? {};

  it('ίδιο ζεύγος: καμία σφραγίδα «manual», ούτε καν έλεγχος ενεργοποίησης', async () => {
    db.ocrDocument.findUnique.mockResolvedValue({ softoneSeries: '7021', seriesSource: 1251 });

    const res = await patch({ softoneSeries: '7021', seriesSource: 1251, category: 'EXPENSE' });

    expect(res.status).toBe(200);
    expect(written()).not.toHaveProperty('seriesBy');
    expect(written()).not.toHaveProperty('seriesConfidence');
    expect(written()).not.toHaveProperty('seriesReason');
    expect(written()).toMatchObject({ category: 'EXPENSE' });
    // Ο έλεγχος «ενεργοποιημένης σειράς» ούτε τρέχει.
    expect(db.purchaseDocType.findFirst).not.toHaveBeenCalled();
    expect(db.softoneDocSeries.findFirst).not.toHaveBeenCalled();
  });

  it('ίδιο ζεύγος με σειρά που απενεργοποιήθηκε: σώζεται κανονικά (όχι 422)', async () => {
    db.ocrDocument.findUnique.mockResolvedValue({ softoneSeries: '7021', seriesSource: 1251 });
    // Καμία ενεργοποιημένη γραμμή στο μητρώο — παλιά θα έσκαγε με `unknown_series`.
    db.purchaseDocType.findFirst.mockResolvedValue(null);

    const res = await patch({ softoneSeries: '7021', seriesSource: 1251, notes: 'διόρθωση συνόλου' });

    expect(res.status).toBe(200);
    expect(written()).not.toHaveProperty('seriesBy');
  });

  it('αλλαγή ζεύγους: σφραγίζεται «manual» αφού περάσει ο έλεγχος', async () => {
    db.ocrDocument.findUnique.mockResolvedValue({ softoneSeries: '7021', seriesSource: 1251 });
    db.softoneDocSeries.findFirst.mockResolvedValue({ id: 9 });

    const res = await patch({ softoneSeries: '7021', seriesSource: 1653 });

    expect(res.status).toBe(200);
    expect(db.softoneDocSeries.findFirst).toHaveBeenCalled();
    expect(written()).toMatchObject({
      seriesBy: 'manual', seriesConfidence: 1, seriesReason: 'χειροκίνητη επιλογή', seriesSource: 1653,
    });
  });

  it('αλλαγή ζεύγους σε ανενεργή σειρά → 422 unknown_series, καμία εγγραφή', async () => {
    db.ocrDocument.findUnique.mockResolvedValue({ softoneSeries: '7021', seriesSource: 1251 });
    db.purchaseDocType.findFirst.mockResolvedValue(null);

    const res = await patch({ softoneSeries: '7030', seriesSource: 1251 });

    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('unknown_series');
    expect(db.ocrDocument.update).not.toHaveBeenCalled();
  });

  it('καθάρισμα σειράς: ξεκλειδώνει (όλα τα series πεδία null)', async () => {
    db.ocrDocument.findUnique.mockResolvedValue({ softoneSeries: '7021', seriesSource: 1251 });

    const res = await patch({ softoneSeries: null, seriesSource: null });

    expect(res.status).toBe(200);
    expect(written()).toMatchObject({
      seriesBy: null, seriesConfidence: null, seriesReason: null, seriesSource: null,
    });
  });

  it('ήδη κενή σειρά + αποθήκευση χωρίς αλλαγή: κανένα series πεδίο στο update', async () => {
    db.ocrDocument.findUnique.mockResolvedValue({ softoneSeries: null, seriesSource: null });

    const res = await patch({ softoneSeries: null, seriesSource: null, category: 'EXPENSE' });

    expect(res.status).toBe(200);
    expect(written()).not.toHaveProperty('seriesBy');
    expect(written()).not.toHaveProperty('seriesSource');
  });

  it('χωρίς `softoneSeries` στο σώμα: η σειρά δεν αγγίζεται καθόλου', async () => {
    const res = await patch({ category: 'EXPENSE' });

    expect(res.status).toBe(200);
    expect(db.ocrDocument.findUnique).toHaveBeenCalledTimes(1); // μόνο το τελικό re-read
    expect(written()).not.toHaveProperty('seriesBy');
  });
});
