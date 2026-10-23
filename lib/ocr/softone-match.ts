import { prisma } from '@/lib/db';
import { SODTYPE_LABEL, softoneFindTraderByAfm, softoneCheckPurchaseDoc } from '@/lib/softone';
import { requiredTraderKind } from '@/lib/ocr/required-trader-kind';
import { normalizeLineText } from '@/lib/ocr/line-match';
import { documentReference } from '@/lib/ocr/purdoc-payload';
import { classifyUtilityCharge, detectUtility, utilityInputFromDocument, utilityMemoryKeys } from '@/lib/ocr/utility-bills';
import { classifyExpenseFamily, familyMemoryKeys } from '@/lib/ocr/expense-families';
import { ruleFitsWorld, scopeKeys, worldOfLines } from '@/lib/ocr/memory-scope';
import { postingTargetsForSeries, seriesKey } from '@/lib/ocr/required-trader-kind';

/** Η αναγνώριση λογαριασμού πάνω στις ΓΡΑΜΜΕΣ της βάσης (όχι του JSON) — αυτές αντιστοιχίζονται. */
export function detectUtilityForItems(
  document: unknown,
  afm: string | null | undefined,
  items: { name: string; vatRate?: unknown; total?: unknown }[],
) {
  const input = utilityInputFromDocument(document, afm, items);
  return input ? detectUtility(input) : null;
}

/**
 * Έλεγχος διπλοεγγραφής για ένα σαρωμένο έγγραφο: προμηθευτής + αναφορά εκδότη + ημερομηνία.
 *
 * Ψάχνει με ΤΗΝ ΙΔΙΑ αναφορά που θα καταχωρούσε το `buildPurdocPayload` — «Φορ/κός αριθμός» και
 * πλήρης ταυτότητα «Παραστατικό» — αλλιώς ο έλεγχος θα κοιτούσε άλλο πεδίο από αυτό που γράφουμε
 * και η προειδοποίηση θα ήταν αναξιόπιστη με τον ίδιο ακριβώς τρόπο. Best-effort (ποτέ δεν σκάει).
 */
export async function buildDuplicateCheck(
  trdr: number | null,
  type: { series: string | null; number: string | null } | null,
  date: unknown,
): Promise<{ softoneDocExists: boolean | null; softoneDocRef: string | null; softoneDocChecked: Date }> {
  const ref = documentReference(type ?? { series: null, number: null });
  if (!trdr || !ref.taxSeriesNum) return { softoneDocExists: null, softoneDocRef: null, softoneDocChecked: new Date() };
  try {
    const r = await softoneCheckPurchaseDoc(
      trdr,
      { number: ref.taxSeriesNum, fincode: ref.fincode },
      date ? String(date) : null,
    );
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
  // ΚΡΑΤΑ ΤΟ ΠΡΟΘΕΜΑ ΧΩΡΑΣ: το «IT01808880270» χωρίς γράμματα δεν βρίσκει ποτέ την καρτέλα που
  // γράφτηκε με «IT…». Το `softoneFindTraderByAfm` ψάχνει μόνο του και τις δύο μορφές.
  const afm = String(vatNumber ?? '').toUpperCase().replace(/[^0-9A-Z]+/g, '');
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
    select: {
      documentId: true, softoneMtrl: true, softoneExpn: true, softoneLinMtrl: true, softoneAsset: true,
      // Ο ΕΠΙΜΕΡΙΣΜΟΣ ΕΙΝΑΙ ΑΝΤΙΣΤΟΙΧΙΣΗ. Η γραμμή ΞΕΡΕΙ πού πάει — σε έναν ή περισσότερους
      // λογαριασμούς — και το `postingBlockers` το δέχεται ήδη (`hasAllocations`). Χωρίς αυτό ο
      // μετρητής έλεγε `matched 0 από 1`, η λίστα έδειχνε «1 χωρίς αντιστοίχιση · Λύσε», και το
      // παραστατικό μετριόταν ΕΚΚΡΕΜΕΣ ενώ η καταχώριση δεν είχε κανένα εμπόδιο. Δηλαδή ο χρήστης
      // έκανε τη δουλειά και η εφαρμογή του ζητούσε να την ξανακάνει.
      _count: { select: { allocations: true } },
    },
  });
  const tally = new Map(ids.map((id) => [id, { total: 0, matched: 0 }]));
  for (const l of lines) {
    const t = tally.get(l.documentId);
    if (!t) continue;
    t.total++;
    // `_count` με `?.`: μια γραμμή χωρίς το πεδίο (παλιοί καλούντες, mocks) μετράει ως «χωρίς
    // επιμερισμό» αντί να ρίξει ολόκληρο τον υπολογισμό των συνόλων.
    const hasAlloc = (l._count?.allocations ?? 0) > 0;
    if (l.softoneMtrl != null || l.softoneExpn != null || l.softoneLinMtrl != null || l.softoneAsset != null || hasAlloc) t.matched++;
  }
  await Promise.all(Array.from(tally.entries()).map(([id, t]) => writeDocTally(id, t.total, t.matched)));
}

