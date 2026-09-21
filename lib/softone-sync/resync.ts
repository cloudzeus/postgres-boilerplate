// lib/softone-sync/resync.ts — SERVER. Η ΜΙΑ υλοποίηση κάθε συγχρονισμού βοηθητικού πίνακα SoftOne.
//
// ΓΙΑΤΙ `softone-sync/` ΚΑΙ ΟΧΙ `softone/`: δίπλα υπάρχει το αρχείο `lib/softone.ts`. Ένας
// φάκελος με το ίδιο όνομα τον σκιάζει: Next / vitest / build λύνουν το `@/lib/softone` στο
// αρχείο, αλλά ο `tsx` σε ESM — με τον οποίο τρέχουν ΟΛΑ τα scripts συντήρησης — πετάει
// `ERR_UNSUPPORTED_DIR_IMPORT`. Μην ξαναπάρει αυτό το όνομα ο φάκελος.
//
// Κάθε ένα από τα επτά routes `app/api/admin/metadata/sync-*-softone` καλεί από εδώ — δεν κρατάει
// δική του λογική. Έτσι το «Συγχρονισμός όλων» δεν είναι αντίγραφο επτά handlers: τρέχει ΤΙΣ ΙΔΙΕΣ
// συναρτήσεις, με την ίδια καταγραφή και τις ίδιες σφραγίδες χρόνου.
//
// ΟΛΑ είναι ΑΝΑΓΝΩΣΕΙΣ από το SoftOne (`getBrowserInfo` / `getBrowserData` / `GetTable`). Καμία
// `setData` δεν φεύγει από αυτό το αρχείο, και δεν επιτρέπεται να προστεθεί.
import 'server-only';
import { prisma } from '@/lib/db';
import { setSetting } from '@/lib/settings';
import { logAudit } from '@/lib/audit';
import {
  SoftoneConfigError,
  SoftoneError,
  softoneFetchAccounts,
  softoneFetchDocSeries,
  softoneFetchExpenses,
  softoneFetchItems,
  softoneFetchLineCategories,
  softoneFetchLineItems,
  softoneFetchLookups,
  softoneFetchMyDataClassCategories,
  softoneFetchMyDataClassTypes,
  softoneFetchCostCenters,
  softoneFetchProjectStages,
  softoneFetchProjects,
  softoneFetchPurchaseDocTypes,
  softoneFetchTraders,
  softoneFetchVatCategories,
} from '@/lib/softone';

/** Ο βοηθητικός πίνακας, όπως τον ξέρει το UI και το αποτέλεσμα του «Συγχρονισμός όλων». */
export type SyncTable =
  | 'vat' | 'lookups' | 'expenses' | 'items' | 'traders' | 'purdoc' | 'docseries'
  | 'accounts' | 'lineitems' | 'linecategories' | 'mydataclasses'
  | 'costcenters' | 'projects' | 'projectstages';

export type SyncActor = { id: string; email: string };

/** Ό,τι επιστρέφει ένας μεμονωμένος συγχρονισμός. Το `detail` κρατάει τα ανά πίνακα νούμερα. */
export type SyncPayload = {
  created: number;
  updated: number;
  /** Γραμμές που γύρισε το SoftOne αλλά ΔΕΝ γράφτηκαν (π.χ. σειρά χωρίς κωδικό). */
  skipped: number;
  total: number;
  syncedAt: string;
  detail: Record<string, unknown>;
};

/** Μια γραμμή του τελικού απολογισμού. Το ίδιο σχήμα για επιτυχία και για αποτυχία. */
export type SyncOutcome = {
  table: SyncTable;
  label: string;
  ok: boolean;
  created: number;
  updated: number;
  skipped: number;
  error: string | null;
  /** Ποιο σύστημα φταίει όταν `ok:false` — ο ERP, η τοπική βάση ή η διαμόρφωση. `null` σε επιτυχία. */
  errorSource: 'softone' | 'database' | 'configuration' | null;
  ms: number;
  detail: Record<string, unknown>;
};

export type ResyncReport = {
  ok: boolean;
  results: SyncOutcome[];
  okCount: number;
  failCount: number;
  ms: number;
  finishedAt: string;
};

const nowIso = () => new Date().toISOString();

/**
 * Άδεια απάντηση = ΑΠΟΤΥΧΙΑ του βήματος, ποτέ «μηδέν εγγραφές».
 *
 * Κάθε ένας από τους επτά συγχρονισμούς είτε αντικαθιστά ολόκληρο τον πίνακα είτε σβήνει/
 * απενεργοποιεί ό,τι δεν γύρισε ο ERP. Αν δεχτούμε ένα άδειο `rows` ως έγκυρη απάντηση, το
 * αποτέλεσμα είναι ΑΔΕΙΟ ΜΗΤΡΩΟ με `ok: true` — δηλαδή σιωπηλή καταστροφή δεδομένων ακριβώς
 * τη στιγμή που ο χρήστης νομίζει ότι συγχρονίστηκε. Πετώντας εδώ, ο ενορχηστρωτής γράφει το
 * βήμα ως αποτυχία και ΚΑΝΕΝΑ prune δεν προλαβαίνει να τρέξει.
 */
function assertNonEmpty(rows: unknown[], what: string, note = ''): void {
  if (rows.length === 0) throw new SoftoneError(`Δεν επιστράφηκαν ${what} από το SoftOne${note}`);
}

/**
 * Τρία μητρώα (έξοδα, τύποι παραστατικών αγορών, σειρές) μπορούν να είναι ΝΟΜΙΜΑ άδεια σε μια
 * εγκατάσταση. Εκεί η αυστηρότητα σημαίνει μόνιμα κόκκινο βήμα — σωστό μεν, αλλά ο διαχειριστής
 * πρέπει να το ξέρει και να μην το κυνηγάει.
 */
const MAY_BE_EMPTY = ' (αν η εγκατάσταση όντως δεν έχει, το βήμα θα μένει κόκκινο — δεν είναι βλάβη)';

/**
 * Ποιο σύστημα φταίει. Οι ελλιπείς ρυθμίσεις σύνδεσης ΔΕΝ είναι φταίξιμο του ERP (ούτε της
 * βάσης): είναι διαμόρφωση, και γι' αυτό απαντούν 400 αντί για 502.
 */
function errorSourceOf(e: unknown): NonNullable<SyncOutcome['errorSource']> {
  if (e instanceof SoftoneConfigError) return 'configuration';
  return e instanceof SoftoneError ? 'softone' : 'database';
}

// ─────────────────────────────────────────────────────────────────────────────
// ΦΠΑ (VatCategory)
// ─────────────────────────────────────────────────────────────────────────────

