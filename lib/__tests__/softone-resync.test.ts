// lib/__tests__/softone-resync.test.ts
// Ο ενορχηστρωτής «Συγχρονισμός όλων των βοηθητικών πινάκων» και η ακύρωση του cached token όταν
// αλλάζει η σύνδεση SoftOne. ΚΑΜΙΑ ζωντανή κλήση στον ERP: το `@/lib/softone` είναι mock.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { db, s1, settings, audit, rbac } = vi.hoisted(() => ({
  db: {
    vatCategory: { findMany: vi.fn(), upsert: vi.fn(), delete: vi.fn(), update: vi.fn() },
    softoneLookup: { deleteMany: vi.fn(), createMany: vi.fn() },
    softoneExpense: { findMany: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
    softoneItem: { deleteMany: vi.fn(), createMany: vi.fn() },
    softoneTrader: { deleteMany: vi.fn(), createMany: vi.fn() },
    purchaseDocType: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    softoneDocSeries: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    appSetting: { findMany: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(),
  },
  s1: {
    softoneFetchVatCategories: vi.fn(),
    softoneFetchLookups: vi.fn(),
    softoneFetchExpenses: vi.fn(),
    softoneFetchItems: vi.fn(),
    softoneFetchTraders: vi.fn(),
    softoneFetchPurchaseDocTypes: vi.fn(),
    softoneFetchDocSeries: vi.fn(),
    clearCachedToken: vi.fn(),
  },
  settings: { setSetting: vi.fn(), maskSecret: (v: string) => `••••${v.slice(-4)}` },
  audit: { logAudit: vi.fn() },
  rbac: { requirePermission: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/softone', () => s1);
vi.mock('@/lib/audit', () => audit);
vi.mock('@/lib/rbac', () => rbac);
vi.mock('@/lib/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/settings')>()),
  setSetting: settings.setSetting,
}));

import { SYNC_STEPS, resyncAllSoftone, type SyncTable } from '@/lib/softone/resync';
import { PUT as putSettings } from '@/app/api/admin/settings/route';
import { POST as resyncRoute, GET as resyncSteps } from '@/app/api/admin/metadata/resync-all-softone/route';

const ACTOR = { id: 'u1', email: 'a@b.gr' };

/** Κάθε fetcher γυρίζει μία εύλογη γραμμή, ώστε κανένα βήμα να μη σκάσει στον έλεγχο «κενή απάντηση». */
function happyPath() {
  s1.softoneFetchVatCategories.mockResolvedValue([{ code: '1', name: 'ΦΠΑ 24%', percent: 24, isActive: true, mydataCode: null }]);
  s1.softoneFetchLookups.mockResolvedValue([{ kind: 'unit', code: '1', name: 'ΤΕΜ' }]);
  s1.softoneFetchExpenses.mockResolvedValue([{ expn: 10, code: 'E1', name: 'Έξοδο', vat: 1 }]);
  s1.softoneFetchItems.mockResolvedValue([{ mtrl: 1, code: 'A', code1: null, code2: null, name: 'Είδος', name2: null, price: 1, isService: false, isActive: true }]);
  s1.softoneFetchTraders.mockResolvedValue([{ trdr: 1, sodtype: 13, kind: 'supplier', code: 'S1', name: 'Προμηθευτής', afm: '1', doy: null, profession: null, address: null, district: null, zip: null, city: null, phone: null, phone2: null, fax: null, email: null, webpage: null, isActive: true }]);
  s1.softoneFetchPurchaseDocTypes.mockResolvedValue([{ code: '101', abbrev: 'ΤΑ', name: 'Τιμολόγιο αγοράς', section: 'Αγορές' }]);
  s1.softoneFetchDocSeries.mockResolvedValue([{ sosource: 1653, family: 'Πιστωτές', code: '7001', abbrev: 'ΠΙ', name: 'Πιστωτής', section: 'Πιστωτές' }]);
}

beforeEach(() => {
  vi.clearAllMocks();
  rbac.requirePermission.mockResolvedValue(ACTOR);
  db.vatCategory.findMany.mockResolvedValue([]);
  db.softoneExpense.findMany.mockResolvedValue([]);
  db.softoneExpense.updateMany.mockResolvedValue({ count: 0 });
  db.purchaseDocType.findMany.mockResolvedValue([]);
  db.purchaseDocType.deleteMany.mockResolvedValue({ count: 0 });
  db.softoneDocSeries.findMany.mockResolvedValue([]);
  db.softoneDocSeries.deleteMany.mockResolvedValue({ count: 0 });
  db.appSetting.findMany.mockResolvedValue([]);
  db.appSetting.upsert.mockResolvedValue({});
  // Οι τρεις «ολικής αντικατάστασης» πίνακες τρέχουν μέσα σε transaction με callback.
  db.$transaction.mockImplementation(async (fn: unknown) =>
    typeof fn === 'function' ? (fn as (tx: unknown) => unknown)(db) : fn);
  db.softoneLookup.createMany.mockResolvedValue({ count: 1 });
  db.softoneItem.createMany.mockResolvedValue({ count: 1 });
  db.softoneTrader.createMany.mockResolvedValue({ count: 1 });
  happyPath();
});