/** Τα πεδία αντιστοίχισης μιας γραμμής — γράφονται μαζί, ποτέ μισά. */
type LineMatchUpdate = {
  softoneMtrl: number | null;
  softoneExpn: number | null;
  softoneLinMtrl: number | null;
  /** Αναλυτική από τη μνήμη· `undefined` = μην την αγγίξεις (π.χ. αντιστοίχιση με κωδικό). */
  softoneCostCntr?: number | null;
  softonePrjc?: number | null;
  softonePrjcStage?: number | null;
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
 * Λογαριασμός κοινής ωφέλειας ή μίσθωσης οχημάτων ⇒ κατηγορία «Έξοδο», ΜΟΝΟ αν δεν έχει ήδη
 * κατηγορία (η επιλογή του χρήστη δεν αλλάζει ποτέ). Η κατηγορία είναι εμπόδιο καταχώρισης
 * (`no_category`), και εδώ η απάντηση δεν χρειάζεται άνθρωπο.
 */
export async function applyUtilityCategory(docId: string): Promise<boolean> {
  const d = await prisma.ocrDocument.findUnique({
    where: { id: docId },
    select: { category: true, issuerAfm: true, document: true, items: { select: { name: true, vatRate: true, total: true } } },
  });
  if (!d || d.category || !detectUtilityForItems(d.document, d.issuerAfm, d.items)) return false;
  await prisma.ocrDocument.update({ where: { id: docId }, data: { category: 'EXPENSE' } });
  return true;
}

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
    select: {
      id: true, code: true, name: true, vatRate: true, total: true,
      softoneMatchedBy: true, softoneMtrl: true, softoneExpn: true, softoneLinMtrl: true, softoneAsset: true,
    },
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
  const unmatched: { id: string; pattern: string; utilityKeys: string[] }[] = [];
  let matched = 0;

  // ── 1. Πέρασμα κωδικού ──────────────────────────────────────────────
  for (const it of items) {
    // Χειροκίνητη γραμμή: δεν την ξαναγράφουμε, αλλά μετράει ως αντιστοιχισμένη ΜΟΝΟ αν
    // κρατάει πράγματι είδος ή έξοδο — ίδιος κανόνας με το `refreshDocTallies`.
    if (it.softoneMatchedBy === 'manual') {
      if (it.softoneMtrl != null || it.softoneExpn != null || it.softoneLinMtrl != null || it.softoneAsset != null) matched++;
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
    if (pattern) unmatched.push({ id: it.id, pattern, utilityKeys: [] });
  }

  // ── 2. Πέρασμα μνήμης (LineMatchRule) ───────────────────────────────
  if (unmatched.length > 0) {
    // Ο ΑΦΜ εκδότη είναι ΣΤΗΛΗ (`issuerAfm = normalizeAfm(document.issuer.vat)`) — ΤΟ ΙΔΙΟ κλειδί
    // που γράφει η μνήμη (ουρά «Είδη & έξοδα» και σελίδα παραστατικού). Η παλιά παραγωγή από το
    // JSON με `replace(/\D+/g,'')` έκοβε το πρόθεμα χώρας, οπότε κανόνας ξένου εκδότη
    // (`DE144960040`) δεν μπορούσε ΠΟΤΕ να βρεθεί.
    const doc = await prisma.ocrDocument.findUnique({
      where: { id: docId }, select: { issuerAfm: true, document: true, softoneSeries: true, seriesSource: true },
    });
    const afm = doc?.issuerAfm ?? '';
    // Ο «κόσμος» της σειράς (αγορές / ειδικές συναλλαγές): ποιο μητρώο χωράει — βλ. `memory-scope.ts`.
    const ref = { seriesSource: doc?.seriesSource ?? null, softoneSeries: doc?.softoneSeries ?? null };
    const sk = seriesKey(ref);
    const world = sk ? worldOfLines((await postingTargetsForSeries([ref]).catch(() => new Map())).get(sk)?.lines) : null;

    // Σταθερά κλειδιά ΠΕΡΑ από το κείμενο, γιατί το κείμενο αλλάζει από μήνα σε μήνα και από
    // εκδότη σε εκδότη: (α) λογαριασμός ρεύματος/νερού/τηλεφώνου → είδος χρέωσης
    // (`@utility:electricity:consumption`), (β) κάθε παραστατικό → οικογένεια δαπάνης
    // (`@family:freight`), ώστε ο ναύλος ενός άγνωστου μεταφορέα να βρει την απόφαση για τον
    // προηγούμενο. Πρώτα τα κλειδιά λογαριασμού, μετά της οικογένειας.
    const utility = detectUtilityForItems(doc?.document, afm, items);
    const byId = new Map(items.map((it) => [it.id, it]));
    for (const u of unmatched) {
      const it = byId.get(u.id)!;
      const vatRate = it.vatRate == null ? null : Number(it.vatRate);
      const charge = utility
        ? classifyUtilityCharge(utility.kind, { name: it.name, vatRate, amount: it.total == null ? null : Number(it.total) })
        : null;
      const family = classifyExpenseFamily(it.name);
      u.utilityKeys = [
        ...(utility && charge ? scopeKeys(utilityMemoryKeys(utility.kind, charge, vatRate), world) : []),
        ...(family ? scopeKeys(familyMemoryKeys(family, vatRate), world) : []),
      ];
    }

    const patterns = Array.from(new Set(unmatched.flatMap((u) => [u.pattern, ...u.utilityKeys])));
    const rules = await prisma.lineMatchRule.findMany({
      where: { pattern: { in: patterns }, afm: { in: afm ? [afm, ''] : [''] } },
      select: {
        id: true, afm: true, pattern: true, mtrl: true, expn: true, lin: true, isService: true,
        costCntr: true, prjc: true, prjcStage: true,
      },
    });

    if (rules.length > 0) {
      // Σειρά προτίμησης: κείμενο του εκδότη → είδος χρέωσης του εκδότη (με ΦΠΑ, μετά χωρίς) → γενικό
      // κείμενο → γενικό είδος χρέωσης (με ΦΠΑ, μετά χωρίς). Ο εκδότης κερδίζει πάντα· το ακριβές
      // κείμενο κερδίζει το είδος χρέωσης· ο ΦΠΑ κερδίζει το σκέτο είδος.
      // Κανόνας με στόχο που δεν χωράει στη σειρά του παραστατικού (π.χ. έξοδο σε ειδικές συναλλαγές)
      // δεν εφαρμόζεται ποτέ: θα γέμιζε τη γραμμή και θα μπλόκαρε την καταχώριση.
      const byKey = new Map(rules.filter((r) => ruleFitsWorld(r, world)).map((r) => [`${r.afm}|${r.pattern}`, r]));
      const first = (prefix: string, keys: string[]) => keys.map((k) => byKey.get(`${prefix}|${k}`)).find(Boolean);
      const ruleFor = (u: (typeof unmatched)[number]) =>
        (afm ? byKey.get(`${afm}|${u.pattern}`) : undefined)
        ?? (afm ? first(afm, u.utilityKeys) : undefined)
        ?? byKey.get(`|${u.pattern}`)
        ?? first('', u.utilityKeys);
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
        const r = ruleFor(u);
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
          // Κανόνας μνήμης σε «Έξοδο» (EXPN): ΔΕΝ εφαρμόζεται πια — η SoftOne απορρίπτει πάντα τη γραμμή
          // EXPANAL από τη σύνδεση. Καλύτερα αναντιστοίχιστη (ο χρήστης διαλέγει υπηρεσία) παρά «έτοιμη»
          // γραμμή που θα σταματούσε στην καταχώριση.
          void expenseByExpn;
          continue;
        } else if (r.lin != null) {
          const l = lineItemByMtrl.get(r.lin);
          data = {
            softoneMtrl: null, softoneExpn: null, softoneLinMtrl: r.lin,
            softoneCode: l?.code ?? null, softoneName: l?.name ?? null,
            softoneIsService: false, softoneMatchedBy: 'memory',
          };
        }
        if (!data) continue;
        // Η αναλυτική που έμαθε ο κανόνας εφαρμόζεται μαζί με το είδος: αυτό ακριβώς ζήτησε ο
        // χρήστης («αν το κάνει μια φορά να το θυμάται»). Παραμένει επεξεργάσιμη στη γραμμή.
        if (r.costCntr != null) data.softoneCostCntr = r.costCntr;
        if (r.prjc != null) data.softonePrjc = r.prjc;
        if (r.prjcStage != null) data.softonePrjcStage = r.prjcStage;
        updates.set(u.id, data);
        matched++;
        usage.set(r.id, (usage.get(r.id) ?? 0) + 1);
      }

      await Promise.all(Array.from(usage.entries()).map(([id, n]) =>
        prisma.lineMatchRule.update({ where: { id }, data: { timesUsed: { increment: n } } }).catch(() => {}),
      ));
    }
  }

  // Γράφονται ΜΟΝΟ όσες γραμμές αλλάζουν. Η επανεφαρμογή μνήμης περνά από δεκάδες παραστατικά σε
  // κάθε κλικ· ένα UPDATE ανά αμετάβλητη γραμμή έκανε το κλικ να κρατά ~10 δευτερόλεπτα.
  const prior = new Map(items.map((it) => [it.id, it]));
  const unchanged = (id: string, data: LineMatchUpdate) => {
    const p = prior.get(id);
    if (!p) return false;
    // Ήταν ΗΔΗ (ρητά) αταίριαστη και μένει αταίριαστη.
    const stillNone = data.softoneMatchedBy === null && data.softoneMtrl === null && data.softoneExpn === null && data.softoneLinMtrl === null
      && p.softoneMatchedBy === null && p.softoneMtrl === null && p.softoneExpn === null && p.softoneLinMtrl === null;
    // Ίδιος στόχος από τη μνήμη, χωρίς αναλυτική να γραφτεί.
    const sameMemory = data.softoneMatchedBy === 'memory' && p.softoneMatchedBy === 'memory'
      && (data.softoneMtrl ?? null) === p.softoneMtrl && (data.softoneExpn ?? null) === p.softoneExpn && (data.softoneLinMtrl ?? null) === p.softoneLinMtrl
      && data.softoneCostCntr === undefined && data.softonePrjc === undefined && data.softonePrjcStage === undefined;
    return stillNone || sameMemory;
  };
  await Promise.all(Array.from(updates.entries()).filter(([id, data]) => !unchanged(id, data)).map(([id, data]) =>
    prisma.ocrInvoiceItem.update({ where: { id }, data }),
  ));

  // Persist the line-match tally so the reconciliation status can be derived cheaply.
  await writeDocTally(docId, items.length, matched);

  return { matched, total: items.length };
}