export async function syncVatCategories(actor: SyncActor): Promise<SyncPayload> {
  const rows = await softoneFetchVatCategories();
  assertNonEmpty(rows, 'κατηγορίες ΦΠΑ');

  // Φωτογραφία του μητρώου (με το πλήθος εταιριών που το δείχνουν) ΠΡΙΝ τον συγχρονισμό.
  const before = await prisma.vatCategory.findMany({
    select: { code: true, _count: { select: { companies: true } } },
  });
  const existingCodes = new Set(before.map((v) => v.code));
  const activeCodes = new Set(rows.map((r) => r.code).filter(Boolean));

  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const r of rows) {
    if (!r.code) { skipped++; continue; }
    const orderNum = Number.isFinite(Number(r.code)) ? Number(r.code) : 0;
    await prisma.vatCategory.upsert({
      where: { code: r.code },
      update: { descr: r.name || r.code, rate: r.percent, isActive: true, order: orderNum },
      create: { code: r.code, descr: r.name || r.code, rate: r.percent, isActive: true, order: orderNum },
    });
    if (existingCodes.has(r.code)) updated++; else created++;
  }

  // Ό,τι δεν είναι πια ενεργή κατηγορία SoftOne: διαγραφή αν δεν τη δείχνει κανείς,
  // αλλιώς απενεργοποίηση — μια εταιρία που τη χρησιμοποιεί δεν επιτρέπεται να μείνει ορφανή.
  let removed = 0;
  let disabled = 0;
  for (const v of before) {
    if (activeCodes.has(v.code)) continue;
    if (v._count.companies === 0) {
      await prisma.vatCategory.delete({ where: { code: v.code } });
      removed++;
    } else {
      await prisma.vatCategory.update({ where: { code: v.code }, data: { isActive: false } });
      disabled++;
    }
  }

  const syncedAt = nowIso();
  await setSetting('integrations.softoneVatLastSync', syncedAt, actor.id);
  await logAudit({
    userId: actor.id, userEmail: actor.email,
    action: 'metadata.vat.sync_softone', resource: 'setting',
    metadata: { total: created + updated, created, updated, removed, disabled },
  });

  return { created, updated, skipped, total: created + updated, syncedAt, detail: { removed, disabled } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Βοηθητικοί πίνακες (SoftoneLookup): ΦΠΑ, μονάδες, ομάδες, κατηγορίες, κατασκευαστές, μάρκες
// ─────────────────────────────────────────────────────────────────────────────

export async function syncLookups(actor: SyncActor): Promise<SyncPayload> {
  const { rows, failed } = await softoneFetchLookups();
  assertNonEmpty(rows, 'βοηθητικοί πίνακες');

  // Ο πίνακας `SoftoneLookup` κουβαλάει ΕΞΙ διαφορετικά είδη (ΦΠΑ, μονάδες, ομάδες, κατηγορίες,
  // κατασκευαστές, μάρκες). Παλιά η αποτυχία ενός από αυτά καταπινόταν και το βήμα έσβηνε
  // ΟΛΟΚΛΗΡΟ τον πίνακα για να τον ξαναγράψει χωρίς εκείνο το είδος: δηλαδή το ίδιο «άδειασμα
  // μητρώου με ok: true» που κλείσαμε στον ΦΠΑ, μία στάθμη πιο κάτω.
  //
  //  • Είδος που ΔΕΝ απάντησε και είχε ήδη δεδομένα ⇒ αποτυχία βήματος, τίποτα δεν γράφεται.
  //  • Είδος που ΔΕΝ απάντησε και ήταν ούτως ή άλλως άδειο (π.χ. εγκατάσταση χωρίς μάρκες)
  //    ⇒ αγνοείται· δεν το αγγίζουμε καν.
  //  • Καθαρίζονται ΜΟΝΟ τα είδη που απάντησαν.
  const before = await prisma.softoneLookup.groupBy({ by: ['kind'], _count: { _all: true } });
  const had = new Map(before.map((b) => [b.kind, b._count._all]));
  const lost = failed.filter((k) => (had.get(k) ?? 0) > 0);
  if (lost.length > 0) {
    throw new SoftoneError(
      `Δεν απάντησαν οι βοηθητικοί πίνακες: ${lost.join(', ')} — το μητρώο δεν αντικαταστάθηκε`,
    );
  }

  const syncedKinds = Array.from(new Set(rows.map((r) => r.kind)));
  const data = rows.map((r, i) => ({ kind: r.kind, code: r.code, name: r.name, order: i }));
  const total = await prisma.$transaction(async (tx) => {
    await tx.softoneLookup.deleteMany({ where: { kind: { in: syncedKinds } } });
    let n = 0;
    for (let i = 0; i < data.length; i += 1000) {
      const res = await tx.softoneLookup.createMany({ data: data.slice(i, i + 1000) });
      n += res.count;
    }
    return n;
  }, { timeout: 30000 });

  const byKind = rows.reduce<Record<string, number>>((a, r) => { a[r.kind] = (a[r.kind] ?? 0) + 1; return a; }, {});
  const syncedAt = nowIso();
  await setSetting('integrations.softoneLookupsLastSync', syncedAt, actor.id);
  await logAudit({
    userId: actor.id, userEmail: actor.email,
    action: 'metadata.lookups.sync_softone', resource: 'setting', metadata: { total, byKind, notAnswered: failed },
  });

  // Κάθε είδος που απάντησε αντικαθίσταται ολόκληρο — δεν υπάρχει «νέο» και «ενημερωμένο».
  // Τα είδη που δεν απάντησαν (και ήταν άδεια) αναφέρονται ρητά, για να μη θεωρηθεί ότι τα είδαμε.
  return {
    created: total, updated: 0, skipped: rows.length - total, total, syncedAt,
    detail: { byKind, ...(failed.length ? { notAnswered: failed } : {}) },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Έξοδα (SoftoneExpense)
// ─────────────────────────────────────────────────────────────────────────────

export async function syncExpenses(actor: SyncActor): Promise<SyncPayload> {
  const rows = await softoneFetchExpenses();
  assertNonEmpty(rows, 'έξοδα', MAY_BE_EMPTY);

  const existing = new Set((await prisma.softoneExpense.findMany({ select: { expn: true } })).map((v) => v.expn));
  const activeExpn = rows.map((r) => r.expn);

  let created = 0;
  let updated = 0;
  const now = new Date();
  for (const r of rows) {
    // Ο χαρακτηρισμός myDATA ζει στο ΜΗΤΡΩΟ, όχι στη γραμμή παραστατικού: τον καθρεφτίζουμε ώστε
    // η εφαρμογή να δείχνει πώς θα χαρακτηριστεί μια γραμμή. Το EXPN κρατά δύο ζεύγη — εσόδων και
    // εξόδων (…X)· για παραστατικά που ΛΑΜΒΑΝΟΥΜΕ ισχύει το ζεύγος των εξόδων.
    const cls = {
      classType: r.classType, classTypeX: r.classTypeX,
      classCategory: r.classCategory, classCategoryX: r.classCategoryX, myDataVprc: r.myDataVprc,
    };
    await prisma.softoneExpense.upsert({
      where: { expn: r.expn },
      update: { code: r.code, name: r.name || r.code, vat: r.vat, isActive: true, syncedAt: now, ...cls },
      create: { expn: r.expn, code: r.code, name: r.name || r.code, vat: r.vat, isActive: true, syncedAt: now, ...cls },
    });
    if (existing.has(r.expn)) updated++; else created++;
  }

  // Ποτέ διαγραφή: γραμμές παραστατικών μπορεί να δείχνουν ακόμη εκεί.
  const deactivated = (await prisma.softoneExpense.updateMany({
    where: { expn: { notIn: activeExpn }, isActive: true },
    data: { isActive: false },
  })).count;

  const syncedAt = now.toISOString();
  await setSetting('integrations.softoneExpensesLastSync', syncedAt, actor.id);
  await logAudit({
    userId: actor.id, userEmail: actor.email,
    action: 'metadata.expenses.sync_softone', resource: 'setting',
    metadata: { total: created + updated, created, updated, deactivated },
  });

  return { created, updated, skipped: 0, total: created + updated, syncedAt, detail: { deactivated } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Είδη & υπηρεσίες (SoftoneItem)
// ─────────────────────────────────────────────────────────────────────────────

export async function syncItems(actor: SyncActor): Promise<SyncPayload> {
  const rows = await softoneFetchItems();
  assertNonEmpty(rows, 'είδη');

  const data = rows.map((r) => ({
    mtrl: r.mtrl, code: r.code, code1: r.code1, code2: r.code2,
    name: r.name || r.code, name2: r.name2, price: r.price, isService: r.isService, isActive: r.isActive,
    // MYDATACODE του μητρώου — ο χαρακτηρισμός που στέλνεται στις γραμμές ειδών/υπηρεσιών/παγίων.
    myDataCode: r.myDataCode,
  }));

  const total = await prisma.$transaction(async (tx) => {
    await tx.softoneItem.deleteMany({});
    let n = 0;
    for (let i = 0; i < data.length; i += 1000) {
      const res = await tx.softoneItem.createMany({ data: data.slice(i, i + 1000) });
      n += res.count;
    }
    return n;
  }, { timeout: 30000 });

  const products = data.filter((d) => !d.isService).length;
  const services = data.length - products;
  const syncedAt = nowIso();
  await setSetting('integrations.softoneItemsLastSync', syncedAt, actor.id);
  await logAudit({
    userId: actor.id, userEmail: actor.email,
    action: 'metadata.items.sync_softone', resource: 'setting', metadata: { total, products, services },
  });

  return { created: total, updated: 0, skipped: rows.length - total, total, syncedAt, detail: { products, services } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Συναλλασσόμενοι (SoftoneTrader)
// ─────────────────────────────────────────────────────────────────────────────

export async function syncTraders(actor: SyncActor): Promise<SyncPayload> {
  const rows = await softoneFetchTraders();
  assertNonEmpty(rows, 'συναλλασσόμενοι');

  const data = rows.map((r) => ({
    trdr: r.trdr, sodtype: r.sodtype, kind: r.kind, code: r.code, name: r.name || r.code,
    afm: r.afm, doy: r.doy, profession: r.profession,
    address: r.address, district: r.district, zip: r.zip, city: r.city,
    phone: r.phone, phone2: r.phone2, fax: r.fax, email: r.email, webpage: r.webpage, isActive: r.isActive,
  }));

  const total = await prisma.$transaction(async (tx) => {
    await tx.softoneTrader.deleteMany({});
    let n = 0;
    for (let i = 0; i < data.length; i += 1000) {
      const res = await tx.softoneTrader.createMany({ data: data.slice(i, i + 1000) });
      n += res.count;
    }
    return n;
  }, { timeout: 60000 });

  const byType: Record<string, number> = {};
  for (const r of rows) byType[r.kind] = (byType[r.kind] ?? 0) + 1;

  const syncedAt = nowIso();
  await setSetting('integrations.softoneTradersLastSync', syncedAt, actor.id);
  await logAudit({
    userId: actor.id, userEmail: actor.email,
    action: 'metadata.traders.sync_softone', resource: 'setting', metadata: { total, byType },
  });

  return { created: total, updated: 0, skipped: rows.length - total, total, syncedAt, detail: { byType } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Τύποι παραστατικών αγορών (PurchaseDocType)
// ─────────────────────────────────────────────────────────────────────────────

export async function syncPurchaseDocTypes(actor: SyncActor): Promise<SyncPayload> {
  const rows = await softoneFetchPurchaseDocTypes();
  assertNonEmpty(rows, 'τύποι παραστατικών αγορών', MAY_BE_EMPTY);

  const existingCodes = new Set(
    (await prisma.purchaseDocType.findMany({ select: { code: true } })).map((v) => v.code),
  );
  const activeCodes = new Set(rows.map((r) => r.code).filter(Boolean));

  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const r of rows) {
    if (!r.code) { skipped++; continue; }
    const orderNum = Number.isFinite(Number(r.code)) ? Number(r.code) : 0;
    await prisma.purchaseDocType.upsert({
      where: { code: r.code },
      update: { abbrev: r.abbrev, name: r.name || r.code, section: r.section, isActive: true, order: orderNum },
      create: { code: r.code, abbrev: r.abbrev, name: r.name || r.code, section: r.section, isActive: true, order: orderNum },
    });
    if (existingCodes.has(r.code)) updated++; else created++;
  }

  // Δεύτερη δικλείδα, μετά τον `assertNonEmpty`: γραμμές ΧΩΡΙΣ κωδικό μετριούνται ως
  // `skipped`, οπότε ένα μη άδειο `rows` μπορεί να δώσει άδειο `activeCodes` — και πάλι
  // δεν επιτρέπεται να σβήσει το μητρώο.
  let removed = 0;
  if (activeCodes.size > 0) {
    const res = await prisma.purchaseDocType.deleteMany({ where: { code: { notIn: Array.from(activeCodes) } } });
    removed = res.count;
  }

  const syncedAt = nowIso();
  await setSetting('integrations.softonePurdocLastSync', syncedAt, actor.id);
  await logAudit({
    userId: actor.id, userEmail: actor.email,
    action: 'metadata.purdoc.sync_softone', resource: 'setting',
    metadata: { total: created + updated, created, updated, removed },
  });

  return { created, updated, skipped, total: created + updated, syncedAt, detail: { removed } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Σειρές παραστατικών (SoftoneDocSeries)
// ─────────────────────────────────────────────────────────────────────────────

export async function syncDocSeries(actor: SyncActor): Promise<SyncPayload> {
  const rows = await softoneFetchDocSeries();
  assertNonEmpty(rows, 'σειρές παραστατικών', MAY_BE_EMPTY);

  const existing = new Set(
    (await prisma.softoneDocSeries.findMany({ select: { sosource: true, code: true } }))
      .map((v) => `${v.sosource}:${v.code}`),
  );

  let created = 0;
  let updated = 0;
  for (const r of rows) {
    const orderNum = Number.isFinite(Number(r.code)) ? Number(r.code) : 0;
    await prisma.softoneDocSeries.upsert({
      where: { sosource_code: { sosource: r.sosource, code: r.code } },
      update: { family: r.family, abbrev: r.abbrev, name: r.name, section: r.section, isActive: true, order: orderNum },
      create: { sosource: r.sosource, family: r.family, code: r.code, abbrev: r.abbrev, name: r.name, section: r.section, isActive: true, order: orderNum },
    });
    if (existing.has(`${r.sosource}:${r.code}`)) updated++; else created++;
  }

  // Δεύτερη δικλείδα, μετά τον `assertNonEmpty`.
  let removed = 0;
  if (rows.length > 0) {
    const keep = new Set(rows.map((r) => `${r.sosource}:${r.code}`));
    const all = await prisma.softoneDocSeries.findMany({ select: { id: true, sosource: true, code: true } });
    const staleIds = all.filter((v) => !keep.has(`${v.sosource}:${v.code}`)).map((v) => v.id);
    if (staleIds.length > 0) {
      removed = (await prisma.softoneDocSeries.deleteMany({ where: { id: { in: staleIds } } })).count;
    }
  }

  const families = Array.from(new Set(rows.map((r) => r.family))).sort();
  const syncedAt = nowIso();
  await setSetting('integrations.softoneDocSeriesLastSync', syncedAt, actor.id);
  await logAudit({
    userId: actor.id, userEmail: actor.email,
    action: 'metadata.docseries.sync_softone', resource: 'setting',
    metadata: { total: created + updated, created, updated, removed, families },
  });

  return { created, updated, skipped: 0, total: created + updated, syncedAt, detail: { removed, families } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Χρεοπιστώσεις (LINEITEM → MTRL SODTYPE 53) — το `MTRL` των γραμμών LINLINES
// ─────────────────────────────────────────────────────────────────────────────

export async function syncLineItems(actor: SyncActor): Promise<SyncPayload> {
  const rows = await softoneFetchLineItems();
  assertNonEmpty(rows, 'χρεοπιστώσεις', MAY_BE_EMPTY);

  const existing = new Set((await prisma.softoneLineItem.findMany({ select: { mtrl: true } })).map((v) => v.mtrl));
  const now = new Date();
  let created = 0;
  let updated = 0;
  for (const r of rows) {
    const data = {
      code: r.code, name: r.name || r.code, vat: r.vat, mtrType: r.mtrType, mtrCategory: r.mtrCategory,
      classType: r.classType, classCategory: r.classCategory, myDataCode: r.myDataCode,
      myDataVprc: r.myDataVprc, isActive: true, syncedAt: now,
      // Ο λογαριασμός γενικής ΚΑΙ η σφραγίδα ότι τον διαβάσαμε: χωρίς τη σφραγίδα, ένα `null` δεν
      // ξεχωρίζει το «κενό στο SoftOne» από το «δεν έχει συγχρονιστεί ακόμη».
      acnmsk: r.acnmsk, acnmskSyncedAt: now,
    };
    await prisma.softoneLineItem.upsert({ where: { mtrl: r.mtrl }, update: data, create: { mtrl: r.mtrl, ...data } });
    if (existing.has(r.mtrl)) updated++; else created++;
  }

  // Ποτέ διαγραφή: γραμμές παραστατικών μπορεί να δείχνουν ακόμη εκεί.
  const deactivated = (await prisma.softoneLineItem.updateMany({
    where: { mtrl: { notIn: rows.map((r) => r.mtrl) }, isActive: true },
    data: { isActive: false },
  })).count;

  const syncedAt = now.toISOString();
  await setSetting('integrations.softoneLineItemsLastSync', syncedAt, actor.id);
  await logAudit({
    userId: actor.id, userEmail: actor.email,
    action: 'metadata.lineitems.sync_softone', resource: 'setting',
    metadata: { total: created + updated, created, updated, deactivated },
  });

  return { created, updated, skipped: 0, total: created + updated, syncedAt, detail: { deactivated } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Λογιστικό σχέδιο (ACNT → SoftoneAccount)
// ─────────────────────────────────────────────────────────────────────────────

/** «61.02.00.0024» → «61.02.00». Πρωτοβάθμιος (χωρίς τελεία) → null. */
export const parentCodeOf = (code: string): string | null => {
  const i = code.lastIndexOf('.');
  return i > 0 ? code.slice(0, i) : null;
};

/**
 * Ολική αντικατάσταση του καθρέφτη, μέσα σε transaction — όπως τα είδη και οι συναλλασσόμενοι.
 * Ένας λογαριασμός που ΣΒΗΣΤΗΚΕ στο ERP πρέπει να φύγει κι από εδώ: αν έμενε «ανενεργός», ο
 * έλεγχος θα έλεγε «υπάρχει» για λογαριασμό όπου το SoftOne δεν μπορεί πια να γράψει.
 *
 * ΔΥΟ δικλείδες πριν αγγίξουμε οτιδήποτε, γιατί ένας άδειος καθρέφτης ΔΕΝ είναι αθώος: ο έλεγχος
 * τον διαβάζει ως «δεν έχει συγχρονιστεί» και σταματά να προστατεύει (βλ. `lib/ocr/account-check.ts`).
 *  1. άδεια απάντηση ⇒ αποτυχία βήματος (`assertNonEmpty`), κανένα delete·
 *  2. απάντηση όπου ΚΑΜΙΑ γραμμή δεν έχει κωδικό ⇒ το ίδιο.
 * Αποτυχία του GetTable πετάει ήδη από το `softoneFetchAccounts`, πριν από το transaction.
 */
/** Κάτω από αυτό το κλάσμα του τρέχοντος καθρέφτη, η απάντηση θεωρείται ελλιπής. */
export const ACCOUNTS_MIN_RATIO = 0.5;

export async function syncAccounts(actor: SyncActor): Promise<SyncPayload> {
  const rows = await softoneFetchAccounts();
  assertNonEmpty(rows, 'λογαριασμοί λογιστικού σχεδίου');

  // Ο κωδικός είναι μοναδικός στο ACNT του πελάτη (επαληθευμένο). Αν ποτέ δεν είναι, κρατάμε τον
  // πρώτο και μετράμε τους υπόλοιπους ως `skipped` αντί να σκάσει ολόκληρο το βήμα.
  const seen = new Set<string>();
  const data = [] as {
    acnt: number; code: string; name: string; grade: number | null; parentCode: string | null;
    sodtype: number | null; postable: boolean | null; isActive: boolean; syncedAt: Date;
  }[];
  const now = new Date();
  for (const r of rows) {
    if (seen.has(r.code)) continue;
    seen.add(r.code);
    data.push({
      acnt: r.acnt, code: r.code, name: r.name || r.code, grade: r.grade,
      parentCode: parentCodeOf(r.code), sodtype: r.sodtype, postable: r.postable, isActive: r.isActive, syncedAt: now,
    });
  }
  assertNonEmpty(data, 'λογαριασμοί με κωδικό');

  // Τρίτη δικλείδα: «κοντή» απάντηση. Η ίδια η απάντηση ελέγχεται ήδη έναντι του `count` της
  // (`parseAccountsResponse`)· εδώ συγκρίνουμε με το ΤΡΕΧΟΝ μέγεθος του καθρέφτη. Ένα λογιστικό
  // σχέδιο δεν χάνει τους μισούς λογαριασμούς του από τη μια μέρα στην άλλη — αν συμβεί, το βλέπει
  // άνθρωπος πριν αντικατασταθεί ο καθρέφτης, όχι μετά.
  const current = await prisma.softoneAccount.count();
  if (current > 0 && data.length < current * ACCOUNTS_MIN_RATIO) {
    throw new SoftoneError(
      `Το SoftOne επέστρεψε ${data.length} λογαριασμούς ενώ το αντίγραφο έχει ${current} — `
      + 'πιθανώς ελλιπής απάντηση· το λογιστικό σχέδιο δεν αντικαταστάθηκε',
    );
  }

  const total = await prisma.$transaction(async (tx) => {
    await tx.softoneAccount.deleteMany({});
    let n = 0;
    for (let i = 0; i < data.length; i += 1000) {
      n += (await tx.softoneAccount.createMany({ data: data.slice(i, i + 1000) })).count;
    }
    return n;
  }, { timeout: 60000 });

  const byGrade = data.reduce<Record<string, number>>((a, r) => {
    const k = String(r.grade ?? '—'); a[k] = (a[k] ?? 0) + 1; return a;
  }, {});
  const syncedAt = now.toISOString();
  await setSetting('integrations.softoneAccountsLastSync', syncedAt, actor.id);
  await logAudit({
    userId: actor.id, userEmail: actor.email,
    action: 'metadata.accounts.sync_softone', resource: 'setting', metadata: { total, byGrade },
  });

  return { created: total, updated: 0, skipped: rows.length - total, total, syncedAt, detail: { byGrade } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Κατηγορίες δαπανών (LINCATEGORY → MTRCATEGORY SODTYPE 53)
// ─────────────────────────────────────────────────────────────────────────────

export async function syncLineCategories(actor: SyncActor): Promise<SyncPayload> {
  // Επιτρέπουμε ρητά την εφεδρεία χωρίς SODTYPE — αλλά ΔΕΝ την κρύβουμε: κάθε γραμμή που ήρθε
  // από αυτήν σημαδεύεται `sodtypeFiltered: false` και το UI το γράφει.
  const { rows, filtered } = await softoneFetchLineCategories({ allowUnfiltered: true });
  assertNonEmpty(rows, 'κατηγορίες δαπανών', MAY_BE_EMPTY);

  const existing = new Set(
    (await prisma.softoneLineCategory.findMany({ select: { mtrCategory: true } })).map((v) => v.mtrCategory),
  );
  const now = new Date();
  let created = 0;
  let updated = 0;
  for (const r of rows) {
    const data = {
      code: r.code, name: r.name || r.code, vat: r.vat, acnmsk: r.acnmsk,
      // `filtered: false` = η εγκατάσταση δεν εξέθεσε SODTYPE, άρα ΔΕΝ ξέρουμε ότι είναι
      // κατηγορίες ΔΑΠΑΝΩΝ. Σημαδεύουμε τη γραμμή αντί να την περάσουμε για επιβεβαιωμένη.
      sodtypeFiltered: filtered, isActive: true, syncedAt: now,
    };
    await prisma.softoneLineCategory.upsert({
      where: { mtrCategory: r.mtrCategory }, update: data, create: { mtrCategory: r.mtrCategory, ...data },
    });
    if (existing.has(r.mtrCategory)) updated++; else created++;
  }

  const deactivated = (await prisma.softoneLineCategory.updateMany({
    where: { mtrCategory: { notIn: rows.map((r) => r.mtrCategory) }, isActive: true },
    data: { isActive: false },
  })).count;

  const syncedAt = now.toISOString();
  await setSetting('integrations.softoneLineCategoriesLastSync', syncedAt, actor.id);
  await logAudit({
    userId: actor.id, userEmail: actor.email,
    action: 'metadata.linecategories.sync_softone', resource: 'setting',
    metadata: { total: created + updated, created, updated, deactivated, sodtypeFiltered: filtered },
  });

  return { created, updated, skipped: 0, total: created + updated, syncedAt, detail: { deactivated, sodtypeFiltered: filtered } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Λίστες χαρακτηρισμού myDATA (EditLists MYDATACLTYPE / MYDATACLCATEGORY)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Μητρώα ΑΝΑΦΟΡΑΣ: εξηγούν τι σημαίνει ο χαρακτηρισμός που κουβαλά κάθε είδος / υπηρεσία /
 * χρεοπίστωση / έξοδο. Οι δύο λίστες είναι ζεύγος και συγχρονίζονται μαζί.
 */
export async function syncMyDataClasses(actor: SyncActor): Promise<SyncPayload> {
  const [types, categories] = await Promise.all([
    softoneFetchMyDataClassTypes(),
    softoneFetchMyDataClassCategories(),
  ]);
  if (types.length === 0 && categories.length === 0) {
    assertNonEmpty([], 'χαρακτηρισμοί myDATA');
  }

  const now = new Date();
  const seenTypes = new Set(
    (await prisma.softoneMyDataClassType.findMany({ select: { sotype: true, code: true } })).map((v) => `${v.sotype}:${v.code}`),
  );
  const seenCategories = new Set(
    (await prisma.softoneMyDataClassCategory.findMany({ select: { sotype: true, code: true } })).map((v) => `${v.sotype}:${v.code}`),
  );
  let created = 0;
  let updated = 0;

  for (const r of types) {
    const data = { myDataCode: r.myDataCode, sohCode: r.sohCode, name: r.name, isVat: r.isVat ?? false, syncedAt: now };
    await prisma.softoneMyDataClassType.upsert({
      where: { sotype_code: { sotype: r.sotype, code: r.code } },
      update: data, create: { sotype: r.sotype, code: r.code, ...data },
    });
    if (seenTypes.has(`${r.sotype}:${r.code}`)) updated++; else created++;
  }
  for (const r of categories) {
    const data = { myDataCode: r.myDataCode, sohCode: r.sohCode, name: r.name, syncedAt: now };
    await prisma.softoneMyDataClassCategory.upsert({
      where: { sotype_code: { sotype: r.sotype, code: r.code } },
      update: data, create: { sotype: r.sotype, code: r.code, ...data },
    });
    if (seenCategories.has(`${r.sotype}:${r.code}`)) updated++; else created++;
  }

  const syncedAt = now.toISOString();
  await setSetting('integrations.softoneMyDataClassesLastSync', syncedAt, actor.id);
  await logAudit({
    userId: actor.id, userEmail: actor.email,
    action: 'metadata.mydataclasses.sync_softone', resource: 'setting',
    metadata: { types: types.length, categories: categories.length },
  });

  return {
    created, updated, skipped: 0, total: types.length + categories.length, syncedAt,
    detail: { types: types.length, categories: categories.length },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Αναλυτική ανά γραμμή: κέντρα κόστους, έργα, δραστηριότητες
// ─────────────────────────────────────────────────────────────────────────────

export async function syncCostCenters(actor: SyncActor): Promise<SyncPayload> {
  const rows = await softoneFetchCostCenters();
  assertNonEmpty(rows, 'κέντρα κόστους', MAY_BE_EMPTY);

  const existing = new Set((await prisma.softoneCostCenter.findMany({ select: { costcntr: true } })).map((v) => v.costcntr));
  const now = new Date();
  let created = 0;
  let updated = 0;
  for (const r of rows) {
    const data = {
      code: r.code, name: r.name, name2: r.name2, sohCode: r.sohCode, acnmsk: r.acnmsk,
      isActive: true, syncedAt: now,
    };
    await prisma.softoneCostCenter.upsert({ where: { costcntr: r.costcntr }, update: data, create: { costcntr: r.costcntr, ...data } });
    if (existing.has(r.costcntr)) updated++; else created++;
  }
  const deactivated = (await prisma.softoneCostCenter.updateMany({
    where: { costcntr: { notIn: rows.map((r) => r.costcntr) }, isActive: true },
    data: { isActive: false },
  })).count;

  const syncedAt = now.toISOString();
  await setSetting('integrations.softoneCostCentersLastSync', syncedAt, actor.id);
  await logAudit({
    userId: actor.id, userEmail: actor.email,
    action: 'metadata.costcenters.sync_softone', resource: 'setting',
    metadata: { total: created + updated, created, updated, deactivated },
  });
  return { created, updated, skipped: 0, total: created + updated, syncedAt, detail: { deactivated } };
}

export async function syncProjects(actor: SyncActor): Promise<SyncPayload> {
  const rows = await softoneFetchProjects();
  assertNonEmpty(rows, 'έργα', MAY_BE_EMPTY);

  const existing = new Set((await prisma.softoneProject.findMany({ select: { prjc: true } })).map((v) => v.prjc));
  const now = new Date();
  let created = 0;
  let updated = 0;
  for (const r of rows) {
    const data = { code: r.code, name: r.name, trdr: r.trdr, prjType: r.prjType, isActive: true, syncedAt: now };
    await prisma.softoneProject.upsert({ where: { prjc: r.prjc }, update: data, create: { prjc: r.prjc, ...data } });
    if (existing.has(r.prjc)) updated++; else created++;
  }
  const deactivated = (await prisma.softoneProject.updateMany({
    where: { prjc: { notIn: rows.map((r) => r.prjc) }, isActive: true },
    data: { isActive: false },
  })).count;

  const syncedAt = now.toISOString();
  await setSetting('integrations.softoneProjectsLastSync', syncedAt, actor.id);
  await logAudit({
    userId: actor.id, userEmail: actor.email,
    action: 'metadata.projects.sync_softone', resource: 'setting',
    metadata: { total: created + updated, created, updated, deactivated },
  });
  return { created, updated, skipped: 0, total: created + updated, syncedAt, detail: { deactivated } };
}

export async function syncProjectStages(actor: SyncActor): Promise<SyncPayload> {
  const rows = await softoneFetchProjectStages();
  assertNonEmpty(rows, 'δραστηριότητες', MAY_BE_EMPTY);

  const existing = new Set((await prisma.softoneProjectStage.findMany({ select: { prjcStage: true } })).map((v) => v.prjcStage));
  const now = new Date();
  let created = 0;
  let updated = 0;
  for (const r of rows) {
    const data = { code: r.code, name: r.name, isActive: true, syncedAt: now };
    await prisma.softoneProjectStage.upsert({ where: { prjcStage: r.prjcStage }, update: data, create: { prjcStage: r.prjcStage, ...data } });
    if (existing.has(r.prjcStage)) updated++; else created++;
  }
  const deactivated = (await prisma.softoneProjectStage.updateMany({
    where: { prjcStage: { notIn: rows.map((r) => r.prjcStage) }, isActive: true },
    data: { isActive: false },
  })).count;

  const syncedAt = now.toISOString();
  await setSetting('integrations.softoneProjectStagesLastSync', syncedAt, actor.id);
  await logAudit({
    userId: actor.id, userEmail: actor.email,
    action: 'metadata.projectstages.sync_softone', resource: 'setting',
    metadata: { total: created + updated, created, updated, deactivated },
  });
  return { created, updated, skipped: 0, total: created + updated, syncedAt, detail: { deactivated } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ο ενορχηστρωτής
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Η σειρά εκτέλεσης — και ο λόγος της:
 *
 *  1. `vat`      Οι κατηγορίες ΦΠΑ είναι ο πιο θεμελιώδης πίνακας: έξοδα και είδη δείχνουν σε
 *                συντελεστές ΦΠΑ, όχι το αντίστροφο.
 *  2. `lookups`  Οι πίνακες ταξινόμησης (μονάδες μέτρησης, ομάδες, κατηγορίες, μάρκες) — μικροί,
 *                γρήγοροι, και το λεξιλόγιο πάνω στο οποίο διαβάζονται τα είδη.
 *  3. `expenses` Τα έξοδα κουβαλούν κωδικό ΦΠΑ· πάνε μετά το (1).
 *  4. `items`    Είδη & υπηρεσίες — ο πρώτος βαρύς πίνακας.
 *  5. `traders`  Συναλλασσόμενοι — ο βαρύτερος· τρέχει αφού έχουν κατέβει τα «φθηνά».
 *  6. `purdoc`   Τύποι παραστατικών αγορών.
 *  7. `docseries` Σειρές όλων των υπόλοιπων ενοτήτων.
 *  8. `accounts`  Λογιστικό σχέδιο (ACNT) — το λεξιλόγιο πάνω στο οποίο διαβάζεται ο λογαριασμός
 *                κάθε χρεοπίστωσης, άρα πριν από αυτές.
 *  9. `linecategories` Κατηγορίες δαπανών — η ομαδοποίηση πάνω από τις χρεοπιστώσεις, άρα πριν από αυτές.
 * 10. `lineitems` Χρεοπιστώσεις (το `MTRL` των γραμμών «Ειδικών συναλλαγών»), με τον λογαριασμό τους.
 * 11. `mydataclasses` Οι λίστες χαρακτηρισμού myDATA — καθαρή αναφορά.
 * 12-14. `costcenters` / `projects` / `projectstages` — η αναλυτική ανά γραμμή· ανεξάρτητες από
 *        όλα τα υπόλοιπα, οπότε τελευταίες.
 *
 * Τρέχουν ΣΕΙΡΙΑΚΑ και ΠΟΤΕ παράλληλα: μοιράζονται ένα session SoftOne, και επτά ταυτόχρονα
 * `getBrowserInfo` στον ίδιο ERP είναι ο πιο σίγουρος τρόπος να πέσουν όλα μαζί.
 */
export const SYNC_STEPS: { table: SyncTable; label: string; run: (actor: SyncActor) => Promise<SyncPayload> }[] = [
  { table: 'vat',       label: 'Κατηγορίες ΦΠΑ',              run: syncVatCategories },
  { table: 'lookups',   label: 'Βοηθητικοί πίνακες',          run: syncLookups },
  { table: 'expenses',  label: 'Έξοδα',                       run: syncExpenses },
  { table: 'items',     label: 'Είδη & υπηρεσίες',            run: syncItems },
  { table: 'traders',   label: 'Συναλλασσόμενοι',             run: syncTraders },
  { table: 'purdoc',    label: 'Τύποι παραστατικών αγορών',   run: syncPurchaseDocTypes },
  { table: 'docseries', label: 'Σειρές παραστατικών',         run: syncDocSeries },
  { table: 'accounts',       label: 'Λογιστικό σχέδιο',        run: syncAccounts },
  { table: 'linecategories', label: 'Κατηγορίες δαπανών',      run: syncLineCategories },
  { table: 'lineitems',      label: 'Χρεοπιστώσεις',           run: syncLineItems },
  { table: 'mydataclasses',  label: 'Χαρακτηρισμοί myDATA',    run: syncMyDataClasses },
  { table: 'costcenters',    label: 'Κέντρα κόστους',          run: syncCostCenters },
  { table: 'projects',       label: 'Έργα',                    run: syncProjects },
  { table: 'projectstages',  label: 'Δραστηριότητες',          run: syncProjectStages },
];


// ─────────────────────────────────────────────────────────────────────────────
// Ο δείκτης τρέχοντος περάσματος: κλειδαριά ΚΑΙ σωρευτής
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ΜΙΑ γραμμή `AppSetting` κρατάει το πέρασμα που τρέχει τώρα. Κάνει δύο δουλειές ταυτόχρονα:
 *
 *  1. **Κλειδαριά.** Οι βαριοί πίνακες (είδη, συναλλασσόμενοι) σβήνουν ΤΑ ΠΑΝΤΑ και ξαναγράφουν
 *     μέσα σε transaction. Δύο διαχειριστές που πατάνε μαζί το κουμπί τρέχουν δύο τέτοια
 *     ταυτόχρονα πάνω στον ίδιο πίνακα. Ο δεύτερος παίρνει πλέον σαφές «τρέχει ήδη».
 *  2. **Σωρευτής.** Το UI τρέχει έναν πίνακα ανά αίτημα (για να δείχνει πρόοδο), άρα ο server
 *     δεν βλέπει ποτέ «ολόκληρο πέρασμα» μέσα σε μία κλήση. Ο δείκτης θυμάται τι έχει ήδη
 *     ολοκληρωθεί με το ίδιο `runId`, ώστε η συγκεντρωτική εγγραφή ελέγχου να γράφεται
 *     ΠΡΑΓΜΑΤΙΚΑ όταν κλείσει ο κύκλος — και όχι ποτέ, όπως γινόταν.
 *
 * Το κλειδί ΔΕΝ είναι στον `SETTING_CATALOG`, άρα δεν εμφανίζεται ποτέ στη φόρμα ρυθμίσεων.
 */
const RUN_KEY = 'integrations.softoneResyncRun';

/** Μετά από τόση ώρα ΧΩΡΙΣ ΧΤΥΠΟ, το πέρασμα θεωρείται εγκαταλελειμμένο (κλειστή καρτέλα). */
const RUN_STALE_MS = 15 * 60 * 1000;

/** Πόσο συχνά ένα βήμα που τρέχει δηλώνει «ζω» στον δείκτη. Αρκετά μικρό ώστε ένα βαρύ βήμα
 *  να μη φαίνεται ποτέ ξεχασμένο, αρκετά μεγάλο ώστε να μη φορτώνει τη βάση. */
const HEARTBEAT_MS = 60 * 1000;

type RunStep = Pick<SyncOutcome, 'table' | 'ok' | 'error' | 'errorSource' | 'created' | 'updated' | 'skipped' | 'ms'>;

type RunMarker = {
  runId: string;
  actorId: string;
  actorEmail: string;
  startedAt: number;
  touchedAt: number;
  /** Τα βήματα που δήλωσε ο caller ότι θα τρέξει σε αυτό το πέρασμα. */
  expected: SyncTable[];
  done: RunStep[];
};

/** Το «τρέχει ήδη συγχρονισμός» — ο caller το μεταφράζει σε 409. */
export class ResyncBusyError extends Error {
  readonly code = 'sync_running';
  constructor(readonly startedAt: string, readonly byEmail: string) {
    super(
      `Ένας συγχρονισμός βοηθητικών πινάκων τρέχει ήδη (${byEmail}, από ${new Date(startedAt).toLocaleString('el-GR')}). `
      + `Περίμενε να ολοκληρωθεί και ξαναδοκίμασε· αν η καρτέλα που τον ξεκίνησε έκλεισε, `
      + `ο δείκτης ελευθερώνεται αυτόματα μετά από ${Math.round(RUN_STALE_MS / 60000)} λεπτά αδράνειας.`,
    );
    this.name = 'ResyncBusyError';
  }
}

function parseMarker(value: unknown): RunMarker | null {
  const o = typeof value === 'string' ? (() => { try { return JSON.parse(value); } catch { return null; } })() : value;
  if (!o || typeof o !== 'object') return null;
  const m = o as Partial<RunMarker>;
  if (typeof m.runId !== 'string' || !Array.isArray(m.expected) || !Array.isArray(m.done)) return null;
  return {
    runId: m.runId,
    actorId: String(m.actorId ?? ''),
    actorEmail: String(m.actorEmail ?? ''),
    startedAt: Number(m.startedAt ?? 0),
    touchedAt: Number(m.touchedAt ?? m.startedAt ?? 0),
    expected: m.expected as SyncTable[],
    done: m.done as RunStep[],
  };
}

const isUniqueViolation = (e: unknown): boolean => (e as { code?: string })?.code === 'P2002';

/**
 * «Η γραμμή του δείκτη, ΕΦΟΣΟΝ ανήκει ακόμη σε αυτό το πέρασμα.»
 *
 * Κάθε γραφή στον δείκτη περνάει από εδώ. Χωρίς τη συνθήκη `runId`, μια απελευθέρωση που
 * αργεί ξαναγράφει τον δείκτη ΑΛΛΟΥ περάσματος που εν τω μεταξύ τον πήρε ως ξεχασμένο — και
 * τότε τρέχουν δύο περάσματα μαζί πάνω στους ίδιους πίνακες, δηλαδή ακριβώς ό,τι εμποδίζει
 * η κλειδαριά.
 */
const ownedBy = (runId: string) => ({
  key: RUN_KEY,
  value: { path: ['runId'], equals: runId },
});

/**
 * Πιάνει τη σειρά. Ατομικά: το `create` πάνω σε μοναδικό `key` είναι ο μόνος τρόπος δύο
 * ταυτόχρονα αιτήματα να μη νομίσουν και τα δύο ότι είναι μόνα τους.
 */
async function claimRun(
  actor: SyncActor,
  runId: string,
  expected: SyncTable[],
): Promise<RunMarker> {
  const now = Date.now();
  const fresh: RunMarker = {
    runId, actorId: actor.id, actorEmail: actor.email,
    startedAt: now, touchedAt: now, expected, done: [],
  };

  try {
    await prisma.appSetting.create({
      data: {
        key: RUN_KEY,
        value: fresh as unknown as never,
        category: 'integrations',
        description: 'Συγχρονισμός SoftOne σε εξέλιξη (προσωρινό)',
      },
    });
    return fresh;
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
  }

  const row = await prisma.appSetting.findUnique({ where: { key: RUN_KEY } });
  const current = parseMarker(row?.value);

  // Συνέχεια του ΔΙΚΟΥ μας περάσματος: το UI στέλνει ένα αίτημα ανά πίνακα με το ίδιο runId.
  if (current && current.runId === runId) return current;

  const busy = () =>
    new ResyncBusyError(new Date(current?.startedAt || now).toISOString(), current?.actorEmail || '—');

  if (current && now - current.touchedAt < RUN_STALE_MS) throw busy();

  // Ξεχασμένος δείκτης (έκλεισε η καρτέλα, έπεσε ο server): τον παίρνουμε — αλλά ΥΠΟ ΣΥΝΘΗΚΗ.
  // Δύο αιτήματα μπορούν να διαβάσουν ταυτόχρονα τον ίδιο ξεχασμένο δείκτη· μόνο ένα επιτρέπεται
  // να τον αντικαταστήσει, και είναι εκείνο που θα βρει ακόμη μέσα το ΠΑΛΙΟ `runId`.
  const taken = current
    ? await prisma.appSetting.updateMany({ where: ownedBy(current.runId), data: { value: fresh as unknown as never } })
    : await prisma.appSetting.updateMany({ where: { key: RUN_KEY }, data: { value: fresh as unknown as never } });
  if (taken.count === 0) throw busy();
  return fresh;
}

/**
 * Χτύπος καρδιάς όσο τρέχει ένα βήμα.
 *
 * Το `touchedAt` ανανεωνόταν μόνο ΑΝΑΜΕΣΑ στα αιτήματα: ένα βήμα που ξεπερνά το
 * {@link RUN_STALE_MS} (οι συναλλασσόμενοι σε μεγάλη εγκατάσταση) έκανε τον δείκτη να φαίνεται
 * ξεχασμένος ΕΝΩ ΕΤΡΕΧΕ. Επιστρέφει τη συνάρτηση που τον σταματάει.
 */
function startHeartbeat(marker: RunMarker): () => void {
  const timer = setInterval(() => {
    void prisma.appSetting
      .updateMany({ where: ownedBy(marker.runId), data: { value: { ...marker, touchedAt: Date.now() } as unknown as never } })
      .catch(() => { /* ο χτύπος δεν σπάει ποτέ τον συγχρονισμό */ });
  }, HEARTBEAT_MS);
  // Να μην κρατάει ζωντανή τη διεργασία.
  (timer as unknown as { unref?: () => void }).unref?.();
  return () => clearInterval(timer);
}

/** Γράφει την πρόοδο· όταν κλείσει ο κύκλος σβήνει τον δείκτη και λέει αν ήταν ΠΛΗΡΕΣ πέρασμα. */
async function releaseRun(marker: RunMarker, steps: SyncOutcome[]): Promise<{ finished: boolean; full: boolean; done: RunStep[] }> {
  const done: RunStep[] = [
    ...marker.done.filter((d) => !steps.some((s) => s.table === d.table)),
    ...steps.map((s) => ({
      table: s.table, ok: s.ok, error: s.error, errorSource: s.errorSource,
      created: s.created, updated: s.updated, skipped: s.skipped, ms: s.ms,
    })),
  ];
  const covered = new Set(done.map((d) => d.table));
  const finished = marker.expected.every((t) => covered.has(t));

  // Και οι δύο γραφές είναι υπό συνθήκη `runId`: αν στο μεταξύ τον πήρε άλλο πέρασμα, δεν
  // ακουμπάμε τίποτα — ούτε σβήνουμε τη δική του κλειδαριά, ούτε γράφουμε πάνω της.
  if (finished) {
    await prisma.appSetting.deleteMany({ where: ownedBy(marker.runId) });
  } else {
    await prisma.appSetting.updateMany({
      where: ownedBy(marker.runId),
      data: { value: { ...marker, touchedAt: Date.now(), done } as unknown as never },
    });
  }

  return { finished, full: finished && SYNC_STEPS.every((s) => covered.has(s.table)), done };
}

/**
 * Τρέχει ΟΛΟΥΣ τους συγχρονισμούς, έναν-έναν, και επιστρέφει έναν απολογισμό ανά πίνακα.
 *
 * Μια αποτυχία ΔΕΝ σταματά τους υπόλοιπους: αν πέσει ο βαρύς πίνακας των συναλλασσομένων, δεν
 * υπάρχει λόγος να μείνουν ασυγχρόνιστες και οι σειρές παραστατικών. Ασφαλές να ξανατρέξει όσες
 * φορές θέλει κανείς — κάθε βήμα είναι upsert ή ολική αντικατάσταση, ποτέ προσθήκη.
 *
 * `run` είναι το πέρασμα στο οποίο ανήκει η κλήση: το UI στέλνει το ΙΔΙΟ `id` και τη ΛΙΣΤΑ των
 * πινάκων που σκοπεύει να τρέξει, ώστε ο server να ξέρει πότε έκλεισε ο κύκλος. Χωρίς αυτό, η
 * κλήση θεωρείται αυτοτελές πέρασμα (τα βήματά της και τέλος).
 *
 * Πετάει {@link ResyncBusyError} όταν τρέχει ήδη ΑΛΛΟ πέρασμα.
 */
export async function resyncAllSoftone(
  actor: SyncActor,
  opts: { only?: SyncTable[]; run?: { id: string; tables?: SyncTable[] } } = {},
): Promise<ResyncReport> {
  const steps = opts.only?.length
    ? SYNC_STEPS.filter((s) => opts.only!.includes(s.table))
    : SYNC_STEPS;

  const runId = opts.run?.id || `auto-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const expectedSet = new Set<SyncTable>(opts.run?.tables?.length ? opts.run.tables : steps.map((s) => s.table));
  const expected = SYNC_STEPS.map((s) => s.table).filter((t) => expectedSet.has(t));

  const marker = await claimRun(actor, runId, expected);
  const stopHeartbeat = startHeartbeat(marker);

  const startedAt = Date.now();
  const results: SyncOutcome[] = [];
  try {
    for (const step of steps) {
      const t0 = Date.now();
      try {
        const r = await step.run(actor);
        results.push({
          table: step.table, label: step.label, ok: true,
          created: r.created, updated: r.updated, skipped: r.skipped,
          error: null, errorSource: null, ms: Date.now() - t0, detail: { ...r.detail, total: r.total },
        });
      } catch (e) {
        results.push({
          table: step.table, label: step.label, ok: false,
          created: 0, updated: 0, skipped: 0,
          error: (e as Error).message || 'άγνωστο σφάλμα', errorSource: errorSourceOf(e),
          ms: Date.now() - t0, detail: {},
        });
      }
    }
  } catch (e) {
    // Άμυνα βάθους: τα σφάλματα των βημάτων πιάνονται ήδη μέσα στον βρόχο, οπότε εδώ φτάνει
    // μόνο κάτι απρόβλεπτο. Δεν αφήνουμε κλειδαριά πίσω μας — τη δική ΜΑΣ κλειδαριά μόνο.
    await prisma.appSetting.deleteMany({ where: ownedBy(marker.runId) }).catch(() => {});
    throw e;
  } finally {
    stopHeartbeat();
  }

  const { full, done } = await releaseRun(marker, results);

  const failCount = results.filter((r) => !r.ok).length;
  const report: ResyncReport = {
    ok: failCount === 0,
    results,
    okCount: results.length - failCount,
    failCount,
    ms: Date.now() - startedAt,
    finishedAt: nowIso(),
  };

  // Συγκεντρωτική εγγραφή ΜΟΝΟ όταν κλείσει ΠΛΗΡΕΣ πέρασμα (και οι επτά πίνακες) — είτε έγινε
  // με μία κλήση, είτε με επτά διαδοχικές που μοιράστηκαν το ίδιο `runId`. Τα νούμερα βγαίνουν
  // από τον σωρευτή, όχι από την τελευταία κλήση, γιατί αυτή ξέρει μόνο τον δικό της πίνακα.
  if (full) {
    const failed = done.filter((d) => !d.ok);
    await logAudit({
      userId: actor.id, userEmail: actor.email,
      action: 'metadata.resync_all.sync_softone', resource: 'setting',
      metadata: {
        ok: failed.length === 0,
        okCount: done.length - failed.length,
        failCount: failed.length,
        ms: done.reduce((a, d) => a + (d.ms || 0), 0),
        failed: failed.map((d) => ({ table: d.table, error: d.error, errorSource: d.errorSource })),
      },
    });
  }

  return report;
}

/**
 * Η ΜΙΑ μετάφραση «σφάλμα συγχρονισμού → HTTP απάντηση», κοινή για τα επτά μεμονωμένα routes.
 * Ένα `502 softone_error` πάνω από αποτυχία της τοπικής βάσης χρεώνει λάθος σύστημα.
 */
export function syncFailureResponse(e: unknown): { status: number; body: Record<string, unknown> } {
  if (e instanceof ResyncBusyError) {
    return { status: 409, body: { error: 'sync_running', message: e.message } };
  }
  if (e instanceof SoftoneConfigError) {
    return { status: 400, body: { error: 'softone_not_configured', message: (e as Error).message } };
  }
  if (e instanceof SoftoneError) {
    return { status: 502, body: { error: 'softone_error', message: (e as Error).message } };
  }
  return {
    status: 500,
    body: {
      error: 'database_error',
      message: `Αποτυχία στην τοπική βάση δεδομένων (το SoftOne απάντησε κανονικά): ${(e as Error).message}`,
    },
  };
}

/**
 * Κλειδαριά για τα ΜΕΜΟΝΩΜΕΝΑ `sync-*-softone` routes: χωρίς αυτήν, ένα «Συγχρονισμός όλων»
 * και ένα κλικ στο εικονίδιο ανανέωσης μιας κάρτας σβήνουν τον ίδιο πίνακα ταυτόχρονα.
 */
export async function withResyncLock<T>(
  actor: SyncActor,
  tables: SyncTable[],
  fn: () => Promise<T>,
): Promise<T> {
  const runId = `single-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const marker = await claimRun(actor, runId, tables);
  try {
    return await fn();
  } finally {
    // Ο δείκτης δεν κρατάει απολογισμό εδώ — μόνο τη σειρά. Σβήνεται πάντα.
    if (marker.runId === runId) await prisma.appSetting.deleteMany({ where: { key: RUN_KEY } }).catch(() => {});
  }
}
