// lib/__tests__/softone-resync.test.ts
// Ο ενορχηστρωτής «Συγχρονισμός όλων των βοηθητικών πινάκων» και η ακύρωση του cached token όταν
// αλλάζει η σύνδεση SoftOne. ΚΑΜΙΑ ζωντανή κλήση στον ERP: το `@/lib/softone` είναι mock.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { db, s1, errs, settings, audit, rbac } = vi.hoisted(() => {
  // Οι ΠΡΑΓΜΑΤΙΚΕΣ κλάσεις σφάλματος: το `resync.ts` κάνει `instanceof` για να ξεχωρίσει
  // αποτυχία του ERP από αποτυχία της τοπικής βάσης, και για να πετάξει «άδεια απάντηση».
  class SoftoneError extends Error { constructor(m?: string) { super(m); this.name = 'SoftoneError'; } }
  class SoftoneConfigError extends SoftoneError {}
  return ({
  errs: { SoftoneError, SoftoneConfigError },
  db: {
    vatCategory: { findMany: vi.fn(), upsert: vi.fn(), delete: vi.fn(), update: vi.fn() },
    softoneLookup: { deleteMany: vi.fn(), createMany: vi.fn(), groupBy: vi.fn() },
    softoneExpense: { findMany: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
    softoneItem: { deleteMany: vi.fn(), createMany: vi.fn() },
    softoneTrader: { deleteMany: vi.fn(), createMany: vi.fn() },
    purchaseDocType: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    softoneDocSeries: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    softoneLineItem: { findMany: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
    softoneAccount: { deleteMany: vi.fn(), createMany: vi.fn() },
    softoneLineCategory: { findMany: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
    softoneMyDataClassType: { findMany: vi.fn(), upsert: vi.fn() },
    softoneMyDataClassCategory: { findMany: vi.fn(), upsert: vi.fn() },
    softoneCostCenter: { findMany: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
    softoneProject: { findMany: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
    softoneProjectStage: { findMany: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
    appSetting: {
      findMany: vi.fn(), upsert: vi.fn(),
      // Ο δείκτης τρέχοντος περάσματος (κλειδαριά + σωρευτής) ζει σε γραμμή `AppSetting`.
      create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(),
    },
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
    softoneFetchLineItems: vi.fn(),
    softoneFetchAccounts: vi.fn(),
    softoneFetchLineCategories: vi.fn(),
    softoneFetchMyDataClassTypes: vi.fn(),
    softoneFetchMyDataClassCategories: vi.fn(),
    softoneFetchCostCenters: vi.fn(),
    softoneFetchProjects: vi.fn(),
    softoneFetchProjectStages: vi.fn(),
    clearCachedToken: vi.fn(),
  },
  settings: { setSetting: vi.fn(), maskSecret: (v: string) => `••••${v.slice(-4)}` },
  audit: { logAudit: vi.fn() },
  rbac: { requirePermission: vi.fn() },
  });
});

vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/softone', () => ({ ...s1, ...errs }));
vi.mock('@/lib/audit', () => audit);
vi.mock('@/lib/rbac', () => rbac);
vi.mock('@/lib/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/settings')>()),
  setSetting: settings.setSetting,
}));

import { SYNC_STEPS, ResyncBusyError, resyncAllSoftone, type SyncTable } from '@/lib/softone-sync/resync';
import { PUT as putSettings } from '@/app/api/admin/settings/route';
import { POST as resyncRoute, GET as resyncSteps } from '@/app/api/admin/metadata/resync-all-softone/route';
import { POST as syncItemsRoute } from '@/app/api/admin/metadata/sync-items-softone/route';

const ACTOR = { id: 'u1', email: 'a@b.gr' };