/**
 * Ευθυγραμμίζει τον συναλλασσόμενο του εγγράφου με ΤΟΝ ΤΥΠΟ που δέχεται ο στόχος της σειράς του.
 *
 * Ο ίδιος εκδότης υπάρχει συχνά δύο φορές στο SoftOne — μία ως προμηθευτής (SODTYPE 12) και μία
 * ως πιστωτής (16) — και η αντιστοίχιση στο σάρωμα προτιμά τον προμηθευτή, γιατί τότε ακόμη δεν
 * ξέρουμε σε ποια σειρά θα ταξινομηθεί το παραστατικό. Μόλις η σειρά γίνει γνωστή, ξέρουμε και τι
 * θέλει η κεφαλίδα: `LINCREDOC.TRDR` δέχεται ΠΙΣΤΩΤΗ, `PURDOC`/`LINSUPDOC` ΠΡΟΜΗΘΕΥΤΗ.
 *
 * Ψάχνει ΜΟΝΟ στον τοπικό καθρέφτη — καμία κλήση SoftOne, καμία εγγραφή προς το ERP. Αν δεν
 * υπάρχει ο σωστός τύπος, δεν αλλάζει τίποτα: ο έλεγχος `trader_kind_mismatch` θα το πει δυνατά
 * στην προεπισκόπηση, και ο χρήστης θα διαλέξει συναλλασσόμενο μόνος του.
 */
