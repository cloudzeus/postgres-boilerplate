// lib/softone-registry-sync.ts — SERVER. Συγχρονισμοί βοηθητικών μητρώων SoftOne, ο καθένας μια
// απλή εξαγόμενη συνάρτηση με ΙΔΙΟ σχήμα, ώστε ένας orchestrator «Συγχρονισμός όλων» να τους
// προσθέτει με μία γραμμή. Τα routes είναι λεπτά περιτυλίγματα (δικαίωμα + audit + JSON).
//
// ΜΟΝΟ ΑΝΑΓΝΩΣΗ: κάθε συνάρτηση εδώ καλεί `GetTable`. Καμία δεν κάνει ποτέ `setData`.
import 'server-only';
import { prisma } from '@/lib/db';
import { setSetting } from '@/lib/settings';
import {
  softoneFetchLineItems, softoneFetchLineCategories,
  softoneFetchMyDataClassTypes, softoneFetchMyDataClassCategories,
} from '@/lib/softone';

/** Το κοινό αποτέλεσμα κάθε συγχρονισμού μητρώου. */
export interface RegistrySyncResult {
  total: number;
  created: number;
  updated: number;
  /** Εγγραφές που το SoftOne έπαψε να επιστρέφει ως ενεργές (δεν διαγράφονται ποτέ). */
  deactivated: number;
  syncedAt: string;
}

export class RegistrySyncError extends Error {}

/** Κενή απάντηση = δεν αδειάζουμε μητρώο. Ένα λάθος στο ERP δεν πρέπει να σβήνει τοπικά δεδομένα. */
const requireRows = <T>(rows: T[], what: string): T[] => {
  if (rows.length === 0) throw new RegistrySyncError(`Δεν επιστράφηκαν ${what} από το SoftOne`);
  return rows;
};

/** Χρεοπιστώσεις (LINEITEM → MTRL SODTYPE 53) — το μητρώο πίσω από το `MTRL` των γραμμών LINLINES. */
export async function syncLineItems(userId?: string | null): Promise<RegistrySyncResult> {
  const rows = requireRows(await softoneFetchLineItems(), 'χρεοπιστώσεις');
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
  const deactivated = (await prisma.softoneLineItem.updateMany({
    where: { mtrl: { notIn: rows.map((r) => r.mtrl) }, isActive: true },
    data: { isActive: false },
  })).count;

  const syncedAt = now.toISOString();
  await setSetting('integrations.softoneLineItemsLastSync', syncedAt, userId ?? null);
  return { total: created + updated, created, updated, deactivated, syncedAt };
}

/** Κατηγορίες δαπανών (LINCATEGORY → MTRCATEGORY SODTYPE 53) — η ομαδοποίηση πάνω από τις χρεοπιστώσεις. */
export async function syncLineCategories(userId?: string | null): Promise<RegistrySyncResult> {
  const rows = requireRows(await softoneFetchLineCategories(), 'κατηγορίες δαπανών');
  const existing = new Set((await prisma.softoneLineCategory.findMany({ select: { mtrCategory: true } })).map((v) => v.mtrCategory));
  const now = new Date();
  let created = 0;
  let updated = 0;
  for (const r of rows) {
    const data = { code: r.code, name: r.name || r.code, vat: r.vat, acnmsk: r.acnmsk, isActive: true, syncedAt: now };
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
  await setSetting('integrations.softoneLineCategoriesLastSync', syncedAt, userId ?? null);
  return { total: created + updated, created, updated, deactivated, syncedAt };
}

/**
 * Λίστες χαρακτηρισμού myDATA (EditLists MYDATACLTYPE / MYDATACLCATEGORY). Μητρώα ΑΝΑΦΟΡΑΣ:
 * εξηγούν τι σημαίνει ο χαρακτηρισμός που κουβαλά κάθε είδος/υπηρεσία/χρεοπίστωση/έξοδο.
 * Δεν έχουν «ενεργό/ανενεργό», οπότε `deactivated` είναι πάντα 0.
 */
export async function syncMyDataClassTypes(userId?: string | null): Promise<RegistrySyncResult> {
  const rows = requireRows(await softoneFetchMyDataClassTypes(), 'τύποι χαρακτηρισμού myDATA');
  const existing = new Set(
    (await prisma.softoneMyDataClassType.findMany({ select: { sotype: true, code: true } })).map((v) => `${v.sotype}:${v.code}`),
  );
  const now = new Date();
  let created = 0;
  let updated = 0;
  for (const r of rows) {
    const data = { myDataCode: r.myDataCode, sohCode: r.sohCode, name: r.name, isVat: r.isVat ?? false, syncedAt: now };
    await prisma.softoneMyDataClassType.upsert({
      where: { sotype_code: { sotype: r.sotype, code: r.code } },
      update: data,
      create: { sotype: r.sotype, code: r.code, ...data },
    });
    if (existing.has(`${r.sotype}:${r.code}`)) updated++; else created++;
  }
  const syncedAt = now.toISOString();
  await setSetting('integrations.softoneMyDataClassTypesLastSync', syncedAt, userId ?? null);
  return { total: created + updated, created, updated, deactivated: 0, syncedAt };
}

export async function syncMyDataClassCategories(userId?: string | null): Promise<RegistrySyncResult> {
  const rows = requireRows(await softoneFetchMyDataClassCategories(), 'κατηγορίες χαρακτηρισμού myDATA');
  const existing = new Set(
    (await prisma.softoneMyDataClassCategory.findMany({ select: { sotype: true, code: true } })).map((v) => `${v.sotype}:${v.code}`),
  );
  const now = new Date();
  let created = 0;
  let updated = 0;
  for (const r of rows) {
    const data = { myDataCode: r.myDataCode, sohCode: r.sohCode, name: r.name, syncedAt: now };
    await prisma.softoneMyDataClassCategory.upsert({
      where: { sotype_code: { sotype: r.sotype, code: r.code } },
      update: data,
      create: { sotype: r.sotype, code: r.code, ...data },
    });
    if (existing.has(`${r.sotype}:${r.code}`)) updated++; else created++;
  }
  const syncedAt = now.toISOString();
  await setSetting('integrations.softoneMyDataClassCategoriesLastSync', syncedAt, userId ?? null);
  return { total: created + updated, created, updated, deactivated: 0, syncedAt };
}

/**
 * Ό,τι προσθέτει αυτό το branch, σε έναν κατάλογο: ένας orchestrator «Συγχρονισμός όλων των
 * βοηθητικών πινάκων» τους τρέχει με μία γραμμή, χωρίς να ξέρει τίποτα για το καθένα.
 */
export const REGISTRY_SYNCS: { key: string; label: string; run: (userId?: string | null) => Promise<RegistrySyncResult> }[] = [
  { key: 'lineItems', label: 'Χρεοπιστώσεις', run: syncLineItems },
  { key: 'lineCategories', label: 'Κατηγορίες δαπανών', run: syncLineCategories },
  { key: 'myDataClassTypes', label: 'Τύποι χαρακτηρισμού myDATA', run: syncMyDataClassTypes },
  { key: 'myDataClassCategories', label: 'Κατηγορίες χαρακτηρισμού myDATA', run: syncMyDataClassCategories },
];