/** Κάθε fetcher γυρίζει μία εύλογη γραμμή, ώστε κανένα βήμα να μη σκάσει στον έλεγχο «κενή απάντηση». */
function happyPath() {
  s1.softoneFetchVatCategories.mockResolvedValue([{ code: '1', name: 'ΦΠΑ 24%', percent: 24, isActive: true, mydataCode: null }]);
  s1.softoneFetchLookups.mockResolvedValue({ rows: [{ kind: 'MTRUNIT', code: '1', name: 'ΤΕΜ' }], failed: [] });
  s1.softoneFetchExpenses.mockResolvedValue([{ expn: 10, code: 'E1', name: 'Έξοδο', vat: 1 }]);
  s1.softoneFetchItems.mockResolvedValue([{ mtrl: 1, code: 'A', code1: null, code2: null, name: 'Είδος', name2: null, price: 1, isService: false, isActive: true }]);
  s1.softoneFetchTraders.mockResolvedValue([{ trdr: 1, sodtype: 13, kind: 'supplier', code: 'S1', name: 'Προμηθευτής', afm: '1', doy: null, profession: null, address: null, district: null, zip: null, city: null, phone: null, phone2: null, fax: null, email: null, webpage: null, isActive: true }]);
  s1.softoneFetchPurchaseDocTypes.mockResolvedValue([{ code: '101', abbrev: 'ΤΑ', name: 'Τιμολόγιο αγοράς', section: 'Αγορές' }]);
  s1.softoneFetchDocSeries.mockResolvedValue([{ sosource: 1653, family: 'Πιστωτές', code: '7001', abbrev: 'ΠΙ', name: 'Πιστωτής', section: 'Πιστωτές' }]);
  s1.softoneFetchLineItems.mockResolvedValue([{ mtrl: 777, code: 'ΧΡ01', name: 'ΕΝΟΙΚΙΑ', vat: '1', mtrType: 0, mtrCategory: 5, classType: null, classCategory: null, myDataCode: null, myDataVprc: null, acnmsk: '62.04.00.0024', isActive: true }]);
  s1.softoneFetchAccounts.mockResolvedValue([
    { acnt: 1, code: '62', name: 'ΠΑΡΟΧΕΣ ΤΡΙΤΩΝ', grade: 1, sodtype: 89, isActive: true },
    { acnt: 2, code: '62.04.00.0024', name: 'Ενοίκια 24%', grade: 4, sodtype: 89, isActive: true },
  ]);
  s1.softoneFetchLineCategories.mockResolvedValue({ rows: [{ mtrCategory: 5, code: 'ΛΕΙΤ', name: 'ΛΕΙΤΟΥΡΓΙΚΑ', vat: null, acnmsk: null, isActive: true }], filtered: true });
  s1.softoneFetchMyDataClassTypes.mockResolvedValue([{ sotype: 1, code: 1, myDataCode: 'category2_1', sohCode: null, name: 'Αγορές', isVat: false }]);
  s1.softoneFetchMyDataClassCategories.mockResolvedValue([{ sotype: 1, code: 2, myDataCode: 'category2_2', sohCode: null, name: 'Δαπάνες' }]);
  s1.softoneFetchCostCenters.mockResolvedValue([{ costcntr: 3, code: 'ΚΚ01', name: 'ΠΑΡΑΓΩΓΗ', name2: null, sohCode: null, acnmsk: null, isActive: true }]);
  s1.softoneFetchProjects.mockResolvedValue([{ prjc: 4, code: 'ΕΡΓ1', name: 'ΕΡΓΟ Α', trdr: 12345, prjType: 1, isActive: true }]);
  s1.softoneFetchProjectStages.mockResolvedValue([{ prjcStage: 5, code: 'ΔΡ1', name: 'ΜΕΛΕΤΗ', isActive: true }]);
}

/**
 * Ο δείκτης τρέχοντος περάσματος είναι ΜΙΑ γραμμή `AppSetting` με μοναδικό `key`. Τον
 * προσομοιώνουμε πιστά (create = ατομικό «πιάσε τη σειρά», P2002 = κάποιος άλλος την έχει),
 * γιατί πάνω σε αυτή τη μοναδικότητα στηρίζεται και η κλειδαριά και ο σωρευτής του περάσματος.
 */
