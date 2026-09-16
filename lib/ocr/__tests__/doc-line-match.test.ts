// lib/ocr/__tests__/doc-line-match.test.ts
//
// Ο ΒΡΟΧΟΣ ΕΚΠΑΙΔΕΥΣΗΣ, από άκρη σε άκρη, με mocked Prisma:
//
//   1. Ο χρήστης αντιστοιχίζει ΜΙΑ γραμμή από τη σελίδα του παραστατικού
//      (`applyMatchToLine`) → γράφεται `LineMatchRule` με ΤΟ ΙΔΙΟ κλειδί που γράφει η ουρά
//      «Είδη & έξοδα» (`applyMatchToGroup`): ΑΦΜ εκδότη (`OcrDocument.issuerAfm`) +
//      `normalizeLineText` του κειμένου της γραμμής.
//   2. Το ΕΠΟΜΕΝΟ παραστατικό του ίδιου εκδότη με την ίδια περιγραφή περνά από το
//      ΠΡΑΓΜΑΤΙΚΟ πέρασμα μνήμης του `matchDocItems` και έρχεται συμπληρωμένο, χωρίς
//      καμία ενέργεια του χρήστη.
//
// Η μνήμη εδώ είναι ένα μικρό in-memory store: ό,τι γράφει το βήμα 1 το διαβάζει το βήμα 2.
import { describe, it, expect, beforeEach, vi } from 'vitest';

type Rule = {
  id: string; afm: string; pattern: string;
  mtrl: number | null; expn: number | null; lin: number | null;
  costCntr: number | null; prjc: number | null; prjcStage: number | null;
  isService: boolean; timesUsed: number; createdById: string | null;
};

const { db, store } = vi.hoisted(() => {
  const store = {
    rules: [] as Rule[],
    lines: new Map<string, Record<string, unknown>>(),
    docs: new Map<string, Record<string, unknown>>(),
  };
  return {
    store,
    db: {
      ocrDocument: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), groupBy: vi.fn() },
      ocrInvoiceItem: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
      ignoredIssuer: { findMany: vi.fn() },
      softoneTrader: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
      softoneItem: { findMany: vi.fn(), findUnique: vi.fn() },
      softoneExpense: { findMany: vi.fn(), findUnique: vi.fn() },
      softoneLineItem: { findMany: vi.fn(), findUnique: vi.fn() },
      softoneCostCenter: { findMany: vi.fn(), findUnique: vi.fn() },
      softoneProject: { findMany: vi.fn(), findUnique: vi.fn() },
      softoneProjectStage: { findMany: vi.fn(), findUnique: vi.fn() },
      softoneMyDataClassType: { findMany: vi.fn() },
      softoneMyDataClassCategory: { findMany: vi.fn() },
      purchaseDocType: { findUnique: vi.fn() },
      softoneDocSeries: { findUnique: vi.fn() },
      lineMatchRule: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
      $transaction: vi.fn(),
    },
  };
});

vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/softone', () => ({
  softoneFindTraderByAfm: vi.fn(),
  softoneCheckPurchaseDoc: vi.fn(),
  SODTYPE_LABEL: { 12: 'Προμηθευτής', 13: 'Πελάτης', 15: 'Χρεώστης', 16: 'Πιστωτής' } as Record<number, string>,
  TRADER_KIND_SODTYPE: { supplier: 12, creditor: 16, debtor: 15 },
}));

import { normalizeLineText } from '../line-match';
import { matchDocItems } from '../softone-match';
import {
  applyMatchToLine, applyMatchToGroup, clearLineMatch, QueueError, UNMATCHED_LINE_WHERE,
} from '../queues';

/** Το ΑΚΡΙΒΕΣ κείμενο της γραμμής, όπως το τυπώνει ο εκδότης — σε δύο διαφορετικά παραστατικά. */
const PRINTED = 'ΧΡΕΩΣΗ ΧΡΗΣΗΣ ΔΙΚΤΥΟΥ 1.250,5 kWh';
const AFM = 'DE144960040';

