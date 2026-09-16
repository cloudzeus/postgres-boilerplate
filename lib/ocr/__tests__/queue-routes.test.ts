// lib/ocr/__tests__/queue-routes.test.ts
// Τα routes των δύο ουρών (spec 2026-09-11 §2/§3) καλούνται ΑΠΕΥΘΕΙΑΣ ως handlers, με
// mocked rbac / prisma / SoftOne / audit. Εδώ ελέγχουμε ό,τι δεν πιάνει το `lib/ocr/queues.ts`:
// τους φύλακες (permission, ΑΦΜ, SODTYPE) και ότι το dry-run δεν γράφει ΠΟΥΘΕΝΑ.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { db, rbac, s1, audit, s1read, settings } = vi.hoisted(() => ({
  db: {
    ocrDocument: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn(), groupBy: vi.fn() },
    purchaseDocType: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    softoneDocSeries: { findFirst: vi.fn(), findMany: vi.fn() },
    ocrInvoiceItem: { findMany: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    ignoredIssuer: { findMany: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
    softoneTrader: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn() },
    softoneItem: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
    softoneExpense: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
    softoneLineItem: { findMany: vi.fn(), findUnique: vi.fn() },
    softoneLookup: { findMany: vi.fn(), upsert: vi.fn() },
    vatCategory: { findUnique: vi.fn(), findMany: vi.fn() },
    lineMatchRule: { findMany: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(),
  },
  rbac: { requirePermission: vi.fn() },
  s1: {
    softoneCreateTrader: vi.fn(),
    softoneCreateItem: vi.fn(),
    softoneCreateExpense: vi.fn(),
    softoneLoadExpenseTemplate: vi.fn(),
  },
  audit: { logAudit: vi.fn() },
  // Read-only SoftOne lookups: ΔΕΝ μπαίνουν στο `s1` (το `expectNoWrites` απαιτεί
  // ότι κανένα από εκείνα δεν κλήθηκε — μια ανάγνωση όμως επιτρέπεται στο dry-run).
  s1read: {
    softoneFetchCountries: vi.fn(),
    softoneNextTraderCode: vi.fn(),
    clearTraderCodeCache: vi.fn(),
    softoneNextItemCode: vi.fn(),
    clearItemCodeCache: vi.fn(),
  },
  settings: { getSetting: vi.fn(), setSetting: vi.fn() },
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
vi.mock('@/lib/settings', () => settings);

import { POST as createTrader } from '@/app/api/admin/ocr/new-traders/[afm]/create/route';
import { POST as linkTrader } from '@/app/api/admin/ocr/new-traders/[afm]/link/route';
import { POST as ignoreTrader, DELETE as unignoreTrader } from '@/app/api/admin/ocr/new-traders/[afm]/ignore/route';
import { GET as nextCode } from '@/app/api/admin/ocr/new-traders/next-code/route';
import { GET as nextItemCode } from '@/app/api/admin/ocr/new-items/next-code/route';
import { POST as createItem } from '@/app/api/admin/ocr/new-items/create/route';
import { GET as itemQueue } from '@/app/api/admin/ocr/new-items/route';
import { PATCH as patchDoc } from '@/app/api/admin/ocr/[id]/route';

const USER = { id: 'u1', email: 'a@b.gr' };
const AFM = '094073495';
const post = (body: unknown) =>
  new Request('http://localhost/api', { method: 'POST', body: JSON.stringify(body) });
const ctx = (afm: string) => ({ params: Promise.resolve({ afm }) });

/**
 * Εκκρεμή έγγραφα του ΑΦΜ **χωρίς αναγνωρισμένη σειρά**: εκεί δεν υπάρχει πληροφορία για τον
 * απαιτούμενο τύπο καρτέλας, οπότε γράφεται η καρτέλα που έδωσε ο χρήστης (δες `applyTraderToDocs`).
 */
const pendingDocs = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `d${i + 1}`, seriesSource: null, softoneSeries: null }));

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
  db.purchaseDocType.findMany.mockResolvedValue([]);
  db.softoneDocSeries.findFirst.mockResolvedValue(null);
  db.softoneDocSeries.findMany.mockResolvedValue([]);
  // Μητρώο χωρών SoftOne: μόνο όσα χρειάζονται οι δοκιμές (COUNTRY.COUNTRY = id).
  settings.getSetting.mockResolvedValue('');
  db.softoneTrader.findMany.mockResolvedValue([]);
  db.softoneLineItem.findMany.mockResolvedValue([]);
  db.softoneLookup.findMany.mockResolvedValue([]);
  db.softoneLookup.upsert.mockResolvedValue({});
  // Το ποσοστό ΦΠΑ βγαίνει από το ΜΗΤΡΩΟ, όχι από τον client: από εκεί υπολογίζεται η λιανική.
  db.vatCategory.findUnique.mockResolvedValue({ rate: 24 });
  s1read.softoneNextTraderCode.mockResolvedValue({ code: '53-00002', source: 'pattern', taken: 1, stale: false });
  s1read.softoneNextItemCode.mockResolvedValue({
    code: '00042', source: 'pattern', taken: 41, stale: false, supplierCodeTaken: false, supplierCode: null,
  });
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

  it('«νέος ΧΡΕΩΣΤΗΣ»: dry-run στο object DEBTOR, χωρίς καμία εγγραφή', async () => {
    const res = await createTrader(
      post({ kind: 'debtor', name: 'ΑΛΦΑ ΑΕ', phone: '2101234567', dryRun: true }),
      ctx(AFM),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.dryRun).toBe(true);
    expect(body.payload.service).toBe('setData');
    expect(body.payload.OBJECT).toBe('DEBTOR');
    expect(body.payload.DATA.DEBTOR[0]).toMatchObject({ NAME: 'ΑΛΦΑ ΑΕ', AFM, PHONE01: '2101234567' });
    // Το SODTYPE (15) το βάζει το ίδιο το object — δεν το στέλνουμε ποτέ.
    expect(body.payload.DATA.DEBTOR[0]).not.toHaveProperty('SODTYPE');
    expectNoWrites();
  });

  it('«νέος ΧΡΕΩΣΤΗΣ»: αληθινή δημιουργία → object DEBTOR, ετικέτα «Χρεώστης» στα έγγραφα', async () => {
    s1.softoneCreateTrader.mockResolvedValue({ trdr: 9001, code: 'Χ.0001' });
    // Δύο εκκρεμή έγγραφα χωρίς αναγνωρισμένη σειρά ⇒ παίρνουν την καρτέλα που έδωσε ο χρήστης.
    db.ocrDocument.findMany.mockResolvedValue(pendingDocs(2));
    db.ocrDocument.updateMany.mockResolvedValue({ count: 2 });
    db.softoneTrader.upsert.mockResolvedValue({});

    const res = await createTrader(post({ kind: 'debtor', name: 'ΑΛΦΑ ΑΕ', country: 'GR' }), ctx(AFM));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, trdr: 9001, code: 'Χ.0001', kind: 'Χρεώστης', docsUpdated: 2 });
    expect(s1.softoneCreateTrader.mock.calls[0][0]).toBe('debtor');
    // Ο καθρέφτης κρατά SODTYPE 15, ώστε η αναζήτηση/σύνδεση να τον βρίσκει αμέσως.
    expect(db.softoneTrader.upsert.mock.calls[0][0].create).toMatchObject({ trdr: 9001, sodtype: 15, kind: 'Χρεώστης' });
    expect(db.ocrDocument.updateMany.mock.calls[0][0].data).toMatchObject({ softoneTrdr: 9001, softoneKind: 'Χρεώστης' });
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

  /**
   * Η τιμή μιας γραμμής τιμολογίου ΑΓΟΡΑΣ είναι κόστος: πάει στο `PRICEW` («Χονδρικής»). Το
   * `PRICER` («Λιανικής») δεν το υπολογίζει ο ERP (`calculated: false`), οπότε το βγάζουμε εμείς
   * από το ΦΠΑ που διάλεξε ο χρήστης — και το ποσοστό το διαβάζουμε από το μητρώο, όχι από τον client.
   */
  it('η τιμή γράφεται ως PRICEW και η λιανική υπολογίζεται από το ΦΠΑ του μητρώου', async () => {
    db.vatCategory.findUnique.mockResolvedValue({ rate: 24 });
    const res = await createItem(post({
      afm: AFM, pattern: 'υγρο αζωτο kg', kind: 'product',
      code: '76-71106', name: 'ΥΓΡΟ ΑΖΩΤΟ', vat: '1300', unit: '101', price: 10, dryRun: true,
    }));
    const row = (await res.json()).payload.DATA.ITEM[0];

    expect(row.PRICEW).toBe(10);
    expect(row.PRICER).toBe(12.4);
    expect(db.vatCategory.findUnique.mock.calls[0][0].where).toEqual({ code: '1300' });
    expectNoWrites();
  });

  it('κατηγορία ΦΠΑ χωρίς ποσοστό ⇒ καμία λιανική, μόνο χονδρική', async () => {
    db.vatCategory.findUnique.mockResolvedValue({ rate: null });
    const res = await createItem(post({
      afm: AFM, pattern: 'x', kind: 'service',
      code: 'Y-1', name: 'ΥΠΗΡΕΣΙΑ', vat: '1400', unit: '101', price: 10, dryRun: true,
    }));
    const row = (await res.json()).payload.DATA.ITEM[0];

    expect(row.PRICEW).toBe(10);
    expect(row).not.toHaveProperty('PRICER');
    expectNoWrites();
  });

  it('ομάδα και εμπορική κατηγορία περνούν ως MTRGROUP / MTRCATEGORY', async () => {
    const res = await createItem(post({
      afm: AFM, pattern: 'x', kind: 'product',
      code: 'A-1', name: 'X', vat: '1300', unit: '101', group: '7', category: '12', dryRun: true,
    }));
    const row = (await res.json()).payload.DATA.ITEM[0];

    expect(row.MTRGROUP).toBe('7');
    expect(row.MTRCATEGORY).toBe('12');
    expectNoWrites();
  });
});