type MarkerWhere = { key?: string; value?: { path?: string[]; equals?: unknown } };
let markerRow: { key: string; value: unknown } | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  markerRow = null;
  db.appSetting.create.mockImplementation(async ({ data }: { data: { key: string; value: unknown } }) => {
    if (markerRow) { const e = new Error('Unique constraint failed') as Error & { code: string }; e.code = 'P2002'; throw e; }
    markerRow = { key: data.key, value: data.value };
    return markerRow;
  });
  db.appSetting.findUnique.mockImplementation(async () => markerRow);
  // Οι γραφές στον δείκτη είναι ΥΠΟ ΣΥΝΘΗΚΗ `runId` (`where.value.path/equals`): ο ψεύτικος
  // πρέπει να τη σέβεται, αλλιώς τα tests δεν θα έβλεπαν ποτέ το bug που κλείνει η συνθήκη.
  const matches = (where: MarkerWhere | undefined): boolean => {
    if (!markerRow) return false;
    const want = where?.value?.equals;
    if (want === undefined) return true;
    return (markerRow.value as { runId?: string })?.runId === want;
  };
  db.appSetting.updateMany.mockImplementation(async ({ where, data }: { where?: MarkerWhere; data: { value: unknown } }) => {
    if (!matches(where)) return { count: 0 };
    markerRow = { key: 'integrations.softoneResyncRun', value: data.value };
    return { count: 1 };
  });
  db.appSetting.deleteMany.mockImplementation(async ({ where }: { where?: MarkerWhere } = {}) => {
    if (!matches(where)) return { count: 0 };
    markerRow = null;
    return { count: 1 };
  });
  rbac.requirePermission.mockResolvedValue(ACTOR);
  db.vatCategory.findMany.mockResolvedValue([]);
  db.softoneExpense.findMany.mockResolvedValue([]);
  db.softoneExpense.updateMany.mockResolvedValue({ count: 0 });
  db.purchaseDocType.findMany.mockResolvedValue([]);
  db.purchaseDocType.deleteMany.mockResolvedValue({ count: 0 });
  db.softoneDocSeries.findMany.mockResolvedValue([]);
  db.softoneDocSeries.deleteMany.mockResolvedValue({ count: 0 });
  db.softoneLineItem.findMany.mockResolvedValue([]);
  db.softoneLineItem.updateMany.mockResolvedValue({ count: 0 });
  db.softoneLineCategory.findMany.mockResolvedValue([]);
  db.softoneLineCategory.updateMany.mockResolvedValue({ count: 0 });
  db.softoneMyDataClassType.findMany.mockResolvedValue([]);
  db.softoneMyDataClassCategory.findMany.mockResolvedValue([]);
  db.softoneCostCenter.findMany.mockResolvedValue([]);
  db.softoneCostCenter.updateMany.mockResolvedValue({ count: 0 });
  db.softoneProject.findMany.mockResolvedValue([]);
  db.softoneProject.updateMany.mockResolvedValue({ count: 0 });
  db.softoneProjectStage.findMany.mockResolvedValue([]);
  db.softoneProjectStage.updateMany.mockResolvedValue({ count: 0 });
  db.appSetting.findMany.mockResolvedValue([]);
  db.appSetting.upsert.mockResolvedValue({});
  // Οι τρεις «ολικής αντικατάστασης» πίνακες τρέχουν μέσα σε transaction με callback.
  db.$transaction.mockImplementation(async (fn: unknown) =>
    typeof fn === 'function' ? (fn as (tx: unknown) => unknown)(db) : fn);
  db.softoneLookup.createMany.mockResolvedValue({ count: 1 });
  db.softoneLookup.groupBy.mockResolvedValue([]);
  db.softoneItem.createMany.mockResolvedValue({ count: 1 });
  db.softoneTrader.createMany.mockResolvedValue({ count: 1 });
  db.softoneAccount.createMany.mockImplementation(async ({ data }: { data: unknown[] }) => ({ count: data.length }));
  happyPath();
});

/** Οι συγκεντρωτικές εγγραφές ελέγχου που γράφτηκαν μέχρι τώρα. */
const aggregateEntries = () =>
  audit.logAudit.mock.calls.filter((c) => c[0].action === 'metadata.resync_all.sync_softone');