describe('SYNC_STEPS — η σειρά εξάρτησης', () => {
  it('τρέχει ΦΠΑ και lookups πριν από έξοδα/είδη, και τις σειρές τελευταίες', () => {
    expect(SYNC_STEPS.map((s) => s.table)).toEqual(
      ['vat', 'lookups', 'expenses', 'items', 'traders', 'purdoc', 'docseries'],
    );
  });

  it('καλύπτει και τους επτά πίνακες, χωρίς διπλοεγγραφή, με ελληνική ετικέτα', () => {
    const tables = SYNC_STEPS.map((s) => s.table);
    expect(new Set(tables).size).toBe(7);
    for (const s of SYNC_STEPS) expect(s.label.trim().length).toBeGreaterThan(0);
  });
});

describe('resyncAllSoftone', () => {
  it('τρέχει ΟΛΟΥΣ τους πίνακες με τη δηλωμένη σειρά και επιστρέφει το σχήμα αποτελέσματος', async () => {
    const report = await resyncAllSoftone(ACTOR);
    expect(report.ok).toBe(true);
    expect(report.results.map((r) => r.table)).toEqual(SYNC_STEPS.map((s) => s.table));
    for (const r of report.results) {
      expect(r).toMatchObject({ ok: true, error: null });
      expect(typeof r.created).toBe('number');
      expect(typeof r.updated).toBe('number');
      expect(typeof r.skipped).toBe('number');
      expect(typeof r.label).toBe('string');
    }
    expect(report.okCount).toBe(7);
    expect(report.failCount).toBe(0);
  });

  it('η σειρά εκτέλεσης είναι ΣΕΙΡΙΑΚΗ, όχι παράλληλη', async () => {
    const order: string[] = [];
    const mark = (name: string, value: unknown) => vi.fn(async () => {
      order.push(`start:${name}`);
      await new Promise((r) => setTimeout(r, 1));
      order.push(`end:${name}`);
      return value;
    });
    s1.softoneFetchVatCategories.mockImplementation(mark('vat', []));
    s1.softoneFetchLookups.mockImplementation(mark('lookups', [{ kind: 'u', code: '1', name: 'ΤΕΜ' }]));
    await resyncAllSoftone(ACTOR, { only: ['vat', 'lookups'] });
    expect(order).toEqual(['start:vat', 'end:vat', 'start:lookups', 'end:lookups']);
  });

  it('μια αποτυχία ΔΕΝ σταματά τους υπόλοιπους — και αναφέρεται με όνομα και μήνυμα', async () => {
    s1.softoneFetchItems.mockRejectedValue(new Error('SoftOne login απέτυχε'));
    const report = await resyncAllSoftone(ACTOR);

    expect(report.results).toHaveLength(7);
    expect(report.ok).toBe(false);
    expect(report.failCount).toBe(1);
    expect(report.okCount).toBe(6);

    const items = report.results.find((r) => r.table === 'items')!;
    expect(items).toMatchObject({ ok: false, error: 'SoftOne login απέτυχε', created: 0, updated: 0 });
    expect(items.label).toBe('Είδη & υπηρεσίες');

    // Οι πίνακες ΜΕΤΑ τον αποτυχημένο έτρεξαν κανονικά.
    expect(report.results.filter((r) => r.ok).map((r) => r.table))
      .toEqual(['vat', 'lookups', 'expenses', 'traders', 'purdoc', 'docseries']);
  });

  it('πολλαπλές αποτυχίες αναφέρονται όλες, χωρίς να πετάει', async () => {
    s1.softoneFetchTraders.mockResolvedValue([]);        // κενή απάντηση = σφάλμα του βήματος
    s1.softoneFetchExpenses.mockRejectedValue(new Error('timeout'));
    const report = await resyncAllSoftone(ACTOR);
    expect(report.failCount).toBe(2);
    expect(report.results.filter((r) => !r.ok).map((r) => r.table)).toEqual(['expenses', 'traders']);
    expect(report.results.find((r) => r.table === 'traders')!.error).toMatch(/συναλλασσόμενοι/i);
  });

  it('το `only` περιορίζει τα βήματα, κρατώντας τη σειρά', async () => {
    const report = await resyncAllSoftone(ACTOR, { only: ['docseries', 'vat'] as SyncTable[] });
    expect(report.results.map((r) => r.table)).toEqual(['vat', 'docseries']);
    expect(s1.softoneFetchItems).not.toHaveBeenCalled();
  });

  it('γράφει μία συγκεντρωτική εγγραφή ελέγχου για ολόκληρο πέρασμα, καμία για μερικό', async () => {
    await resyncAllSoftone(ACTOR);
    expect(audit.logAudit.mock.calls.filter((c) => c[0].action === 'metadata.resync_all.sync_softone')).toHaveLength(1);

    audit.logAudit.mockClear();
    await resyncAllSoftone(ACTOR, { only: ['vat'] });
    expect(audit.logAudit.mock.calls.filter((c) => c[0].action === 'metadata.resync_all.sync_softone')).toHaveLength(0);
  });

  it('είναι ασφαλές να ξανατρέξει: δεύτερο πέρασμα δίνει το ίδιο αποτέλεσμα', async () => {
    const first = await resyncAllSoftone(ACTOR);
    const second = await resyncAllSoftone(ACTOR);
    expect(second.results.map((r) => [r.table, r.ok, r.created, r.updated]))
      .toEqual(first.results.map((r) => [r.table, r.ok, r.created, r.updated]));
  });
});

