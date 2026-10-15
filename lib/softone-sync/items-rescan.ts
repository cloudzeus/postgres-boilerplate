// lib/softone-sync/items-rescan.ts — SERVER. ΕΠΑΝΕΛΕΓΧΟΣ ΕΙΔΩΝ ΣΤΟ SOFTONE, ΚΑΤΑ ΠΑΡΑΓΓΕΛΙΑ.
//
// Το σενάριο: μια γραμμή δεν βρήκε είδος όταν διαβάστηκε το παραστατικό. Στο μεταξύ κάποιος
// καταχώρισε το είδος ΜΕΣΑ στη SoftOne (ή του έβαλε EAN / κωδικό κατασκευαστή / κωδικό
// προμηθευτή). Ο καθρέφτης μας δεν το ξέρει μέχρι τον επόμενο πλήρη συγχρονισμό — άρα η γραμμή
// έμενε «χωρίς είδος» ενώ το είδος υπήρχε.
//
// Δύο βήματα, και τα δύο φθηνά:
//   1. ΦΕΡΝΟΥΜΕ ΜΟΝΟ ΤΑ ΝΕΑ/ΑΛΛΑΓΜΕΝΑ είδη (MTRL > μέγιστο του καθρέφτη ή UPDDATE ≥ τελευταίος
//      έλεγχος) — όχι όλο το μητρώο — και τα γράφουμε στον καθρέφτη.
//   2. ΞΑΝΑΨΑΧΝΟΥΜΕ ΜΟΝΟ ΤΙΣ ΓΡΑΜΜΕΣ ΧΩΡΙΣ ΕΙΔΟΣ: κωδικός γραμμής, EAN, κωδ. κατασκευαστή,
//      κωδικός προμηθευτή (MTRSUPCODE), και τέλος ίδια περιγραφή. Ό,τι έχει ήδη αντιστοιχίσει ο
//      χρήστης ή η εφαρμογή ΔΕΝ αγγίζεται, ούτε «παραλείφθηκε».
//
// Μόνο ΑΝΑΓΝΩΣΕΙΣ στη SoftOne (GetTable).
import 'server-only';
import { prisma } from '@/lib/db';
import { getSetting, setSetting } from '@/lib/settings';
import { softoneFetchItemsChanged, softoneFetchSupplierCodes, softoneFetchUnits, type ItemRow } from '@/lib/softone';
import { UNMATCHED_LINE_WHERE } from '@/lib/ocr/queues';
import { refreshDocTallies } from '@/lib/ocr/softone-match';
import { normalizeLineText } from '@/lib/ocr/line-match';

const LAST_PULL = 'integrations.softoneItemsLastPull';

export interface ItemPullResult { added: number; updated: number; since: string | null }
export interface RematchResult { checked: number; matched: number; docs: number }

// ── Βήμα 1: νέα/αλλαγμένα είδη ─────────────────────────────────────────────────────────────

let pullInflight: Promise<ItemPullResult> | null = null;

/** ISO χωρίς ζώνη, όπως τη θέλει το `CONVERT(…,126)` — με 10′ περιθώριο για ρολόγια που διαφέρουν. */
function sinceIso(lastIso: string | null): string | null {
  const t = lastIso ? Date.parse(lastIso) : NaN;
  if (!Number.isFinite(t)) return null;
  return new Date(t - 10 * 60 * 1000).toISOString().slice(0, 19);
}

