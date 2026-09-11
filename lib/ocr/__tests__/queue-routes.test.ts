// lib/ocr/__tests__/queue-routes.test.ts
// Τα routes των δύο ουρών (spec 2026-09-11 §2/§3) καλούνται ΑΠΕΥΘΕΙΑΣ ως handlers, με
// mocked rbac / prisma / SoftOne / audit. Εδώ ελέγχουμε ό,τι δεν πιάνει το `lib/ocr/queues.ts`:
// τους φύλακες (permission, ΑΦΜ, SODTYPE) και ότι το dry-run δεν γράφει ΠΟΥΘΕΝΑ.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { db, rbac, s1, audit } = vi.hoisted(() => ({
  db: {
    ocrDocument: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), groupBy: vi.fn() },
    ocrInvoiceItem: { findMany: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    ignoredIssuer: { findMany: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
    softoneTrader: { findUnique: vi.fn(), upsert: vi.fn() },
    softoneItem: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
    softoneExpense: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
    lineMatchRule: { findMany: vi.fn(), upsert: vi.fn() },
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
}));

vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/rbac', () => rbac);
vi.mock('@/lib/audit', () => audit);
// Οι καθαροί payload builders μένουν ΑΛΗΘΙΝΟΙ (το dry-run τους επιστρέφει αυτούσιους)·
// μόνο ό,τι μιλάει στο δίκτυο αντικαθίσταται.
vi.mock('@/lib/softone', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/softone')>()),
  ...s1,
}));

import { POST as createTrader } from '@/app/api/admin/ocr/new-traders/[afm]/create/route';
import { POST as linkTrader } from '@/app/api/admin/ocr/new-traders/[afm]/link/route';
import { POST as ignoreTrader, DELETE as unignoreTrader } from '@/app/api/admin/ocr/new-traders/[afm]/ignore/route';
import { POST as createItem } from '@/app/api/admin/ocr/new-items/create/route';
import { GET as itemQueue } from '@/app/api/admin/ocr/new-items/route';

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
  db.ocrDocument.updateMany.mockResolvedValue({ count: 0 });
  db.ocrDocument.groupBy.mockResolvedValue([]);
  db.ocrInvoiceItem.findMany.mockResolvedValue([]);
  db.ocrInvoiceItem.count.mockResolvedValue(0);
  db.ignoredIssuer.findMany.mockResolvedValue([]);
  db.lineMatchRule.findMany.mockResolvedValue([]);
  s1.softoneLoadExpenseTemplate.mockResolvedValue({ flags: { CLCMD: 1 }, expn: 7 });
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
