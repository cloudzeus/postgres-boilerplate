// lib/softone/resync.ts — SERVER. Η ΜΙΑ υλοποίηση κάθε συγχρονισμού βοηθητικού πίνακα SoftOne.
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
  softoneFetchDocSeries,
  softoneFetchExpenses,
  softoneFetchItems,
  softoneFetchLineCategories,
  softoneFetchLineItems,
  softoneFetchLookups,
  softoneFetchMyDataClassCategories,
  softoneFetchMyDataClassTypes,
  softoneFetchPurchaseDocTypes,
  softoneFetchTraders,
  softoneFetchVatCategories,
} from '@/lib/softone';

/** Ο βοηθητικός πίνακας, όπως τον ξέρει το UI και το αποτέλεσμα του «Συγχρονισμός όλων». */
export type SyncTable =
  | 'vat' | 'lookups' | 'expenses' | 'items' | 'traders' | 'purdoc' | 'docseries'
  | 'lineitems' | 'linecategories' | 'mydataclasses';

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

// ─────────────────────────────────────────────────────────────────────────────
// ΦΠΑ (VatCategory)
// ─────────────────────────────────────────────────────────────────────────────

export async function syncVatCategories(actor: SyncActor): Promise<SyncPayload> {
  const rows = await softoneFetchVatCategories();

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
  const rows = await softoneFetchLookups();
  if (rows.length === 0) throw new Error('Δεν επιστράφηκαν πίνακες');

  const data = rows.map((r, i) => ({ kind: r.kind, code: r.code, name: r.name, order: i }));
  const total = await prisma.$transaction(async (tx) => {
    await tx.softoneLookup.deleteMany({});
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
    action: 'metadata.lookups.sync_softone', resource: 'setting', metadata: { total, byKind },
  });

  // Ο πίνακας αντικαθίσταται ολόκληρος — δεν υπάρχει «νέο» και «ενημερωμένο», μόνο το σύνολο.
  return { created: total, updated: 0, skipped: rows.length - total, total, syncedAt, detail: { byKind } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Έξοδα (SoftoneExpense)
// ─────────────────────────────────────────────────────────────────────────────

export async function syncExpenses(actor: SyncActor): Promise<SyncPayload> {
  const rows = await softoneFetchExpenses();
  if (rows.length === 0) throw new Error('Δεν επιστράφηκαν έξοδα');

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
  if (rows.length === 0) throw new Error('Δεν επιστράφηκαν είδη');

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
  if (rows.length === 0) throw new Error('Δεν επιστράφηκαν συναλλασσόμενοι');

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

  // Ασφαλιστική δικλείδα: μια άδεια απάντηση SoftOne δεν αδειάζει το μητρώο.
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

  // Ασφαλιστική δικλείδα: μια άδεια απάντηση SoftOne δεν αδειάζει το μητρώο.
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
  if (rows.length === 0) throw new Error('Δεν επιστράφηκαν χρεοπιστώσεις');

  const existing = new Set((await prisma.softoneLineItem.findMany({ select: { mtrl: true } })).map((v) => v.mtrl));
  const now = new Date();
  let created = 0;
  let updated = 0;
  for (const r of rows) {
    const data = {
      code: r.code, name: r.name || r.code, vat: r.vat, mtrType: r.mtrType, mtrCategory: r.mtrCategory,
      classType: r.classType, classCategory: r.classCategory, myDataCode: r.myDataCode,
      myDataVprc: r.myDataVprc, isActive: true, syncedAt: now,
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
// Κατηγορίες δαπανών (LINCATEGORY → MTRCATEGORY SODTYPE 53)
// ─────────────────────────────────────────────────────────────────────────────

export async function syncLineCategories(actor: SyncActor): Promise<SyncPayload> {
  // Επιτρέπουμε ρητά την εφεδρεία χωρίς SODTYPE — αλλά ΔΕΝ την κρύβουμε: κάθε γραμμή που ήρθε
  // από αυτήν σημαδεύεται `sodtypeFiltered: false` και το UI το γράφει.
  const { rows, filtered } = await softoneFetchLineCategories({ allowUnfiltered: true });
  if (rows.length === 0) throw new Error('Δεν επιστράφηκαν κατηγορίες δαπανών');

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
    throw new Error('Δεν επιστράφηκαν χαρακτηρισμοί myDATA');
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
 *  8. `linecategories` Κατηγορίες δαπανών — η ομαδοποίηση πάνω από τις χρεοπιστώσεις, άρα πριν από αυτές.
 *  9. `lineitems` Χρεοπιστώσεις (το `MTRL` των γραμμών «Ειδικών συναλλαγών»).
 * 10. `mydataclasses` Οι λίστες χαρακτηρισμού myDATA — καθαρή αναφορά, τελευταίες.
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
  { table: 'linecategories', label: 'Κατηγορίες δαπανών',      run: syncLineCategories },
  { table: 'lineitems',      label: 'Χρεοπιστώσεις',           run: syncLineItems },
  { table: 'mydataclasses',  label: 'Χαρακτηρισμοί myDATA',    run: syncMyDataClasses },
];

export const SYNC_LABELS: Record<SyncTable, string> =
  Object.fromEntries(SYNC_STEPS.map((s) => [s.table, s.label])) as Record<SyncTable, string>;

/**
 * Τρέχει ΟΛΟΥΣ τους συγχρονισμούς, έναν-έναν, και επιστρέφει έναν απολογισμό ανά πίνακα.
 *
 * Μια αποτυχία ΔΕΝ σταματά τους υπόλοιπους: αν πέσει ο βαρύς πίνακας των συναλλασσομένων, δεν
 * υπάρχει λόγος να μείνουν ασυγχρόνιστες και οι σειρές παραστατικών. Ασφαλές να ξανατρέξει όσες
 * φορές θέλει κανείς — κάθε βήμα είναι upsert ή ολική αντικατάσταση, ποτέ προσθήκη.
 */
export async function resyncAllSoftone(
  actor: SyncActor,
  opts: { only?: SyncTable[] } = {},
): Promise<ResyncReport> {
  const steps = opts.only?.length
    ? SYNC_STEPS.filter((s) => opts.only!.includes(s.table))
    : SYNC_STEPS;

  const startedAt = Date.now();
  const results: SyncOutcome[] = [];
  for (const step of steps) {
    const t0 = Date.now();
    try {
      const r = await step.run(actor);
      results.push({
        table: step.table, label: step.label, ok: true,
        created: r.created, updated: r.updated, skipped: r.skipped,
        error: null, ms: Date.now() - t0, detail: { ...r.detail, total: r.total },
      });
    } catch (e) {
      results.push({
        table: step.table, label: step.label, ok: false,
        created: 0, updated: 0, skipped: 0,
        error: (e as Error).message || 'άγνωστο σφάλμα', ms: Date.now() - t0, detail: {},
      });
    }
  }

  const failCount = results.filter((r) => !r.ok).length;
  const report: ResyncReport = {
    ok: failCount === 0,
    results,
    okCount: results.length - failCount,
    failCount,
    ms: Date.now() - startedAt,
    finishedAt: nowIso(),
  };

  // Συγκεντρωτική εγγραφή ΜΟΝΟ για ολόκληρο πέρασμα. Όταν το UI τρέχει έναν-έναν τους πίνακες
  // (για να δείξει πρόοδο), η κάθε συνάρτηση γράφει ήδη τη δική της — δεν θέλουμε επτά «resync_all».
  if (!opts.only?.length) {
    await logAudit({
      userId: actor.id, userEmail: actor.email,
      action: 'metadata.resync_all.sync_softone', resource: 'setting',
      metadata: {
        ok: report.ok, okCount: report.okCount, failCount: report.failCount, ms: report.ms,
        failed: results.filter((r) => !r.ok).map((r) => ({ table: r.table, error: r.error })),
      },
    });
  }

  return report;
}