describe('συντεταγμένες → SoftOne', () => {
  it('περνούν ως LATITUDE/LONGITUDE στο setData (και φαίνονται στο dry-run)', async () => {
    const res = await createTrader(
      post({ kind: 'supplier', name: 'ΑΛΦΑ ΑΕ', latitude: 37.9755, longitude: 23.7348, dryRun: true }),
      ctx(AFM),
    );
    expect((await res.json()).payload.DATA.SUPPLIER[0])
      .toMatchObject({ LATITUDE: 37.9755, LONGITUDE: 23.7348 });
    expectNoWrites();
  });

  it('χωρίς συντεταγμένες τα δύο πεδία ΛΕΙΠΟΥΝ — η δημιουργία δεν μπλοκάρει', async () => {
    const res = await createTrader(post({ kind: 'supplier', name: 'ΑΛΦΑ ΑΕ', dryRun: true }), ctx(AFM));
    const r = (await res.json()).payload.DATA.SUPPLIER[0];
    expect(r).not.toHaveProperty('LATITUDE');
    expect(r).not.toHaveProperty('LONGITUDE');
  });

  it('εκτός ορίων → 400 στο ίδιο το body, χωρίς να φτάσει στο SoftOne', async () => {
    const res = await createTrader(
      post({ kind: 'supplier', name: 'ΑΛΦΑ ΑΕ', latitude: 137.9, longitude: 23.7 }),
      ctx(AFM),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_body');
    expectNoWrites();
  });
});

describe('επόμενος ελεύθερος κωδικός', () => {
  it('GET next-code επιστρέφει την πρόταση για τον ζητούμενο τύπο', async () => {
    const res = await nextCode(new Request('http://localhost/api?kind=creditor'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ kind: 'creditor', code: '53-00002', source: 'pattern' });
    // Ο τύπος περνά αυτούσιος: ένας πιστωτής δεν παίρνει την αρίθμηση των προμηθευτών.
    expect(s1read.softoneNextTraderCode.mock.calls[0][0]).toBe('creditor');
  });

  it('η μάσκα των ρυθμίσεων φτάνει στη λογική πρότασης', async () => {
    settings.getSetting.mockResolvedValue('53-00001');
    await nextCode(new Request('http://localhost/api?kind=debtor'));
    expect(s1read.softoneNextTraderCode.mock.calls[0][1]).toMatchObject({ mask: '53-00001' });
  });

  it('άγνωστος τύπος → 400 χωρίς να ρωτηθεί το SoftOne', async () => {
    const res = await nextCode(new Request('http://localhost/api?kind=customer'));
    expect(res.status).toBe(400);
    expect(s1read.softoneNextTraderCode).not.toHaveBeenCalled();
  });
});

describe('το SoftOne απαιτεί «Κωδικό»', () => {
  it('γίνεται 422 code_required με το ΑΥΤΟΥΣΙΟ μήνυμα του ERP, όχι γενικό 502', async () => {
    const message = "Δεν έχετε συμπληρώσει το πεδίο 'Κωδικός'";
    s1.softoneCreateTrader.mockRejectedValue(new Error(message));
    const res = await createTrader(post({ kind: 'creditor', name: 'ΑΛΦΑ ΑΕ' }), ctx(AFM));

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      error: 'code_required', field: 'code', kind: 'creditor', message, suggestion: '53-00002',
    });
    // Τίποτα δεν δημιουργήθηκε: ο καθρέφτης και τα έγγραφα μένουν ανέγγιχτα.
    expect(db.softoneTrader.upsert).not.toHaveBeenCalled();
    expect(db.ocrDocument.updateMany).not.toHaveBeenCalled();
  });

  it('κωδικός που πιάστηκε στο μεσοδιάστημα → 409 με ΝΕΑ πρόταση, ΚΑΜΙΑ επανάληψη', async () => {
    const message = 'Ο κωδικός 53-00002 υπάρχει ήδη';
    s1.softoneCreateTrader.mockRejectedValue(new Error(message));
    s1read.softoneNextTraderCode.mockResolvedValue({ code: '53-00003', source: 'pattern', taken: 2, stale: false });

    const res = await createTrader(post({ kind: 'creditor', name: 'ΑΛΦΑ ΑΕ', code: '53-00002' }), ctx(AFM));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'code_taken', field: 'code', message, suggestion: '53-00003' });
    // ΜΙΑ και μόνη προσπάθεια δημιουργίας — ποτέ δεύτερη «στα τυφλά».
    expect(s1.softoneCreateTrader).toHaveBeenCalledTimes(1);
    expect(db.softoneTrader.upsert).not.toHaveBeenCalled();
  });

  it('κάθε άλλο σφάλμα SoftOne παραμένει 502 softone_error', async () => {
    s1.softoneCreateTrader.mockRejectedValue(new Error('Η εγγραφή δεν επιβεβαιώθηκε στο SoftOne'));
    const res = await createTrader(post({ kind: 'supplier', name: 'ΑΛΦΑ ΑΕ' }), ctx(AFM));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('softone_error');
  });
});