export async function pullChangedItems(): Promise<ItemPullResult> {
  pullInflight ??= (async () => {
    const startedAt = new Date().toISOString();
    const [max, last, lastFull] = await Promise.all([
      prisma.softoneItem.aggregate({ _max: { mtrl: true } }),
      getSetting<string>(LAST_PULL).catch(() => null),
      getSetting<string>('integrations.softoneItemsLastSync').catch(() => null),
    ]);
    const since = sinceIso(last ?? lastFull ?? null);
    const rows: ItemRow[] = await softoneFetchItemsChanged(max._max.mtrl ?? 0, since);
    const existing = new Set((await prisma.softoneItem.findMany({
      where: { mtrl: { in: rows.map((r) => r.mtrl) } }, select: { mtrl: true },
    })).map((r) => r.mtrl));
    for (const r of rows) {
      const data = {
        code: r.code, code1: r.code1, code2: r.code2, name: r.name || r.code, name2: r.name2,
        price: r.price, isService: r.isService, isActive: r.isActive, myDataCode: r.myDataCode,
        unit1: r.unit1, unitBuy: r.unitBuy, buyRatio: r.buyRatio, unitSell: r.unitSell, sellRatio: r.sellRatio,
      };
      await prisma.softoneItem.upsert({ where: { mtrl: r.mtrl }, update: data, create: { mtrl: r.mtrl, ...data } });
    }
    // Και οι ΜΟΝΑΔΕΣ ΜΕΤΡΗΣΗΣ (μικρός πίνακας): μια νέα μονάδα («Κιβώτιο 12») που φτιάχτηκε στη
    // SoftOne για ένα νέο είδος πρέπει να φαίνεται αμέσως στις επιλογές. Μόνο προσθήκη/ενημέρωση —
    // ποτέ διαγραφή από εδώ (αυτό το κάνει ο πλήρης συγχρονισμός).
    const units = await softoneFetchUnits().catch(() => []);
    for (const u of units) {
      await prisma.softoneLookup.upsert({
        where: { kind_code: { kind: 'MTRUNIT', code: u.id } },
        update: { name: u.name },
        create: { kind: 'MTRUNIT', code: u.id, name: u.name },
      });
    }
    await setSetting(LAST_PULL, startedAt).catch(() => null);
    const added = rows.filter((r) => !existing.has(r.mtrl)).length;
    return { added, updated: rows.length - added, since };
  })().finally(() => { pullInflight = null; });
  return pullInflight;
}

// ── Βήμα 2: γραμμές χωρίς είδος ─────────────────────────────────────────────────────────────

export interface RescanItem { mtrl: number; code: string; code1: string | null; code2: string | null; name: string; isService: boolean }
export interface RescanLine { code: string | null; ean: string | null; mfrCode: string | null; name: string; trdr: number | null }
export interface RescanIndex {
  byCode: Map<string, RescanItem>;
  byCode1: Map<string, RescanItem>;
  byCode2: Map<string, RescanItem>;
  /** `${trdr}|${κωδικός προμηθευτή}` → είδος */
  bySupplier: Map<string, RescanItem>;
  /** Κανονικοποιημένη περιγραφή → είδος (ΜΟΝΟ όταν είναι μοναδική). */
  byName: Map<string, RescanItem>;
}

const k = (v: string | null | undefined) => String(v ?? '').trim();

export function buildRescanIndex(items: RescanItem[], supplierCodes: { mtrl: number; trdr: number; code: string }[]): RescanIndex {
  const byMtrl = new Map(items.map((i) => [i.mtrl, i]));
  const names = new Map<string, RescanItem | null>();
  for (const i of items) {
    const n = normalizeLineText(i.name);
    if (n) names.set(n, names.has(n) ? null : i);   // δύο είδη με ίδια περιγραφή ⇒ καμία απόφαση
  }
  return {
    byCode: new Map(items.filter((i) => k(i.code)).map((i) => [k(i.code), i])),
    byCode1: new Map(items.filter((i) => k(i.code1)).map((i) => [k(i.code1), i])),
    byCode2: new Map(items.filter((i) => k(i.code2)).map((i) => [k(i.code2), i])),
    bySupplier: new Map(supplierCodes.flatMap((s) => {
      const it = byMtrl.get(s.mtrl);
      return it ? [[`${s.trdr}|${k(s.code)}`, it] as const] : [];
    })),
    byName: new Map([...names].filter((e): e is [string, RescanItem] => e[1] != null)),
  };
}

/**
 * Το είδος μιας γραμμής χωρίς αντιστοίχιση, με σειρά ΒΕΒΑΙΟΤΗΤΑΣ: κωδικός προμηθευτή του ίδιου
 * εκδότη → EAN → κωδ. κατασκευαστή → κωδικός γραμμής σε CODE2/CODE1/CODE → ίδια περιγραφή. ΚΑΘΑΡΟ.
 */
export function pickItemForLine(line: RescanLine, idx: RescanIndex): { item: RescanItem; by: string } | null {
  const code = k(line.code);
  const ean = k(line.ean);
  const mfr = k(line.mfrCode);
  if (line.trdr != null && code) {
    const s = idx.bySupplier.get(`${line.trdr}|${code}`);
    if (s) return { item: s, by: 'supcode' };
  }
  if (ean && idx.byCode1.has(ean)) return { item: idx.byCode1.get(ean)!, by: 'code1' };
  if (mfr && idx.byCode2.has(mfr)) return { item: idx.byCode2.get(mfr)!, by: 'code2' };
  if (code) {
    if (idx.byCode2.has(code)) return { item: idx.byCode2.get(code)!, by: 'code2' };
    if (idx.byCode1.has(code)) return { item: idx.byCode1.get(code)!, by: 'code1' };
    if (idx.byCode.has(code)) return { item: idx.byCode.get(code)!, by: 'code' };
  }
  const n = normalizeLineText(line.name);
  const byName = n ? idx.byName.get(n) : undefined;
  return byName ? { item: byName, by: 'name' } : null;
}

