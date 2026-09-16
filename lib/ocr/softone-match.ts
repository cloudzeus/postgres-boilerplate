import { prisma } from '@/lib/db';
import { softoneFindTraderByAfm, softoneCheckPurchaseDoc } from '@/lib/softone';
import { normalizeLineText } from '@/lib/ocr/line-match';

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
 * Looks up the issuer ΑΦΜ of a scanned document in SoftOne traders — προμηθευτές
 * (SODTYPE 12) and πιστωτές (16), preferring a supplier — and returns fields to
 * persist on the OcrDocument (`softoneKind` follows the SODTYPE). Best-effort:
 * never throws (SoftOne errors leave `softoneChecked = null` so a re-extract retries).
 */
export async function buildSoftoneMatch(vatNumber: unknown): Promise<SoftoneMatchFields> {
  const afm = String(vatNumber ?? '').replace(/\D+/g, '');
  const empty = { softoneTrdr: null, softoneCode: null, softoneName: null, softoneKind: null };
  if (!afm) return { ...empty, softoneChecked: new Date() };
  try {
    const m = await softoneFindTraderByAfm(afm);
    return m
      ? { softoneTrdr: m.trdr, softoneCode: m.code, softoneName: m.name, softoneKind: m.kind, softoneChecked: new Date() }
      : { ...empty, softoneChecked: new Date() };
  } catch {
    return { ...empty, softoneChecked: null };
  }
}

/**
 * Γράφει το σύνολο/αντιστοιχισμένες γραμμές ενός παραστατικού. Best-effort: το
 * tally είναι παράγωγο (βλ. `lib/ocr/recon-status.ts`), δεν αξίζει να ρίξει τη ροή.
 */
function writeDocTally(docId: string, total: number, matched: number): Promise<unknown> {
  return prisma.ocrDocument
    .update({ where: { id: docId }, data: { itemsTotal: total, itemsMatched: matched } })
    .catch(() => {});
}

/**
 * Ξαναϋπολογίζει `itemsTotal/itemsMatched` για τα δοθέντα παραστατικά διαβάζοντας
 * τις γραμμές τους (αντιστοιχισμένη = έχει `softoneMtrl`, `softoneExpn` ή `softoneLinMtrl`). Το
 * χρησιμοποιούν οι ουρές (`lib/ocr/queues.ts`) μετά από ομαδική αντιστοίχιση.
 */
export async function refreshDocTallies(docIds: string[]): Promise<void> {
  const ids = Array.from(new Set(docIds.filter(Boolean)));
  if (ids.length === 0) return;
  const lines = await prisma.ocrInvoiceItem.findMany({
    where: { documentId: { in: ids } },
    select: { documentId: true, softoneMtrl: true, softoneExpn: true, softoneLinMtrl: true },
  });
  const tally = new Map(ids.map((id) => [id, { total: 0, matched: 0 }]));
  for (const l of lines) {
    const t = tally.get(l.documentId);
    if (!t) continue;
    t.total++;
    if (l.softoneMtrl != null || l.softoneExpn != null || l.softoneLinMtrl != null) t.matched++;
  }
  await Promise.all(Array.from(tally.entries()).map(([id, t]) => writeDocTally(id, t.total, t.matched)));
}

/** Τα πεδία αντιστοίχισης μιας γραμμής — γράφονται μαζί, ποτέ μισά. */
type LineMatchUpdate = {
  softoneMtrl: number | null;
  softoneExpn: number | null;
  softoneLinMtrl: number | null;
  softoneCode: string | null;
  softoneName: string | null;
  softoneIsService: boolean | null;
  softoneMatchedBy: string | null;
};
const NO_MATCH: LineMatchUpdate = {
  softoneMtrl: null, softoneExpn: null, softoneLinMtrl: null, softoneCode: null, softoneName: null,
  softoneIsService: null, softoneMatchedBy: null,
};

/**
 * Matches a document's invoice lines against the local SoftOne registries and
 * persists the match per line. Two passes, cheap (no AI) — safe to run on every scan:
 *
 *  1. κωδικός: CODE2 (εργοστασίου) → CODE1 (EAN) → CODE στο `SoftoneItem`.
 *  2. μνήμη: `LineMatchRule` για το κανονικοποιημένο κείμενο της γραμμής, με τον
 *     κανόνα του ίδιου εκδότη (ΑΦΜ) να υπερισχύει του γενικού (`afm = ''`) —
 *     `softoneMatchedBy: 'memory'`, και το `timesUsed` του κανόνα αυξάνεται.
 *
 * Γραμμές αντιστοιχισμένες χειροκίνητα (`manual`) ή που ο χρήστης παρέλειψε ρητά
 * (`skipped`) δεν ξαναγράφονται. Μια γραμμή μετράει ως αντιστοιχισμένη όταν έχει
 * `softoneMtrl`, `softoneExpn` ή `softoneLinMtrl`.
 */