describe('POST /api/admin/metadata/resync-all-softone', () => {
  const post = (body?: unknown) =>
    new Request('http://localhost/api/admin/metadata/resync-all-softone', {
      method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  it('απαιτεί το δικαίωμα metadata.manage — ίδιο με τα επιμέρους sync routes', async () => {
    await resyncRoute(post());
    expect(rbac.requirePermission).toHaveBeenCalledWith('metadata.manage');
  });

  it('επιστρέφει τον απολογισμό ανά πίνακα', async () => {
    const res = await resyncRoute(post());
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.results).toHaveLength(7);
    expect(json.ok).toBe(true);
  });

  it('200 (όχι 502) και όταν κάποιος πίνακας αποτύχει — ο απολογισμός είναι το αποτέλεσμα', async () => {
    s1.softoneFetchItems.mockRejectedValue(new Error('σκάσε'));
    const res = await resyncRoute(post());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.results.find((r: { table: string }) => r.table === 'items').error).toBe('σκάσε');
  });

  it('τιμά το `only` και αγνοεί άγνωστα ονόματα πινάκων', async () => {
    const res = await resyncRoute(post({ only: ['vat', 'ΔΕΝ_ΥΠΑΡΧΕΙ'] }));
    expect((await res.json()).results.map((r: { table: string }) => r.table)).toEqual(['vat']);
  });

  it('το GET δίνει τη σειρά των βημάτων χωρίς να αγγίξει το SoftOne', async () => {
    const json = await (await resyncSteps()).json();
    expect(json.steps.map((s: { table: string }) => s.table))
      .toEqual(['vat', 'lookups', 'expenses', 'items', 'traders', 'purdoc', 'docseries']);
    expect(s1.softoneFetchVatCategories).not.toHaveBeenCalled();
  });
});

describe('PUT /api/admin/settings — ακύρωση του cached SoftOne token', () => {
  const put = (updates: { key: string; value: unknown }[]) =>
    new Request('http://localhost/api/admin/settings', { method: 'PUT', body: JSON.stringify({ updates }) });

  it('αλλαγή εταιρίας πετάει το token της παλιάς συνεδρίας', async () => {
    const res = await putSettings(put([{ key: 'integrations.softoneCompany', value: '1003' }]));
    expect(s1.clearCachedToken).toHaveBeenCalledTimes(1);
    expect(await res.json()).toMatchObject({ ok: true, softoneConnectionChanged: true });
  });

  it.each([
    'integrations.softoneSerial', 'integrations.softoneAppId', 'integrations.softoneUser',
    'integrations.softonePass', 'integrations.softoneCompany', 'integrations.softoneBranch',
    'integrations.softoneModule', 'integrations.softoneRefid',
  ])('%s ακυρώνει το token', async (key) => {
    await putSettings(put([{ key, value: 'x' }]));
    expect(s1.clearCachedToken).toHaveBeenCalled();
  });

  it('άσχετη ρύθμιση ΔΕΝ πετάει το token', async () => {
    const res = await putSettings(put([{ key: 'company.name', value: 'ΝΕΑ ΑΕ' }]));
    expect(s1.clearCachedToken).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ softoneConnectionChanged: false });
  });

  it('μασκαρεμένο μυστικό που ΔΕΝ άλλαξε δεν ακυρώνει τίποτα', async () => {
    // Η φόρμα στέλνει πίσω το «••••1234» όταν ο χρήστης δεν άγγιξε το πεδίο.
    await putSettings(put([{ key: 'integrations.softonePass', value: '••••1234' }]));
    expect(settings.setSetting).not.toHaveBeenCalled();
    expect(s1.clearCachedToken).not.toHaveBeenCalled();
  });

  it('η σημαία βγαίνει και όταν η αλλαγή είναι μία μέσα σε πολλές', async () => {
    const res = await putSettings(put([
      { key: 'company.name', value: 'ΑΕ' },
      { key: 'integrations.softoneBranch', value: '1000' },
      { key: 'general.timezone', value: 'Europe/Athens' },
    ]));
    expect(s1.clearCachedToken).toHaveBeenCalledTimes(1);
    expect(await res.json()).toMatchObject({
      softoneConnectionChanged: true,
      softoneKeysChanged: ['integrations.softoneBranch'],
    });
  });
});