const EXPENSE = { expn: 9, code: 'ΕΞ-01', name: 'Ηλεκτρικό ρεύμα' };
const ITEM = { mtrl: 77, code: '76-71106', name: 'Ξηρός πάγος', isService: false };
const LINEITEM = { mtrl: 53001, code: '53-0001', name: 'Τέλη δικτύου' };

/** Το ίδιο `where` που χρησιμοποιεί η ουρά — η ΜΟΝΗ πηγή για το «εκκρεμής γραμμή». */
function isPending(row: Record<string, unknown>): boolean {
  const w = UNMATCHED_LINE_WHERE as Record<string, unknown>;
  for (const k of ['softoneMtrl', 'softoneExpn', 'softoneLinMtrl'] as const) {
    // Το where απαιτεί `null` σε ΚΑΙ ΤΙΣ ΤΡΕΙΣ στήλες.
    expect(w[k]).toBeNull();
    if (row[k] != null) return false;
  }
  return row.softoneMatchedBy !== 'skipped';
}

const lastUpdateFor = (id: string) =>
  db.ocrInvoiceItem.update.mock.calls.map((c) => c[0]).filter((a) => a.where.id === id).pop()?.data as
    Record<string, unknown> | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  store.rules = [];
  store.lines.clear();
  store.docs.clear();

  db.ocrDocument.update.mockResolvedValue({});
  db.ocrDocument.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
    store.docs.get(where.id) ?? null);
  db.ocrInvoiceItem.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
    store.lines.get(where.id) ?? null);
  db.ocrInvoiceItem.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
    Object.assign(store.lines.get(where.id) ?? {}, data);
    return {};
  });
  db.ocrInvoiceItem.updateMany.mockResolvedValue({ count: 0 });
  db.ocrInvoiceItem.findMany.mockResolvedValue([]);
  db.softoneItem.findMany.mockResolvedValue([]);
  db.softoneItem.findUnique.mockImplementation(async ({ where }: { where: { mtrl: number } }) =>
    (where.mtrl === ITEM.mtrl ? ITEM : null));
  db.softoneExpense.findMany.mockResolvedValue([]);
  db.softoneExpense.findUnique.mockImplementation(async ({ where }: { where: { expn: number } }) =>
    (where.expn === EXPENSE.expn ? EXPENSE : null));
  db.softoneLineItem.findMany.mockResolvedValue([]);
  db.softoneLineItem.findUnique.mockImplementation(async ({ where }: { where: { mtrl: number } }) =>
    (where.mtrl === LINEITEM.mtrl ? LINEITEM : null));

  // ── Η μνήμη ως πραγματικό store: upsert γράφει, findMany διαβάζει ──────────
  db.lineMatchRule.upsert.mockImplementation(async (
    { where, update, create }: { where: { afm_pattern: { afm: string; pattern: string } }; update: Record<string, unknown>; create: Record<string, unknown> },
  ) => {
    const { afm, pattern } = where.afm_pattern;
    const hit = store.rules.find((r) => r.afm === afm && r.pattern === pattern);
    if (hit) {
      const inc = (update.timesUsed as { increment?: number } | undefined)?.increment ?? 0;
      Object.assign(hit, { ...update, timesUsed: hit.timesUsed + inc });
      return hit;
    }
    const row = { id: `rule${store.rules.length + 1}`, timesUsed: 0, ...create } as Rule;
    store.rules.push(row);
    return row;
  });
  db.lineMatchRule.findMany.mockImplementation(async (
    { where }: { where: { pattern: { in: string[] }; afm: { in: string[] } } },
  ) => store.rules.filter((r) => where.pattern.in.includes(r.pattern) && where.afm.in.includes(r.afm)));
  db.lineMatchRule.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: { timesUsed: { increment: number } } }) => {
    const r = store.rules.find((x) => x.id === where.id);
    if (r) r.timesUsed += data.timesUsed.increment;
    return r;
  });
});