export async function matchDocItems(docId: string): Promise<{ matched: number; total: number }> {
  const items = await prisma.ocrInvoiceItem.findMany({
    where: { documentId: docId },
    select: { id: true, code: true, name: true, softoneMatchedBy: true, softoneMtrl: true, softoneExpn: true, softoneLinMtrl: true },
  });
  if (items.length === 0) {
    await writeDocTally(docId, 0, 0);
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

  const updates = new Map<string, LineMatchUpdate>();
  const unmatched: { id: string; pattern: string }[] = [];
  let matched = 0;

  // ── 1. Πέρασμα κωδικού ──────────────────────────────────────────────
  for (const it of items) {
    // Χειροκίνητη γραμμή: δεν την ξαναγράφουμε, αλλά μετράει ως αντιστοιχισμένη ΜΟΝΟ αν
    // κρατάει πράγματι είδος ή έξοδο — ίδιος κανόνας με το `refreshDocTallies`.
    if (it.softoneMatchedBy === 'manual') {
      if (it.softoneMtrl != null || it.softoneExpn != null || it.softoneLinMtrl != null) matched++;
      continue;
    }
    if (it.softoneMatchedBy === 'skipped') continue;
    const code = (it.code ?? '').trim();
    let m: (typeof sItems)[number] | undefined;
    let by: string | null = null;
    if (code) {
      if (byCode2.has(code)) { m = byCode2.get(code); by = 'code2'; }
      else if (byCode1.has(code)) { m = byCode1.get(code); by = 'code1'; }
      else if (byCode.has(code)) { m = byCode.get(code); by = 'code'; }
    }
    if (m) {
      matched++;
      updates.set(it.id, {
        softoneMtrl: m.mtrl, softoneExpn: null, softoneLinMtrl: null, softoneCode: m.code,
        softoneName: m.name, softoneIsService: m.isService, softoneMatchedBy: by,
      });
      continue;
    }
    updates.set(it.id, { ...NO_MATCH });
    const pattern = normalizeLineText(it.name);
    if (pattern) unmatched.push({ id: it.id, pattern });
  }

  // ── 2. Πέρασμα μνήμης (LineMatchRule) ───────────────────────────────
  if (unmatched.length > 0) {
    const doc = await prisma.ocrDocument.findUnique({ where: { id: docId }, select: { extractedData: true } });
    const ed = (doc?.extractedData ?? null) as { vatNumber?: unknown } | null;
    const afm = String(ed?.vatNumber ?? '').replace(/\D+/g, '');
    const patterns = Array.from(new Set(unmatched.map((u) => u.pattern)));
    const rules = await prisma.lineMatchRule.findMany({
      where: { pattern: { in: patterns }, afm: { in: afm ? [afm, ''] : [''] } },
      select: { id: true, afm: true, pattern: true, mtrl: true, expn: true, lin: true, isService: true },
    });

    if (rules.length > 0) {
      // Ο κανόνας του εκδότη υπερισχύει του γενικού.
      const byPattern = new Map<string, (typeof rules)[number]>();
      for (const r of rules) {
        const cur = byPattern.get(r.pattern);
        if (!cur || (cur.afm === '' && r.afm !== '')) byPattern.set(r.pattern, r);
      }
      const mtrls = Array.from(new Set(rules.map((r) => r.mtrl).filter((v): v is number => v != null)));
      const expns = Array.from(new Set(rules.map((r) => r.expn).filter((v): v is number => v != null)));
      const lins = Array.from(new Set(rules.map((r) => r.lin).filter((v): v is number => v != null)));
      const [ruleItems, ruleExpenses, ruleLineItems] = await Promise.all([
        mtrls.length
          ? prisma.softoneItem.findMany({ where: { mtrl: { in: mtrls } }, select: { mtrl: true, code: true, name: true, isService: true } })
          : Promise.resolve([]),
        expns.length
          ? prisma.softoneExpense.findMany({ where: { expn: { in: expns } }, select: { expn: true, code: true, name: true } })
          : Promise.resolve([]),
        lins.length
          ? prisma.softoneLineItem.findMany({ where: { mtrl: { in: lins } }, select: { mtrl: true, code: true, name: true } })
          : Promise.resolve([]),
      ]);
      const itemByMtrl = new Map(ruleItems.map((i) => [i.mtrl, i]));
      const expenseByExpn = new Map(ruleExpenses.map((e) => [e.expn, e]));
      const lineItemByMtrl = new Map(ruleLineItems.map((l) => [l.mtrl, l]));

      const usage = new Map<string, number>();
      for (const u of unmatched) {
        const r = byPattern.get(u.pattern);
        if (!r) continue;
        let data: LineMatchUpdate | null = null;
        if (r.mtrl != null) {
          const i = itemByMtrl.get(r.mtrl);
          data = {
            softoneMtrl: r.mtrl, softoneExpn: null, softoneLinMtrl: null,
            softoneCode: i?.code ?? null, softoneName: i?.name ?? null,
            softoneIsService: i?.isService ?? r.isService, softoneMatchedBy: 'memory',
          };
        } else if (r.expn != null) {
          const e = expenseByExpn.get(r.expn);
          data = {
            softoneMtrl: null, softoneExpn: r.expn, softoneLinMtrl: null,
            softoneCode: e?.code ?? null, softoneName: e?.name ?? null,
            softoneIsService: r.isService, softoneMatchedBy: 'memory',
          };
        } else if (r.lin != null) {
          const l = lineItemByMtrl.get(r.lin);
          data = {
            softoneMtrl: null, softoneExpn: null, softoneLinMtrl: r.lin,
            softoneCode: l?.code ?? null, softoneName: l?.name ?? null,
            softoneIsService: false, softoneMatchedBy: 'memory',
          };
        }
        if (!data) continue;
        updates.set(u.id, data);
        matched++;
        usage.set(r.id, (usage.get(r.id) ?? 0) + 1);
      }

      await Promise.all(Array.from(usage.entries()).map(([id, n]) =>
        prisma.lineMatchRule.update({ where: { id }, data: { timesUsed: { increment: n } } }).catch(() => {}),
      ));
    }
  }

  await Promise.all(Array.from(updates.entries()).map(([id, data]) =>
    prisma.ocrInvoiceItem.update({ where: { id }, data }),
  ));

  // Persist the line-match tally so the reconciliation status can be derived cheaply.
  await writeDocTally(docId, items.length, matched);

  return { matched, total: items.length };
}