describe('SYNC_STEPS — η σειρά εξάρτησης', () => {
  it('τρέχει ΦΠΑ και lookups πριν από έξοδα/είδη, και τις σειρές τελευταίες', () => {
    expect(SYNC_STEPS.map((s) => s.table)).toEqual(
      ['vat', 'lookups', 'expenses', 'items', 'traders', 'purdoc', 'docseries',
        'accounts', 'linecategories', 'lineitems', 'mydataclasses', 'costcenters', 'projects', 'projectstages'],
    );
  });

  it('καλύπτει όλους τους πίνακες, χωρίς διπλοεγγραφή, με ελληνική ετικέτα', () => {
    const tables = SYNC_STEPS.map((s) => s.table);
    expect(new Set(tables).size).toBe(SYNC_STEPS.length);
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
    expect(report.okCount).toBe(SYNC_STEPS.length);
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
    s1.softoneFetchLookups.mockImplementation(mark('lookups', { rows: [{ kind: 'MTRUNIT', code: '1', name: 'ΤΕΜ' }], failed: [] }));
    await resyncAllSoftone(ACTOR, { only: ['vat', 'lookups'] });
    expect(order).toEqual(['start:vat', 'end:vat', 'start:lookups', 'end:lookups']);
  });

  it('μια αποτυχία ΔΕΝ σταματά τους υπόλοιπους — και αναφέρεται με όνομα και μήνυμα', async () => {
    s1.softoneFetchItems.mockRejectedValue(new Error('SoftOne login απέτυχε'));
    const report = await resyncAllSoftone(ACTOR);

    expect(report.results).toHaveLength(SYNC_STEPS.length);
    expect(report.ok).toBe(false);
    expect(report.failCount).toBe(1);
    expect(report.okCount).toBe(SYNC_STEPS.length - 1);

    const items = report.results.find((r) => r.table === 'items')!;
    expect(items).toMatchObject({ ok: false, error: 'SoftOne login απέτυχε', created: 0, updated: 0 });
    expect(items.label).toBe('Είδη & υπηρεσίες');

    // Οι πίνακες ΜΕΤΑ τον αποτυχημένο έτρεξαν κανονικά.
    expect(report.results.filter((r) => r.ok).map((r) => r.table))
      .toEqual(SYNC_STEPS.map((x) => x.table).filter((t) => t !== 'items'));
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
    expect(aggregateEntries()).toHaveLength(1);

    audit.logAudit.mockClear();
    await resyncAllSoftone(ACTOR, { only: ['vat'] });
    expect(aggregateEntries()).toHaveLength(0);
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
    expect(json.results).toHaveLength(SYNC_STEPS.length);
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
      .toEqual(SYNC_STEPS.map((x) => x.table));
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


// ─────────────────────────────────────────────────────────────────────────────
// Άδεια απάντηση SoftOne: το μητρώο ΔΕΝ αδειάζει, και το βήμα ΔΕΝ λέει ψέματα
// ─────────────────────────────────────────────────────────────────────────────

describe('άδεια απάντηση SoftOne — κανένα μητρώο δεν αδειάζει σιωπηλά', () => {
  /**
   * Για κάθε βήμα: ο fetcher γυρίζει κενή λίστα, η βάση έχει ΗΔΗ περιεχόμενο (ώστε το prune να
   * είχε πραγματικά τι να σβήσει), και ελέγχουμε ότι (α) το βήμα σημειώνεται ΑΠΟΤΥΧΙΑ και
   * (β) καμία καταστροφική κλήση δεν έφυγε προς τη βάση.
   */
  const CASES: Array<{
    table: SyncTable;
    arm: () => void;
    fetcher: () => ReturnType<typeof vi.fn>;
    destructive: () => ReturnType<typeof vi.fn>[];
  }> = [
    {
      table: 'vat',
      arm: () => db.vatCategory.findMany.mockResolvedValue([
        { code: '1', _count: { companies: 0 } },   // θα σβηνόταν
        { code: '2', _count: { companies: 3 } },   // θα απενεργοποιούνταν
      ]),
      fetcher: () => s1.softoneFetchVatCategories,
      destructive: () => [db.vatCategory.delete, db.vatCategory.update, db.vatCategory.upsert],
    },
    {
      table: 'lookups',
      arm: () => {},
      fetcher: () => s1.softoneFetchLookups,
      destructive: () => [db.softoneLookup.deleteMany],
    },
    {
      table: 'expenses',
      arm: () => db.softoneExpense.findMany.mockResolvedValue([{ expn: 10 }]),
      fetcher: () => s1.softoneFetchExpenses,
      destructive: () => [db.softoneExpense.updateMany, db.softoneExpense.upsert],
    },
    {
      table: 'items',
      arm: () => {},
      fetcher: () => s1.softoneFetchItems,
      destructive: () => [db.softoneItem.deleteMany],
    },
    {
      table: 'traders',
      arm: () => {},
      fetcher: () => s1.softoneFetchTraders,
      destructive: () => [db.softoneTrader.deleteMany],
    },
    {
      table: 'purdoc',
      arm: () => db.purchaseDocType.findMany.mockResolvedValue([{ code: '101' }]),
      fetcher: () => s1.softoneFetchPurchaseDocTypes,
      destructive: () => [db.purchaseDocType.deleteMany, db.purchaseDocType.upsert],
    },
    {
      table: 'docseries',
      arm: () => db.softoneDocSeries.findMany.mockResolvedValue([{ id: 'x', sosource: 1653, code: '7001' }]),
      fetcher: () => s1.softoneFetchDocSeries,
      destructive: () => [db.softoneDocSeries.deleteMany, db.softoneDocSeries.upsert],
    },
    {
      table: 'accounts',
      arm: () => {},
      fetcher: () => s1.softoneFetchAccounts,
      destructive: () => [db.softoneAccount.deleteMany, db.softoneAccount.createMany],
    },
    {
      table: 'linecategories',
      arm: () => db.softoneLineCategory.findMany.mockResolvedValue([{ mtrCategory: 5 }]),
      fetcher: () => s1.softoneFetchLineCategories,
      destructive: () => [db.softoneLineCategory.updateMany, db.softoneLineCategory.upsert],
    },
    {
      table: 'lineitems',
      arm: () => db.softoneLineItem.findMany.mockResolvedValue([{ mtrl: 777 }]),
      fetcher: () => s1.softoneFetchLineItems,
      destructive: () => [db.softoneLineItem.updateMany, db.softoneLineItem.upsert],
    },
    {
      table: 'mydataclasses',
      arm: () => {},
      fetcher: () => s1.softoneFetchMyDataClassTypes,
      destructive: () => [db.softoneMyDataClassType.upsert],
    },
    {
      table: 'costcenters',
      arm: () => db.softoneCostCenter.findMany.mockResolvedValue([{ costcntr: 3 }]),
      fetcher: () => s1.softoneFetchCostCenters,
      destructive: () => [db.softoneCostCenter.updateMany, db.softoneCostCenter.upsert],
    },
    {
      table: 'projects',
      arm: () => db.softoneProject.findMany.mockResolvedValue([{ prjc: 4 }]),
      fetcher: () => s1.softoneFetchProjects,
      destructive: () => [db.softoneProject.updateMany, db.softoneProject.upsert],
    },
    {
      table: 'projectstages',
      arm: () => db.softoneProjectStage.findMany.mockResolvedValue([{ prjcStage: 5 }]),
      fetcher: () => s1.softoneFetchProjectStages,
      destructive: () => [db.softoneProjectStage.updateMany, db.softoneProjectStage.upsert],
    },
  ];

  it('καλύπτονται ΟΛΑ τα βήματα', () => {
    expect(CASES.map((c) => c.table)).toEqual(SYNC_STEPS.map((s) => s.table));
  });

  it.each(CASES)('$table: κενή λίστα ⇒ αποτυχία βήματος, καμία διαγραφή', async (c) => {
    c.arm();
    // Δύο fetchers δεν επιστρέφουν σκέτο array: τα lookups και οι κατηγορίες δαπανών.
    c.fetcher().mockResolvedValue(
      c.table === 'lookups' ? { rows: [], failed: [] }
        : c.table === 'linecategories' ? { rows: [], filtered: true }
          : [],
    );
    // Οι δύο λίστες myDATA είναι ζεύγος: το βήμα αποτυγχάνει μόνο όταν αδειάσουν ΚΑΙ οι δύο.
    if (c.table === 'mydataclasses') s1.softoneFetchMyDataClassCategories.mockResolvedValue([]);

    const report = await resyncAllSoftone(ACTOR, { only: [c.table] });
    const outcome = report.results[0];

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/Δεν επιστράφηκαν/);
    expect(outcome.errorSource).toBe('softone');
    for (const fn of c.destructive()) expect(fn).not.toHaveBeenCalled();
    // Καμία σφραγίδα «συγχρονίστηκε» δεν μπαίνει σε βήμα που απέτυχε.
    expect(settings.setSetting).not.toHaveBeenCalled();
  });

  it('σε πλήρες πέρασμα, ένα άδειο βήμα δεν παρασύρει τα υπόλοιπα', async () => {
    s1.softoneFetchVatCategories.mockResolvedValue([]);
    const report = await resyncAllSoftone(ACTOR);
    expect(report.results.find((r) => r.table === 'vat')).toMatchObject({ ok: false, errorSource: 'softone' });
    expect(report.okCount).toBe(SYNC_STEPS.length - 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Ποιο σύστημα φταίει
// ─────────────────────────────────────────────────────────────────────────────

describe('χρέωση της αποτυχίας στο σωστό σύστημα', () => {
  it('αποτυχία της ΤΟΠΙΚΗΣ βάσης δεν χρεώνεται στο SoftOne', async () => {
    db.softoneItem.createMany.mockRejectedValue(new Error('deadlock detected'));
    const report = await resyncAllSoftone(ACTOR, { only: ['items'] });
    expect(report.results[0]).toMatchObject({ ok: false, errorSource: 'database' });
  });

  it('το μεμονωμένο route απαντά 500 database_error, όχι 502 softone_error', async () => {
    db.softoneItem.createMany.mockRejectedValue(new Error('deadlock detected'));
    const res = await syncItemsRoute();
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: 'database_error' });
  });

  it('το μεμονωμένο route απαντά 502 softone_error όταν φταίει ο ERP', async () => {
    s1.softoneFetchItems.mockRejectedValue(new errs.SoftoneError('Το SoftOne δεν απάντησε'));
    const res = await syncItemsRoute();
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'softone_error' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Κλειδαριά + συγκεντρωτική εγγραφή για πέρασμα σπασμένο σε πολλά αιτήματα
// ─────────────────────────────────────────────────────────────────────────────

describe('δείκτης τρέχοντος περάσματος', () => {
  const PASS = SYNC_STEPS.map((s) => s.table);

  it('διαδοχικές κλήσεις με το ΙΔΙΟ runId γράφουν ΜΙΑ συγκεντρωτική εγγραφή, στο τέλος', async () => {
    for (const table of PASS) {
      expect(aggregateEntries()).toHaveLength(0); // τίποτα πριν κλείσει ο κύκλος
      await resyncAllSoftone(ACTOR, { only: [table], run: { id: 'RUN-1', tables: PASS } });
    }
    const agg = aggregateEntries();
    expect(agg).toHaveLength(1);
    expect(agg[0][0].metadata).toMatchObject({ ok: true, okCount: PASS.length, failCount: 0 });
    // Ο δείκτης σβήνεται μόλις κλείσει ο κύκλος — αλλιώς θα κλείδωνε το επόμενο πέρασμα.
    expect(markerRow).toBeNull();
  });

  it('η συγκεντρωτική κρατάει ΟΛΕΣ τις αποτυχίες του περάσματος, όχι μόνο της τελευταίας κλήσης', async () => {
    s1.softoneFetchExpenses.mockResolvedValue([]);
    for (const table of PASS) {
      await resyncAllSoftone(ACTOR, { only: [table], run: { id: 'RUN-2', tables: PASS } });
    }
    const meta = aggregateEntries()[0][0].metadata as { failCount: number; failed: { table: string }[] };
    expect(meta.failCount).toBe(1);
    expect(meta.failed.map((f) => f.table)).toEqual(['expenses']);
  });

  it('μερικό πέρασμα (επανάληψη μόνο για όσους απέτυχαν) ΔΕΝ γράφει συγκεντρωτική', async () => {
    const some: SyncTable[] = ['vat', 'items'];
    for (const table of some) {
      await resyncAllSoftone(ACTOR, { only: [table], run: { id: 'RUN-3', tables: some } });
    }
    expect(aggregateEntries()).toHaveLength(0);
    expect(markerRow).toBeNull();
  });

  it('δεύτερο, ΑΣΧΕΤΟ πέρασμα μπλοκάρεται όσο τρέχει το πρώτο', async () => {
    await resyncAllSoftone(ACTOR, { only: ['vat'], run: { id: 'RUN-A', tables: PASS } });
    expect(markerRow).not.toBeNull(); // ο κύκλος δεν έχει κλείσει

    await expect(
      resyncAllSoftone({ id: 'u2', email: 'b@b.gr' }, { only: ['items'], run: { id: 'RUN-B', tables: ['items'] } }),
    ).rejects.toBeInstanceOf(ResyncBusyError);
    expect(s1.softoneFetchItems).not.toHaveBeenCalled();
  });

  it('το route απαντά 409 sync_running στον δεύτερο διαχειριστή', async () => {
    const post = (body: unknown) =>
      new Request('http://localhost/api/admin/metadata/resync-all-softone', { method: 'POST', body: JSON.stringify(body) });

    await resyncRoute(post({ only: ['vat'], runId: 'RUN-A', pass: SYNC_STEPS.map((s) => s.table) }));
    const res = await resyncRoute(post({ only: ['items'], runId: 'RUN-B', pass: ['items'] }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'sync_running' });
  });

  it('ξεχασμένος δείκτης (κλειστή καρτέλα) δεν κλειδώνει για πάντα', async () => {
    markerRow = {
      key: 'integrations.softoneResyncRun',
      value: {
        runId: 'OLD', actorId: 'u9', actorEmail: 'old@b.gr',
        startedAt: Date.now() - 60 * 60 * 1000, touchedAt: Date.now() - 60 * 60 * 1000,
        expected: ['vat', 'items'], done: [],
      },
    };
    const report = await resyncAllSoftone(ACTOR, { only: ['vat'] });
    expect(report.results[0].ok).toBe(true);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// Βοηθητικοί πίνακες: η αποτυχία ΕΝΟΣ είδους δεν σβήνει το μητρώο του
// ─────────────────────────────────────────────────────────────────────────────

describe('syncLookups — μερική αποτυχία υποπινάκων', () => {
  const rows = [
    { kind: 'VAT', code: '1', name: 'ΦΠΑ 24%' },
    { kind: 'MTRGROUP', code: '7', name: 'Ομάδα' },
  ];

  it('πίνακας που ΔΕΝ απάντησε ενώ είχε δεδομένα ⇒ αποτυχία, καμία διαγραφή', async () => {
    s1.softoneFetchLookups.mockResolvedValue({ rows, failed: ['MTRUNIT'] });
    db.softoneLookup.groupBy.mockResolvedValue([
      { kind: 'MTRUNIT', _count: { _all: 42 } },
      { kind: 'VAT', _count: { _all: 5 } },
    ]);

    const report = await resyncAllSoftone(ACTOR, { only: ['lookups'] });

    expect(report.results[0]).toMatchObject({ ok: false, errorSource: 'softone' });
    expect(report.results[0].error).toMatch(/MTRUNIT/);
    expect(db.softoneLookup.deleteMany).not.toHaveBeenCalled();
    expect(db.softoneLookup.createMany).not.toHaveBeenCalled();
    expect(settings.setSetting).not.toHaveBeenCalled();
  });

  it('πίνακας που δεν απάντησε αλλά ήταν ούτως ή άλλως άδειος δεν σταματάει τίποτα', async () => {
    s1.softoneFetchLookups.mockResolvedValue({ rows, failed: ['MTRMARK'] });
    db.softoneLookup.groupBy.mockResolvedValue([{ kind: 'VAT', _count: { _all: 5 } }]);

    const report = await resyncAllSoftone(ACTOR, { only: ['lookups'] });

    expect(report.results[0].ok).toBe(true);
    expect(report.results[0].detail).toMatchObject({ notAnswered: ['MTRMARK'] });
  });

  it('καθαρίζονται ΜΟΝΟ τα είδη που απάντησαν', async () => {
    s1.softoneFetchLookups.mockResolvedValue({ rows, failed: ['MTRMARK'] });
    db.softoneLookup.groupBy.mockResolvedValue([{ kind: 'MTRMARK', _count: { _all: 0 } }]);

    await resyncAllSoftone(ACTOR, { only: ['lookups'] });

    expect(db.softoneLookup.deleteMany).toHaveBeenCalledWith({ where: { kind: { in: ['VAT', 'MTRGROUP'] } } });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Η κλειδαριά δεν κλέβεται και δεν πατιέται
// ─────────────────────────────────────────────────────────────────────────────

describe('ανθεκτικότητα του δείκτη', () => {
  it('η απελευθέρωση ΔΕΝ πατάει τον δείκτη άλλου περάσματος', async () => {
    // Το δικό μας πέρασμα ξεκίνησε…
    await resyncAllSoftone(ACTOR, { only: ['vat'], run: { id: 'MINE', tables: ['vat', 'items'] } });
    expect((markerRow!.value as { runId: string }).runId).toBe('MINE');

    // …και στο μεταξύ (αργό βήμα, ξεπερασμένο TTL) άλλος διαχειριστής πήρε τη σειρά.
    markerRow = {
      key: 'integrations.softoneResyncRun',
      value: {
        runId: 'THEIRS', actorId: 'u2', actorEmail: 'b@b.gr',
        startedAt: Date.now(), touchedAt: Date.now(), expected: ['items'], done: [],
      },
    };

    // Η δεύτερη κλήση του ΔΙΚΟΥ μας περάσματος δεν πρέπει να τους πάρει την κλειδαριά:
    // ο δείκτης ανήκει πια σε εκείνους, άρα παίρνουμε «τρέχει ήδη».
    await expect(
      resyncAllSoftone(ACTOR, { only: ['items'], run: { id: 'MINE', tables: ['vat', 'items'] } }),
    ).rejects.toBeInstanceOf(ResyncBusyError);
    expect((markerRow!.value as { runId: string }).runId).toBe('THEIRS');
  });

  it('δύο αιτήματα πάνω στον ΙΔΙΟ ξεχασμένο δείκτη: μόνο ένα τον παίρνει', async () => {
    const stale = {
      runId: 'OLD', actorId: 'u9', actorEmail: 'old@b.gr',
      startedAt: Date.now() - 60 * 60 * 1000, touchedAt: Date.now() - 60 * 60 * 1000,
      expected: ['items'] as SyncTable[], done: [],
    };
    markerRow = { key: 'integrations.softoneResyncRun', value: stale };

    const [a, b] = await Promise.allSettled([
      resyncAllSoftone(ACTOR, { only: ['vat'], run: { id: 'A', tables: ['vat', 'items'] } }),
      resyncAllSoftone({ id: 'u2', email: 'b@b.gr' }, { only: ['vat'], run: { id: 'B', tables: ['vat', 'items'] } }),
    ]);
    const won = [a, b].filter((r) => r.status === 'fulfilled');
    const lost = [a, b].filter((r) => r.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(ResyncBusyError);
  });

  it('το μήνυμα «τρέχει ήδη» λέει και πόσο κρατάει ο δείκτης', async () => {
    await resyncAllSoftone(ACTOR, { only: ['vat'], run: { id: 'X', tables: ['vat', 'items'] } });
    const err = await resyncAllSoftone({ id: 'u2', email: 'b@b.gr' }, { only: ['items'] })
      .then(() => null, (e: Error) => e);
    expect(err).toBeInstanceOf(ResyncBusyError);
    expect(err!.message).toMatch(/15 λεπτά/);
  });

  it('το ΜΕΜΟΝΩΜΕΝΟ route απαντά 409 όσο τρέχει πέρασμα', async () => {
    await resyncAllSoftone(ACTOR, { only: ['vat'], run: { id: 'X', tables: ['vat', 'items'] } });
    const res = await syncItemsRoute();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'sync_running' });
    expect(s1.softoneFetchItems).not.toHaveBeenCalled();
  });
});

describe('ελλιπείς ρυθμίσεις', () => {
  it('δεν χρεώνονται στον ERP: errorSource = configuration και 400', async () => {
    s1.softoneFetchItems.mockRejectedValue(new errs.SoftoneConfigError('Λείπουν ρυθμίσεις SoftOne: Password'));
    const report = await resyncAllSoftone(ACTOR, { only: ['items'] });
    expect(report.results[0]).toMatchObject({ ok: false, errorSource: 'configuration' });

    s1.softoneFetchItems.mockRejectedValue(new errs.SoftoneConfigError('Λείπουν ρυθμίσεις SoftOne: Password'));
    const res = await syncItemsRoute();
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'softone_not_configured', message: expect.stringContaining('Password') });
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// Λογιστικό σχέδιο (ACNT) και λογαριασμός χρεοπίστωσης
// ─────────────────────────────────────────────────────────────────────────────

describe('λογιστικό σχέδιο — ο καθρέφτης δεν αδειάζει ποτέ σε κακή απάντηση', () => {
  it('ΑΠΟΤΥΧΙΑ του GetTable ⇒ αποτυχία βήματος, καμία διαγραφή, καμία σφραγίδα', async () => {
    s1.softoneFetchAccounts.mockRejectedValue(new errs.SoftoneError('GetTable ACNT απέτυχε: Ole exception'));
    const report = await resyncAllSoftone(ACTOR, { only: ['accounts'] });
    expect(report.results[0]).toMatchObject({ table: 'accounts', ok: false, errorSource: 'softone' });
    expect(report.results[0].error).toMatch(/ACNT/);
    expect(db.softoneAccount.deleteMany).not.toHaveBeenCalled();
    expect(db.softoneAccount.createMany).not.toHaveBeenCalled();
    expect(settings.setSetting).not.toHaveBeenCalled();
  });

  it('ΑΔΕΙΑ απάντηση ⇒ αποτυχία βήματος, ο υπάρχων καθρέφτης μένει ανέγγιχτος', async () => {
    s1.softoneFetchAccounts.mockResolvedValue([]);
    const report = await resyncAllSoftone(ACTOR, { only: ['accounts'] });
    expect(report.results[0]).toMatchObject({ ok: false, errorSource: 'softone' });
    expect(report.results[0].error).toMatch(/Δεν επιστράφηκαν λογαριασμοί/);
    expect(db.softoneAccount.deleteMany).not.toHaveBeenCalled();
    expect(settings.setSetting).not.toHaveBeenCalled();
  });

  it('κανονική απάντηση ⇒ ολική αντικατάσταση μέσα σε transaction, με γονικό κωδικό', async () => {
    const report = await resyncAllSoftone(ACTOR, { only: ['accounts'] });
    expect(report.results[0]).toMatchObject({ ok: true, created: 2 });
    expect(db.$transaction).toHaveBeenCalled();
    expect(db.softoneAccount.deleteMany).toHaveBeenCalledTimes(1);
    const rows = db.softoneAccount.createMany.mock.calls[0][0].data;
    expect(rows).toEqual([
      expect.objectContaining({ code: '62', parentCode: null, grade: 1 }),
      expect.objectContaining({ code: '62.04.00.0024', parentCode: '62.04.00', name: 'Ενοίκια 24%' }),
    ]);
    expect(settings.setSetting).toHaveBeenCalledWith('integrations.softoneAccountsLastSync', expect.any(String), ACTOR.id);
  });

  it('διπλός κωδικός ⇒ κρατιέται ο πρώτος, ο δεύτερος μετράει ως skipped', async () => {
    s1.softoneFetchAccounts.mockResolvedValue([
      { acnt: 1, code: '62', name: 'Α', grade: 1, sodtype: 89, isActive: true },
      { acnt: 9, code: '62', name: 'Β', grade: 1, sodtype: 89, isActive: true },
    ]);
    const report = await resyncAllSoftone(ACTOR, { only: ['accounts'] });
    expect(report.results[0]).toMatchObject({ ok: true, created: 1, skipped: 1 });
  });
});

describe('χρεοπιστώσεις — ο λογαριασμός γενικής και η σφραγίδα ανάγνωσής του', () => {
  it('γράφει ACNMSK και acnmskSyncedAt, ώστε «κενό» να ξεχωρίζει από «άγνωστο»', async () => {
    s1.softoneFetchLineItems.mockResolvedValue([
      { mtrl: 777, code: 'ΧΡ01', name: 'ΕΝΟΙΚΙΑ', vat: '1', mtrType: 0, mtrCategory: 5, classType: null, classCategory: null, myDataCode: null, myDataVprc: null, acnmsk: '62.04.00.0024', isActive: true },
      { mtrl: 778, code: 'ΧΡ02', name: 'ΚΕΝΗ', vat: '1', mtrType: 0, mtrCategory: 5, classType: null, classCategory: null, myDataCode: null, myDataVprc: null, acnmsk: null, isActive: true },
    ]);
    await resyncAllSoftone(ACTOR, { only: ['lineitems'] });
    const [a, b] = db.softoneLineItem.upsert.mock.calls.map((c) => c[0].update);
    expect(a).toMatchObject({ acnmsk: '62.04.00.0024', acnmskSyncedAt: expect.any(Date) });
    expect(b).toMatchObject({ acnmsk: null, acnmskSyncedAt: expect.any(Date) });
  });
});