/** Ένα παραστατικό με μία γραμμή, στο in-memory store. */
function seedDoc(docId: string, lineId: string, name = PRINTED, afm: string | null = AFM) {
  store.docs.set(docId, { id: docId, issuerAfm: afm, extractedData: { vatNumber: afm } });
  store.lines.set(lineId, {
    id: lineId, documentId: docId, code: null, name,
    softoneMtrl: null, softoneExpn: null, softoneLinMtrl: null,
    softoneCode: null, softoneName: null, softoneIsService: null, softoneMatchedBy: null,
    softoneCostCntr: null, softonePrjc: null, softonePrjcStage: null,
  });
}

describe('applyMatchToLine — η απόφαση της σελίδας παραστατικού', () => {
  it('γράφει ΕΞΟΔΟ στη γραμμή και μνήμη με κλειδί «issuerAfm + normalizeLineText»', async () => {
    seedDoc('doc1', 'l1');

    const r = await applyMatchToLine({ lineId: 'l1', target: { expn: EXPENSE.expn }, userId: 'u1' });

    expect(r.kind).toBe('expense');
    expect(r.remembered).toBe(true);
    expect(lastUpdateFor('l1')).toMatchObject({
      softoneExpn: EXPENSE.expn, softoneMtrl: null, softoneLinMtrl: null,
      softoneCode: EXPENSE.code, softoneName: EXPENSE.name, softoneMatchedBy: 'manual',
    });
    // Το κλειδί είναι ΤΟ ΙΔΙΟ που θα παρήγαγε η ομαδοποίηση της ουράς.
    expect(store.rules).toHaveLength(1);
    expect(store.rules[0]).toMatchObject({
      afm: AFM, pattern: normalizeLineText(PRINTED), expn: EXPENSE.expn, mtrl: null, lin: null, createdById: 'u1',
    });
    // Το ξένο VAT id κρατά το πρόθεμα χώρας — δεν «καθαρίζεται» σε σκέτα ψηφία.
    expect(store.rules[0].pattern).toBe('χρεωση χρησης δικτυου kwh');
    expect(store.rules[0].afm).toBe('DE144960040');
    // Και τα σύνολα του παραστατικού ξαναγράφτηκαν.
    expect(db.ocrDocument.update).toHaveBeenCalledWith({ where: { id: 'doc1' }, data: { itemsTotal: 0, itemsMatched: 0 } });
  });

  it('ΧΡΕΟΠΙΣΤΩΣΗ: γράφει `softoneLinMtrl`, ποτέ υπηρεσία', async () => {
    seedDoc('doc1', 'l1');
    const r = await applyMatchToLine({ lineId: 'l1', target: { lin: LINEITEM.mtrl }, isService: true });
    expect(r.kind).toBe('lineitem');
    expect(lastUpdateFor('l1')).toMatchObject({
      softoneLinMtrl: LINEITEM.mtrl, softoneMtrl: null, softoneExpn: null, softoneIsService: false,
    });
    expect(store.rules[0]).toMatchObject({ lin: LINEITEM.mtrl, isService: false });
  });

  it('ΕΙΔΟΣ: το `isService` έρχεται από το μητρώο, όχι από τον καλούντα', async () => {
    seedDoc('doc1', 'l1');
    const r = await applyMatchToLine({ lineId: 'l1', target: { mtrl: ITEM.mtrl }, isService: true });
    expect(r.kind).toBe('product');
    expect(lastUpdateFor('l1')).toMatchObject({ softoneMtrl: ITEM.mtrl, softoneIsService: false });
  });

  it('ο χρήστης αλλάζει γνώμη: ο ΙΔΙΟΣ κανόνας ξαναγράφεται, ο παλιός στόχος σβήνει', async () => {
    seedDoc('doc1', 'l1');
    await applyMatchToLine({ lineId: 'l1', target: { expn: EXPENSE.expn } });
    await applyMatchToLine({ lineId: 'l1', target: { mtrl: ITEM.mtrl } });

    expect(store.rules).toHaveLength(1);
    expect(store.rules[0]).toMatchObject({ mtrl: ITEM.mtrl, expn: null, lin: null, timesUsed: 1 });
    expect(lastUpdateFor('l1')).toMatchObject({ softoneMtrl: ITEM.mtrl, softoneExpn: null });
  });

  it('η σελίδα και η ουρά παράγουν ΤΟ ΙΔΙΟ κλειδί μνήμης', async () => {
    seedDoc('doc1', 'l1');
    await applyMatchToLine({ lineId: 'l1', target: { expn: EXPENSE.expn } });
    const fromPage = store.rules[0];

    // Η ουρά, με το ίδιο ΑΦΜ/pattern που παράγει η ομαδοποίησή της.
    store.rules = [];
    db.ocrInvoiceItem.findMany.mockResolvedValue([
      { id: 'l9', documentId: 'doc9', code: null, name: PRINTED, quantity: null, price: null, total: null, softoneIsService: null },
    ]);
    db.ocrDocument.findMany.mockResolvedValue([
      { id: 'doc9', fileName: 'x.pdf', extractedData: {}, softoneName: null, issuerAfm: AFM, softoneTrdr: null },
    ]);
    await applyMatchToGroup({ afm: AFM, pattern: normalizeLineText(PRINTED), target: { expn: EXPENSE.expn } });

    expect(store.rules[0].afm).toBe(fromPage.afm);
    expect(store.rules[0].pattern).toBe(fromPage.pattern);
    expect(store.rules[0].expn).toBe(fromPage.expn);
  });

  it('κείμενο που κανονικοποιείται σε κενό δεν γράφει κανόνα-φάντασμα', async () => {
    seedDoc('doc1', 'l1', '12,50');
    const r = await applyMatchToLine({ lineId: 'l1', target: { expn: EXPENSE.expn } });
    expect(r.remembered).toBe(false);
    expect(store.rules).toHaveLength(0);
    // Η ΓΡΑΜΜΗ όμως αντιστοιχίστηκε κανονικά.
    expect(lastUpdateFor('l1')).toMatchObject({ softoneExpn: EXPENSE.expn });
  });

  it('άγνωστος στόχος → 404 με τον κωδικό του μητρώου', async () => {
    seedDoc('doc1', 'l1');
    await expect(applyMatchToLine({ lineId: 'l1', target: { expn: 4242 } })).rejects.toMatchObject({
      code: 'expense_not_found', status: 404,
    });
    await expect(applyMatchToLine({ lineId: 'nope', target: { expn: EXPENSE.expn } })).rejects.toBeInstanceOf(QueueError);
    // Καμία μνήμη δεν γράφτηκε από αποτυχία.
    expect(store.rules).toHaveLength(0);
  });
});