/**
 * Ο κωδικός ΕΙΔΟΥΣ ακολουθεί τον ίδιο δρόμο με τον κωδικό συναλλασσομένου: πρόταση από τον
 * server (δύο κανόνες), 409 με ΝΕΑ πρόταση όταν πιαστεί στο μεσοδιάστημα, καμία επανάληψη.
 */
describe('προτεινόμενος κωδικός είδους', () => {
  it('GET next-code περνά μητρώο, μάσκα και κωδικό γραμμής στη λογική πρότασης', async () => {
    settings.getSetting.mockResolvedValue('ΥΠ-0001');
    const res = await nextItemCode(new Request('http://localhost/api?kind=service&supplierCode=ABC-9'));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ kind: 'service', code: '00042', source: 'pattern' });
    expect(s1read.softoneNextItemCode.mock.calls[0][0]).toBe('service');
    expect(s1read.softoneNextItemCode.mock.calls[0][1]).toMatchObject({ mask: 'ΥΠ-0001', supplierCode: 'ABC-9' });
  });

  it('άγνωστο μητρώο → 400 χωρίς να ρωτηθεί το SoftOne', async () => {
    const res = await nextItemCode(new Request('http://localhost/api?kind=trader'));
    expect(res.status).toBe(400);
    expect(s1read.softoneNextItemCode).not.toHaveBeenCalled();
  });

  it('κωδικός είδους που πιάστηκε → 409 με ΝΕΑ πρόταση, καμία δεύτερη δημιουργία', async () => {
    const message = 'Ο κωδικός 00042 υπάρχει ήδη';
    s1.softoneCreateItem.mockRejectedValue(new Error(message));
    s1read.softoneNextItemCode.mockResolvedValue({
      code: '00043', source: 'pattern', taken: 42, stale: false, supplierCodeTaken: true, supplierCode: 'ABC-9',
    });

    const res = await createItem(post({
      afm: AFM, pattern: 'υγρο αζωτο', kind: 'product',
      code: '00042', name: 'ΥΓΡΟ ΑΖΩΤΟ', vat: '1', unit: '101', supplierCode: 'ABC-9',
    }));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: 'code_taken', field: 'code', kind: 'product', message, suggestion: '00043',
    });
    // ΜΙΑ και μόνη προσπάθεια — και τίποτα δεν καθρεφτίστηκε τοπικά.
    expect(s1.softoneCreateItem).toHaveBeenCalledTimes(1);
    expect(db.softoneItem.upsert).not.toHaveBeenCalled();
    // Η νέα πρόταση βγήκε με ΦΡΕΣΚΑ δεδομένα.
    expect(s1read.clearItemCodeCache).toHaveBeenCalledWith('product');
  });

  it('ο κωδικός που ΜΟΛΙΣ απορρίφθηκε δεν ξαναπροτείνεται ως «κωδικός προμηθευτή»', async () => {
    s1.softoneCreateItem.mockRejectedValue(new Error('Ο κωδικός ABC-9 υπάρχει ήδη'));

    await createItem(post({
      afm: AFM, pattern: 'υγρο αζωτο', kind: 'service',
      code: 'ABC-9', name: 'ΥΓΡΟ ΑΖΩΤΟ', vat: '1', unit: '101', supplierCode: 'ABC-9',
    }));

    expect(s1read.softoneNextItemCode.mock.calls.at(-1)?.[1]).toMatchObject({ supplierCode: null });
  });

  it('κάθε άλλο σφάλμα SoftOne παραμένει 502 softone_error', async () => {
    s1.softoneCreateItem.mockRejectedValue(new Error('Το είδος δεν επιβεβαιώθηκε'));
    const res = await createItem(post({
      afm: AFM, pattern: 'x', kind: 'product', code: '00042', name: 'X', vat: '1', unit: '101',
    }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('softone_error');
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
    s1.softoneCreateTrader.mockResolvedValue({ trdr: 7001, code: 'Π.0007' });
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
    expect(s1.softoneCreateTrader.mock.calls[0][1]).toMatchObject({ afm: 'DE144960040' });
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
    s1.softoneCreateTrader.mockResolvedValue({ trdr: 7002, code: 'Π.0008' });
    db.ocrDocument.findMany.mockResolvedValue(pendingDocs(4));
    db.ocrDocument.updateMany.mockResolvedValue({ count: 4 });
    db.softoneTrader.upsert.mockResolvedValue({});

    const res = await createTrader(post({ kind: 'supplier', name: 'ΑΛΦΑ ΑΕ', country: 'GR' }), ctx(AFM));

    expect(await res.json()).toMatchObject({ ok: true, afm: AFM, docsUpdated: 4 });
    expect(s1.softoneCreateTrader.mock.calls[0][1]).toMatchObject({ afm: AFM });
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
  it('δέχεται προμηθευτή (12), πιστωτή (16) και ΧΡΕΩΣΤΗ (15)', async () => {
    for (const sodtype of [12, 16, 15]) {
      vi.clearAllMocks();
      rbac.requirePermission.mockResolvedValue(USER);
      audit.logAudit.mockResolvedValue(undefined);
      db.softoneTrader.findMany.mockResolvedValue([]);
      db.purchaseDocType.findMany.mockResolvedValue([]);
      db.softoneDocSeries.findMany.mockResolvedValue([]);
      db.ocrDocument.findMany.mockResolvedValue(pendingDocs(3));
      db.ocrDocument.updateMany.mockResolvedValue({ count: 3 });
      db.softoneTrader.findUnique.mockResolvedValue({
        trdr: 5001, code: 'Π.0001', name: 'ΑΛΦΑ ΑΕ', kind: 'Προμηθευτής', sodtype,
      });

      const res = await linkTrader(post({ trdr: 5001 }), ctx(AFM));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, trdr: 5001, docsUpdated: 3 });
    }
  });

  it.each([13, 14])('απορρίπτει SODTYPE %i με 422 invalid_sodtype', async (sodtype) => {
    db.softoneTrader.findUnique.mockResolvedValue({
      trdr: 6001, code: 'Π.1', name: 'ΒΗΤΑ', kind: 'Πελάτης', sodtype,
    });

    const res = await linkTrader(post({ trdr: 6001 }), ctx(AFM));

    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('invalid_sodtype');
    expect(db.ocrDocument.updateMany).not.toHaveBeenCalled();
  });

  it('σύνδεση με ΧΡΕΩΣΤΗ (15): τα έγγραφα παίρνουν την ετικέτα του μητρώου', async () => {
    db.ocrDocument.findMany.mockResolvedValue(pendingDocs(2));
    db.ocrDocument.updateMany.mockResolvedValue({ count: 2 });
    db.softoneTrader.findUnique.mockResolvedValue({
      trdr: 9002, code: 'Χ.0002', name: 'ΓΑΜΑ ΟΕ', kind: 'Χρεώστης', sodtype: 15,
    });

    const res = await linkTrader(post({ trdr: 9002 }), ctx(AFM));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, trdr: 9002, kind: 'Χρεώστης', docsUpdated: 2 });
    expect(db.ocrDocument.updateMany.mock.calls[0][0].data).toMatchObject({ softoneTrdr: 9002, softoneKind: 'Χρεώστης' });
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
