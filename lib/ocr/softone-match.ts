import { prisma } from '@/lib/db';
import { softoneFindSupplierByAfm, softoneCheckPurchaseDoc } from '@/lib/softone';

/**
 * PURDOC duplicate check fields for a scanned doc, given the matched supplier TRDR
 * and the OCR-extracted invoice number + date. Best-effort (never throws).
 */
export async function buildDuplicateCheck(
  trdr: number | null,
  invoiceNumber: unknown,
  date: unknown,
): Promise<{ softoneDocExists: boolean | null; softoneDocRef: string | null; softoneDocChecked: Date }> {
  const num = String(invoiceNumber ?? '').trim();
  if (!trdr || !num) return { softoneDocExists: null, softoneDocRef: null, softoneDocChecked: new Date() };
  try {
    const r = await softoneCheckPurchaseDoc(trdr, num, date ? String(date) : null);
    return { softoneDocExists: r.exists, softoneDocRef: r.ref, softoneDocChecked: new Date() };
  } catch {
    return { softoneDocExists: null, softoneDocRef: null, softoneDocChecked: new Date() };
  }
}

export type SoftoneMatchFields = {
  softoneTrdr: number | null;
  softoneCode: string | null;
  softoneName: string | null;
  softoneKind: string | null;
  softoneChecked: Date | null;
};

/**
 * Looks up the issuer ΑΦΜ of a scanned purchase invoice in SoftOne suppliers
 * (TRDR SODTYPE=12) and returns fields to persist on the OcrDocument. Best-effort:
 * never throws (SoftOne errors leave `softoneChecked = null` so a re-extract retries).
 */
export async function buildSoftoneMatch(vatNumber: unknown): Promise<SoftoneMatchFields> {
  const afm = String(vatNumber ?? '').replace(/\D+/g, '');
  const empty = { softoneTrdr: null, softoneCode: null, softoneName: null, softoneKind: null };
  if (!afm) return { ...empty, softoneChecked: new Date() };
  try {
    const m = await softoneFindSupplierByAfm(afm);
    return m
      ? { softoneTrdr: m.trdr, softoneCode: m.code, softoneName: m.name, softoneKind: m.kind, softoneChecked: new Date() }
      : { ...empty, softoneChecked: new Date() };
  } catch {
    return { ...empty, softoneChecked: null };
  }
}

/**
 * Matches a document's invoice lines against the local SoftOne item mirror
 * (CODE2 factory → CODE1 EAN → CODE) and persists the match per line.
 * Cheap (one DB query, no AI) — safe to run automatically on every scan.
 * Manual matches (softoneMatchedBy='manual') are preserved.
 */
export async function matchDocItems(docId: string): Promise<{ matched: number; total: number }> {
  const items = await prisma.ocrInvoiceItem.findMany({
    where: { documentId: docId },
    select: { id: true, code: true, softoneMatchedBy: true },
  });
  if (items.length === 0) {
    await prisma.ocrDocument.update({ where: { id: docId }, data: { itemsTotal: 0, itemsMatched: 0 } }).catch(() => {});
    return { matched: 0, total: 0 };
  }

  const codes = Array.from(new Set(items.map((i) => (i.code ?? '').trim()).filter(Boolean)));
  const sItems = codes.length
    ? await prisma.softoneItem.findMany({
        where: { OR: [{ code: { in: codes } }, { code2: { in: codes } }, { code1: { in: codes } }] },
        select: { mtrl: true, code: true, code1: true, code2: true, name: true, isService: true },
      })
    : [];

  const byCode = new Map(sItems.map((m) => [m.code, m]));
  const byCode2 = new Map(sItems.filter((m) => m.code2).map((m) => [m.code2!, m]));
  const byCode1 = new Map(sItems.filter((m) => m.code1).map((m) => [m.code1!, m]));

  let matched = 0;
  await Promise.all(items.map((it) => {
    if (it.softoneMatchedBy === 'manual') { matched++; return Promise.resolve(); }
    const code = (it.code ?? '').trim();
    let m: (typeof sItems)[number] | undefined;
    let by: string | null = null;
    if (code) {
      if (byCode2.has(code)) { m = byCode2.get(code); by = 'code2'; }
      else if (byCode1.has(code)) { m = byCode1.get(code); by = 'code1'; }
      else if (byCode.has(code)) { m = byCode.get(code); by = 'code'; }
    }
    if (m) matched++;
    return prisma.ocrInvoiceItem.update({
      where: { id: it.id },
      data: m
        ? { softoneMtrl: m.mtrl, softoneCode: m.code, softoneName: m.name, softoneIsService: m.isService, softoneMatchedBy: by }
        : { softoneMtrl: null, softoneCode: null, softoneName: null, softoneIsService: null, softoneMatchedBy: null },
    });
  }));

  // Persist the line-match tally so the reconciliation status can be derived cheaply.
  await prisma.ocrDocument.update({
    where: { id: docId },
    data: { itemsTotal: items.length, itemsMatched: matched },
  }).catch(() => {});

  return { matched, total: items.length };
}