describe('η γραμμή φεύγει από / γυρίζει στην ουρά «Είδη & έξοδα»', () => {
  it('αντιστοίχιση στη σελίδα ⇒ η γραμμή δεν είναι πια εκκρεμής', async () => {
    seedDoc('doc1', 'l1');
    expect(isPending(store.lines.get('l1')!)).toBe(true);

    await applyMatchToLine({ lineId: 'l1', target: { expn: EXPENSE.expn } });

    expect(isPending(store.lines.get('l1')!)).toBe(false);
  });

  it('καθαρισμός ⇒ γυρίζει εκκρεμής, ΧΩΡΙΣ να κουβαλά την αναλυτική της προηγούμενης', async () => {
    seedDoc('doc1', 'l1');
    await applyMatchToLine({ lineId: 'l1', target: { mtrl: ITEM.mtrl }, analytics: { costCntr: 5, prjc: 7 } });
    expect(store.lines.get('l1')).toMatchObject({ softoneCostCntr: 5, softonePrjc: 7 });

    await clearLineMatch('l1');

    const row = store.lines.get('l1')!;
    expect(isPending(row)).toBe(true);
    expect(row).toMatchObject({
      softoneMtrl: null, softoneExpn: null, softoneLinMtrl: null, softoneCode: null, softoneName: null,
      softoneIsService: null, softoneMatchedBy: null,
      softoneCostCntr: null, softonePrjc: null, softonePrjcStage: null,
    });
  });
});