export async function alignTraderToTarget(docId: string): Promise<boolean> {
  try {
    const doc = await prisma.ocrDocument.findUnique({
      where: { id: docId },
      select: { issuerAfm: true, softoneTrdr: true, softoneSeries: true, seriesSource: true },
    });
    if (!doc?.softoneTrdr || !doc.issuerAfm || !doc.softoneSeries || !doc.seriesSource) return false;

    // Η αλυσίδα «σειρά → object → SODTYPE» ζει σε ΕΝΑ σημείο (`lib/ocr/required-trader-kind.ts`)
    // και τη μοιράζονται η ουρά και η αρχική σύνδεση: δεν μπορούν να διαφωνήσουν.
    const required = await requiredTraderKind(doc);
    if (!required) return false;

    const want = required.sodtype;
    const current = await prisma.softoneTrader.findUnique({
      where: { trdr: doc.softoneTrdr }, select: { sodtype: true },
    });
    if (current?.sodtype === want) return false;

    const alt = await prisma.softoneTrader.findFirst({
      where: { afm: doc.issuerAfm, sodtype: want, isActive: true },
      select: { trdr: true, code: true, name: true, sodtype: true },
    });
    if (!alt) return false;

    await prisma.ocrDocument.update({
      where: { id: docId },
      data: {
        softoneTrdr: alt.trdr,
        softoneCode: alt.code,
        softoneName: alt.name,
        softoneKind: SODTYPE_LABEL[alt.sodtype] ?? `Τύπος ${alt.sodtype}`,
      },
    });
    return true;
  } catch (e) {
    // Best-effort, όπως όλη η συσχέτιση: μια αποτυχία εδώ δεν ρίχνει τη σάρωση.
    console.error('[softone-match] trader alignment failed', docId, (e as Error).message);
    return false;
  }
}