/**
 * Ξαναψάχνει είδος για τις γραμμές ΧΩΡΙΣ αντιστοίχιση. `docIds` = μόνο αυτά τα παραστατικά·
 * χωρίς = όλα τα μη καταχωρισμένα (ουρά «Είδη & έξοδα»).
 */
export async function rematchUnmatchedLines(docIds?: string[]): Promise<RematchResult> {
  const lines = await prisma.ocrInvoiceItem.findMany({
    where: {
      ...UNMATCHED_LINE_WHERE,
      document: {
        status: 'COMPLETED', postStatus: { not: 'POSTED' },
        ...(docIds?.length ? { id: { in: docIds } } : {}),
      },
    },
    select: { id: true, documentId: true, rowIndex: true, code: true, name: true },
    take: 5000,
  });
  if (lines.length === 0) return { checked: 0, matched: 0, docs: 0 };

  const docs = await prisma.ocrDocument.findMany({
    where: { id: { in: [...new Set(lines.map((l) => l.documentId))] } },
    select: { id: true, softoneTrdr: true, document: true },
  });
  const docById = new Map(docs.map((d) => [d.id, d]));
  const lineExtra = (docId: string, rowIndex: number) => {
    const l = ((docById.get(docId)?.document ?? {}) as { lines?: { ean?: string | null; mfrCode?: string | null }[] }).lines?.[rowIndex];
    return { ean: l?.ean ?? null, mfrCode: l?.mfrCode ?? null };
  };

  const rescanLines = lines.map((l) => ({
    ...l, ...lineExtra(l.documentId, l.rowIndex), trdr: docById.get(l.documentId)?.softoneTrdr ?? null,
  }));
  const keys = [...new Set(rescanLines.flatMap((l) => [k(l.code), k(l.ean), k(l.mfrCode)]).filter(Boolean))];
  const names = [...new Set(lines.map((l) => normalizeLineText(l.name)).filter(Boolean))];

  // Κωδικοί προμηθευτή: ζωντανά (ο καθρέφτης δεν τους κρατά) — αποτυχία ⇒ απλώς χωρίς αυτό το πέρασμα.
  const trdrs = [...new Set(rescanLines.map((l) => l.trdr).filter((t): t is number => t != null))];
  const supplierCodes = await softoneFetchSupplierCodes(trdrs, rescanLines.map((l) => k(l.code)).filter(Boolean)).catch(() => []);

  const items = await prisma.softoneItem.findMany({
    where: {
      isActive: true,
      OR: [
        { code: { in: keys } }, { code1: { in: keys } }, { code2: { in: keys } },
        { mtrl: { in: supplierCodes.map((s) => s.mtrl) } },
      ],
    },
    select: { mtrl: true, code: true, code1: true, code2: true, name: true, isService: true },
  });
  // Ίδια περιγραφή: σύγκριση στη μνήμη πάνω σε όλα τα ενεργά (ο καθρέφτης είναι μικρός και τοπικός).
  const all = names.length
    ? await prisma.softoneItem.findMany({ where: { isActive: true }, select: { mtrl: true, code: true, code1: true, code2: true, name: true, isService: true } })
    : [];
  const byNameItems = all.filter((i) => names.includes(normalizeLineText(i.name)));
  const idx = buildRescanIndex([...items, ...byNameItems.filter((i) => !items.some((x) => x.mtrl === i.mtrl))], supplierCodes);

  let matched = 0;
  const touched = new Set<string>();
  for (const l of rescanLines) {
    const hit = pickItemForLine(l, idx);
    if (!hit) continue;
    // Μόνο αν η γραμμή είναι ΑΚΟΜΗ χωρίς αντιστοίχιση (δεν πατάμε ό,τι έγινε στο μεταξύ).
    const res = await prisma.ocrInvoiceItem.updateMany({
      where: { id: l.id, ...UNMATCHED_LINE_WHERE },
      data: {
        softoneMtrl: hit.item.mtrl, softoneExpn: null, softoneLinMtrl: null,
        softoneCode: hit.item.code, softoneName: hit.item.name, softoneIsService: hit.item.isService,
        softoneMatchedBy: hit.by,
      },
    });
    if (res.count > 0) { matched += 1; touched.add(l.documentId); }
  }
  if (touched.size) await refreshDocTallies([...touched]);
  return { checked: lines.length, matched, docs: touched.size };
}