describe('ο βρόχος εκπαίδευσης — το ΕΠΟΜΕΝΟ παραστατικό συμπληρώνεται μόνο του', () => {
  it('μια απόφαση στη σελίδα κάνει το επόμενο παραστατικό του ίδιου εκδότη να έρθει έτοιμο', async () => {
    // 1. Ο χρήστης αποφασίζει, μία φορά, πάνω στο ΠΡΩΤΟ παραστατικό.
    seedDoc('doc1', 'l1');
    await applyMatchToLine({ lineId: 'l1', target: { expn: EXPENSE.expn }, analytics: { costCntr: 5, prjc: 7 } });
    expect(store.rules).toHaveLength(1);

    // 2. ΔΕΥΤΕΡΟ παραστατικό, ίδιος εκδότης, ίδια περιγραφή (με άλλα νούμερα μέσα).
    seedDoc('doc2', 'l2', 'Χρέωση Χρήσης Δικτύου 980,25 kWh');
    db.ocrInvoiceItem.findMany.mockResolvedValue([
      {
        id: 'l2', code: null, name: 'Χρέωση Χρήσης Δικτύου 980,25 kWh',
        softoneMatchedBy: null, softoneMtrl: null, softoneExpn: null, softoneLinMtrl: null,
      },
    ]);
    db.softoneExpense.findMany.mockResolvedValue([EXPENSE]);

    const r = await matchDocItems('doc2');

    // Καμία ενέργεια χρήστη — το πέρασμα μνήμης το συμπλήρωσε.
    expect(r).toEqual({ matched: 1, total: 1 });
    expect(lastUpdateFor('l2')).toMatchObject({
      softoneExpn: EXPENSE.expn, softoneMtrl: null, softoneLinMtrl: null,
      softoneCode: EXPENSE.code, softoneName: EXPENSE.name, softoneMatchedBy: 'memory',
      // Η αναλυτική που έμαθε ο κανόνας ταξιδεύει μαζί.
      softoneCostCntr: 5, softonePrjc: 7,
    });
    expect(store.rules[0].timesUsed).toBe(1);
  });

  it('ΞΕΝΟΣ εκδότης: το `issuerAfm` (με πρόθεμα χώρας) είναι το κλειδί — όχι σκέτα ψηφία', async () => {
    seedDoc('doc1', 'l1');
    await applyMatchToLine({ lineId: 'l1', target: { mtrl: ITEM.mtrl } });

    seedDoc('doc2', 'l2');
    db.ocrInvoiceItem.findMany.mockResolvedValue([
      { id: 'l2', code: null, name: PRINTED, softoneMatchedBy: null, softoneMtrl: null, softoneExpn: null, softoneLinMtrl: null },
    ]);
    db.softoneItem.findMany.mockResolvedValue([ITEM]);

    await matchDocItems('doc2');

    // Το ερώτημα μνήμης ζήτησε ακριβώς τα `['DE144960040', '']` — αν ο κώδικας έκοβε το
    // πρόθεμα (`144960040`), ο κανόνας του εκδότη δεν θα βρισκόταν ΠΟΤΕ.
    const call = db.lineMatchRule.findMany.mock.calls.at(-1)![0] as { where: { afm: { in: string[] } } };
    expect(call.where.afm.in).toEqual([AFM, '']);
    expect(lastUpdateFor('l2')).toMatchObject({ softoneMtrl: ITEM.mtrl, softoneMatchedBy: 'memory' });
  });

  it('χειροκίνητη γραμμή δεν ξαναγράφεται από τη μνήμη σε επόμενο πέρασμα', async () => {
    seedDoc('doc1', 'l1');
    await applyMatchToLine({ lineId: 'l1', target: { expn: EXPENSE.expn } });

    db.ocrInvoiceItem.findMany.mockResolvedValue([
      { id: 'l1', code: null, name: PRINTED, softoneMatchedBy: 'manual', softoneMtrl: null, softoneExpn: EXPENSE.expn, softoneLinMtrl: null },
    ]);
    db.ocrInvoiceItem.update.mockClear();

    const r = await matchDocItems('doc1');

    expect(r).toEqual({ matched: 1, total: 1 });
    expect(db.ocrInvoiceItem.update).not.toHaveBeenCalled();
  });
});
