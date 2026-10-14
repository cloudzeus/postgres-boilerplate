// lib/ocr/accounts-overview.ts — SERVER. Η σελίδα «Λογιστικό σχέδιο»: τι λείπει, τι χρειάζεται, τι υπάρχει.
//
// Δύο λίστες εργασίας και μία αναφοράς:
//  1. Λογαριασμοί που ΛΕΙΠΟΥΝ — όσοι θα χρειαστούν γραμμές ανοιχτών παραστατικών (μέσω της
//     χρεοπίστωσής τους) και δεν υπάρχουν / δεν κινούνται στο σχέδιο. Ίδιος έλεγχος με την
//     προεπισκόπηση καταχώρισης (`checkAccounts`), απλώς για ΟΛΑ τα ανοιχτά παραστατικά μαζί.
//  2. Χρεώσεις λογαριασμών κοινής ωφέλειας ΧΩΡΙΣ χρεοπίστωση — με τους λογαριασμούς του σχεδίου
//     που ταιριάζουν, ώστε ο χρήστης να ξέρει σε ποιον να βασίσει τη νέα χρεοπίστωση.
//  3. Ολόκληρο το σχέδιο, από τον καθρέφτη.
//
// ΚΑΜΙΑ εγγραφή εδώ — μόνο ανάγνωση. Το άνοιγμα λογαριασμού ζει στο `lib/softone-sync/gl-account-create.ts`
// (object ACNTGL, μία εγγραφή· ΠΟΤΕ το ACNT, που κρατά όλο το σχέδιο σε μία εγγραφή).
import 'server-only';
import { prisma } from '@/lib/db';
import { checkAccounts, type AccountStatus } from './account-check';
import { loadAccountChart } from './account-chart';
import { detectUtilityForItems } from './softone-match';
import { normalizeGreek } from './doc-type-classify';
import { cachedInactiveLineItems, type InactiveLineItem } from '@/lib/softone-sync/lineitem-activate';
import {
  classifyUtilityCharge, UTILITY_CHARGE_LABEL, UTILITY_KIND_LABEL, type UtilityCharge, type UtilityKind,
} from './utility-bills';
import { classifyExpenseFamily, EXPENSE_FAMILY_LABEL, FAMILY_REGISTRY_HINT, type ExpenseFamily } from './expense-families';
import {
  accountPath, EXPENSE_ACCOUNT_PREFIXES, foldName, proposeFamilyAccounts, vatOfAccount, type ChartAccount,
} from './scan-accounts';
import { postingTargetsForSeries, seriesKey } from './required-trader-kind';
import { worldOfLines, type MemoryWorld } from './memory-scope';

export interface DocRef { id: string; fileName: string }

export interface MissingAccount {
  account: string | null;
  status: AccountStatus;
  /** Η χρεοπίστωση που δείχνει εκεί, «κωδικός — περιγραφή». */
  article: string | null;
  lines: number;
  docs: DocRef[];
  parent: { code: string; name: string } | null;
  /** Πρόταση ονόματος για το SoftOne — από τον γονικό και την κατάληξη ΦΠΑ. */
  proposedName: string | null;
  /** Ο ΦΠΑ που κωδικοποιεί η κατάληξη (…0024 → 24) — για το άνοιγμα του λογαριασμού. */
  vatRate: number | null;
  message: string;
}

export interface UtilityGap {
  kind: UtilityKind;
  charge: UtilityCharge;
  label: string;
  lines: number;
  docs: DocRef[];
  /** Κινούμενοι λογαριασμοί του σχεδίου που ταιριάζουν στο είδος χρέωσης — ΠΡΟΤΑΣΕΙΣ. */
  suggestions: { code: string; name: string }[];
  /** Ο συνηθέστερος ΦΠΑ των γραμμών (`null` = άγνωστος / μικτός χωρίς πλειοψηφία). */
  vatRate: number | null;
  /**
   * Ο λογαριασμός που ΛΕΙΠΕΙ για αυτόν τον ΦΠΑ, όταν οι προτάσεις έχουν αδέλφια με άλλους
   * συντελεστές αλλά όχι με τον σωστό (π.χ. 62.02.00.0013 όταν υπάρχουν μόνο 0009/0019).
   */
  toOpen: { code: string; name: string | null; vatRate: number | null } | null;
  /**
   * ΑΝΕΝΕΡΓΕΣ χρεοπιστώσεις του SoftOne για αυτό το είδος χρέωσης (πρώτα του σωστού ΦΠΑ) —
   * ενεργοποίηση αντί για δημιουργία νέας.
   */
  inactive: InactiveLineItem[];
}

export interface ChartRow {
  code: string;
  name: string;
  grade: number | null;
  postable: boolean | null;
  active: boolean;
  /** Πόσες ενεργές χρεοπιστώσεις έχουν αυτόν τον λογαριασμό στο ACNMSK. */
  lineItems: number;
}

const BLOCKING: readonly AccountStatus[] = ['missing', 'not_in_chart', 'not_postable', 'mask'];
const OPEN_DOCS = { status: 'COMPLETED' as const, postStatus: { not: 'POSTED' as const } };

/** «…0024» → 24, μόνο για συντελεστές που υπάρχουν στην Ελλάδα. */
function vatOfSuffix(code: string): number | null {
  const m = /\.00(\d\d)$/.exec(code);
  if (!m) return null;
  const n = Number(m[1]);
  return [0, 4, 6, 9, 13, 16, 17, 19, 23, 24].includes(n) ? n : null;
}

export function proposeAccountName(code: string, parentName: string | null): string | null {
  if (!parentName) return null;
  const vat = vatOfSuffix(code);
  const base = parentName.replace(/\s+(με|άνευ)\s+Φ\.?Π\.?Α\.?.*$/i, '').trim();
  if (vat == null) return base;
  return vat === 0 ? `${base} άνευ Φ.Π.Α.` : `${base} με Φ.Π.Α. ${vat}%`;
}

/** Λογαριασμοί που χρειάζονται τα ανοιχτά παραστατικά και δεν μπορούν να δεχτούν εγγραφή. */
export async function loadMissingAccounts(): Promise<{ chartSynced: boolean; rows: MissingAccount[] }> {
  const items = await prisma.ocrInvoiceItem.findMany({
    where: { softoneLinMtrl: { not: null }, document: OPEN_DOCS },
    select: { softoneLinMtrl: true, vatRate: true, document: { select: { id: true, fileName: true } } },
  });
  const linIds = [...new Set(items.map((i) => i.softoneLinMtrl!))];
  const lins = linIds.length
    ? await prisma.softoneLineItem.findMany({
      where: { mtrl: { in: linIds } },
      select: { mtrl: true, code: true, name: true, acnmsk: true, acnmskSyncedAt: true },
    })
    : [];
  const linById = new Map(lins.map((l) => [l.mtrl, l]));
  const inputs = items.map((i, rowIndex) => {
    const l = linById.get(i.softoneLinMtrl!);
    return {
      rowIndex, path: 'LINLINES' as const,
      article: l ? `${l.code} — ${l.name}` : null,
      acnmsk: l?.acnmsk ?? null, acnmskKnown: Boolean(l?.acnmskSyncedAt),
      vatRate: i.vatRate == null ? null : Number(i.vatRate),
    };
  });
  const chart = await loadAccountChart(inputs.map((i) => i.acnmsk));
  const check = checkAccounts(inputs, chart);

  const groups = new Map<string, MissingAccount & { docIds: Set<string> }>();
  for (const l of check.lines) {
    if (!BLOCKING.includes(l.status)) continue;
    const doc = items[l.rowIndex].document;
    const key = `${l.status}|${l.account ?? l.article ?? '?'}`;
    const g = groups.get(key) ?? {
      account: l.account, status: l.status, article: l.article, lines: 0, docs: [], docIds: new Set<string>(),
      parent: l.parent ? { code: l.parent.code, name: l.parent.name } : null,
      proposedName: l.status === 'not_in_chart' && l.account ? proposeAccountName(l.account, l.parent?.name ?? null) : null,
      vatRate: l.account ? vatOfSuffix(l.account) : null,
      message: l.message,
    };
    g.lines++;
    if (!g.docIds.has(doc.id)) { g.docIds.add(doc.id); g.docs.push(doc); }
    groups.set(key, g);
  }
  const rows = [...groups.values()].map(({ docIds: _d, ...r }) => r).sort((a, b) => b.lines - a.lines);
  return { chartSynced: check.chartSynced, rows };
}

/** Πώς λέγεται κάθε είδος χρέωσης μέσα στο λογιστικό σχέδιο — για τις προτάσεις λογαριασμού. */
const CHART_HINT: Partial<Record<`${UtilityKind}:${UtilityCharge}` | UtilityCharge, RegExp>> = {
  'electricity:consumption': /ΗΛΕΚΤΡΙΚΟ ΡΕΥΜΑ|ΡΕΥΜΑ/,
  'water:consumption': /ΥΔΡΕΥΣ|ΝΕΡΟ/,
  'gas:consumption': /ΦΩΤΑΕΡΙΟ|ΑΕΡΙΟ|ΚΑΥΣΙΜ/,
  'telecom:consumption': /ΤΗΛΕΦΩΝ|ΤΗΛΕΠΙΚΟΙΝΩΝ|ΚΙΝΗΤΗ/,
  'vehicle_lease:rental': /ΕΝΟΙΚΙΑ (ΜΕΤΑΦΟΡΙΚ|ΕΙΧ|ΦΙΧ|ΑΥΤΟΚΙΝ)|ΕΝΟΙΚΙΑ.*ΑΥΤΟΚΙΝ|ΜΙΣΘΩΜΑΤΑ.*(ΜΕΤΑΦΟΡ|ΑΥΤΟΚΙΝ|ΟΧΗΜ)|LEASING/,
  municipal: /ΔΗΜΟΤ|ΚΑΘΑΡΙΟΤ|ΦΩΤΙΣΜ/,
  ert: /ΕΡΤ|ΡΑΔΙΟΦΩΝ|ΤΗΛΕΟΡΑΣ/,
  // ΟΧΙ σκέτο «ΤΕΛΗ»: θα έπιανε τα «Τέλη καθαριότητας και φωτισμού», που είναι δημοτικά.
  tax: /ΕΙΔΙΚΟΣ ΦΟΡΟΣ|ΕΙΔΙΚΑ ΤΕΛΗ|ΛΟΙΠΟΙ ΦΟΡΟΙ|ΦΟΡΟΙ ΤΕΛΗ|ΠΕΡΙΒΑΛΛ|ΚΑΤΑΝΑΛΩΣ/,
  deposit: /ΕΓΓΥΗΣ/,
  interest: /ΠΡΟΣΑΥΞΗΣ|ΤΟΚΟΙ ΥΠΕΡΗΜΕΡ|ΤΟΚΟΙ/,
  works: /ΕΠΙΣΚΕΥ|ΣΥΝΤΗΡΗΣ/,
};
/** Η λέξη-κλειδί με την οποία ένα είδος χρέωσης εμφανίζεται στα μητρώα του SoftOne — για τις προτάσεις. */
export function utilityRegistryHint(kind: UtilityKind, charge: UtilityCharge): RegExp | null {
  const c: UtilityCharge = charge === 'discount' ? 'consumption' : charge;
  return CHART_HINT[`${kind}:${c}`] ?? CHART_HINT[c] ?? null;
}

const MAX_SUGGESTIONS = 6;
const OUTSIDE: readonly UtilityCharge[] = ['municipal', 'ert', 'tax', 'deposit'];

/** Χρεώσεις ανοιχτών λογαριασμών κοινής ωφέλειας που δεν έχουν ακόμη χρεοπίστωση. */
export async function loadUtilityGaps(): Promise<UtilityGap[]> {
  const docs = await prisma.ocrDocument.findMany({
    where: OPEN_DOCS,
    select: {
      id: true, fileName: true, issuerAfm: true, document: true,
      items: {
        orderBy: { rowIndex: 'asc' },
        select: { name: true, vatRate: true, total: true, softoneMtrl: true, softoneExpn: true, softoneLinMtrl: true, softoneAsset: true, softoneMatchedBy: true },
      },
    },
  });
  const gaps = new Map<string, UtilityGap & { docIds: Set<string>; rates: Map<number, number> }>();
  for (const d of docs) {
    const u = detectUtilityForItems(d.document, d.issuerAfm, d.items);
    if (!u) continue;
    for (const it of d.items) {
      if (it.softoneMtrl != null || it.softoneExpn != null || it.softoneLinMtrl != null || it.softoneAsset != null || it.softoneMatchedBy === 'skipped') continue;
      const charge = classifyUtilityCharge(u.kind, {
        name: it.name, vatRate: it.vatRate == null ? null : Number(it.vatRate), amount: it.total == null ? null : Number(it.total),
      });
      if (!charge) continue;
      // Η έκπτωση ακολουθεί την κατανάλωση — δεν χρειάζεται δική της χρεοπίστωση.
      const c: UtilityCharge = charge === 'discount' ? 'consumption' : charge;
      const key = `${u.kind}:${c}`;
      const g = gaps.get(key) ?? {
        kind: u.kind, charge: c, label: `${UTILITY_KIND_LABEL[u.kind]} · ${UTILITY_CHARGE_LABEL[c]}`,
        lines: 0, docs: [], suggestions: [], vatRate: null, toOpen: null, inactive: [], docIds: new Set<string>(), rates: new Map<number, number>(),
      };
      g.lines++;
      if (it.vatRate != null) { const r = Number(it.vatRate); g.rates.set(r, (g.rates.get(r) ?? 0) + 1); }
      if (!g.docIds.has(d.id)) { g.docIds.add(d.id); g.docs.push({ id: d.id, fileName: d.fileName }); }
      gaps.set(key, g);
    }
  }
  if (gaps.size === 0) return [];

  // Μόνο κινούμενοι, ενεργοί λογαριασμοί εξόδων (ομάδες 6 και 1 για εγγυήσεις) — δεν φέρνουμε όλο το σχέδιο.
  const accounts = await prisma.softoneAccount.findMany({
    where: { isActive: true, postable: true, OR: [{ code: { startsWith: '6' } }, { code: { startsWith: '18' } }] },
    select: { code: true, name: true }, orderBy: { code: 'asc' },
  });
  const normalized = accounts.map((a) => ({ ...a, n: normalizeGreek(a.name) }));
  const existing = new Set(accounts.map((a) => a.code));
  // Ποτέ δεν ρίχνει τη σελίδα: χωρίς SoftOne απλώς δεν υπάρχουν προτάσεις ενεργοποίησης.
  const inactiveAll = (await cachedInactiveLineItems().catch(() => [] as InactiveLineItem[]))
    .map((it) => ({ it, n: normalizeGreek(it.name) }));
  return [...gaps.values()].map(({ docIds: _d, rates, ...g }) => {
    // Ο ΦΠΑ της πλειοψηφίας· τα τέλη τρίτων είναι εκτός ΦΠΑ ό,τι κι αν διάβασε η ανάγνωση.
    const top = [...rates.entries()].sort((a, b) => b[1] - a[1])[0];
    const vatRate = OUTSIDE.includes(g.charge) ? 0 : top ? top[0] : null;
    const hint = CHART_HINT[`${g.kind}:${g.charge}`] ?? CHART_HINT[g.charge];
    const all = hint ? normalized.filter((a) => hint.test(a.n)) : [];
    // Πρώτα ο λογαριασμός του σωστού ΦΠΑ, μετά τα υπόλοιπα.
    const rank = (code: string) => (vatRate != null && vatOfSuffix(code) === vatRate ? 0 : 1);
    const suggestions = [...all].sort((a, b) => rank(a.code) - rank(b.code) || a.code.localeCompare(b.code))
      .slice(0, MAX_SUGGESTIONS).map(({ code, name }) => ({ code, name }));
    let toOpen: UtilityGap['toOpen'] = null;
    const withVat = all.find((a) => vatOfSuffix(a.code) != null);
    if (vatRate != null && withVat && !all.some((a) => vatOfSuffix(a.code) === vatRate)) {
      const parent = withVat.code.replace(/\.\d+$/, '');
      const code = `${parent}.00${String(vatRate).padStart(2, '0')}`;
      if (!existing.has(code)) toOpen = { code, name: proposeAccountName(code, withVat.name), vatRate };
    }
    const inactive = hint
      ? inactiveAll.filter(({ n }) => hint.test(n)).map(({ it }) => it)
        .sort((a, b) => rank(a.acnmsk ?? a.code) - rank(b.acnmsk ?? b.code) || a.code.localeCompare(b.code))
        .slice(0, 3)
      : [];
    return { ...g, suggestions, vatRate, toOpen, inactive };
  }).sort((a, b) => b.lines - a.lines);
}

/** Ολόκληρο το σχέδιο, με το πόσες χρεοπιστώσεις δείχνουν σε κάθε λογαριασμό. */
export async function loadChartRows(): Promise<{ rows: ChartRow[]; syncedAt: Date | null }> {
  const [accounts, lins] = await Promise.all([
    prisma.softoneAccount.findMany({
      select: { code: true, name: true, grade: true, postable: true, isActive: true, syncedAt: true },
      orderBy: { code: 'asc' },
    }),
    prisma.softoneLineItem.findMany({ where: { isActive: true, acnmsk: { not: null } }, select: { acnmsk: true } }),
  ]);
  const byCode = new Map<string, number>();
  for (const l of lins) byCode.set(l.acnmsk!.trim(), (byCode.get(l.acnmsk!.trim()) ?? 0) + 1);
  const syncedAt = accounts.reduce<Date | null>((m, a) => (!m || a.syncedAt > m ? a.syncedAt : m), null);
  return {
    syncedAt,
    rows: accounts.map((a) => ({
      code: a.code, name: a.name, grade: a.grade, postable: a.postable, active: a.isActive, lineItems: byCode.get(a.code) ?? 0,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. ΑΠΟ ΤΑ ΣΚΑΝΑΡΙΣΜΑΤΑ: λογαριασμοί και μητρώα που χρειάζονται οι αταίριαστες γραμμές
// ─────────────────────────────────────────────────────────────────────────────

export type ScanNeedStatus =
  /** Υπάρχει ενεργό μητρώο για τον σωστό λογαριασμό — αρκεί μία αντιστοίχιση, η μνήμη κάνει τις υπόλοιπες. */
  | 'registry'
  /** Υπάρχει ΑΝΕΝΕΡΓΗ χρεοπίστωση — ενεργοποίηση αντί για δημιουργία. */
  | 'activate'
  /** Ο λογαριασμός υπάρχει, λείπει μόνο το μητρώο (χρεοπίστωση / έξοδο) — δημιουργείται από τη γραμμή. */
  | 'create_registry'
  /** Λείπει ο λογαριασμός για αυτόν τον ΦΠΑ — άνοιγμα στο SoftOne. */
  | 'open_account'
  /** Κανένας λογαριασμός του σχεδίου δεν ταιριάζει — απόφαση του λογιστή. */
  | 'no_account';

export interface ScanNeed {
  family: ExpenseFamily;
  label: string;
  vatRate: number | null;
  /** Σε ποιο μητρώο πάνε οι γραμμές: χρεοπίστωση (lin) ή έξοδο/είδος (pur). `null` = χωρίς σειρά. */
  world: MemoryWorld | null;
  lines: number;
  docs: DocRef[];
  /** Μερικές περιγραφές γραμμών, για να φαίνεται τι είναι. */
  samples: string[];
  status: ScanNeedStatus;
  suggestions: ChartAccount[];
  toOpen: { code: string; name: string; vatRate: number; parent: string } | null;
  registry: { kind: 'lineitem' | 'expense'; id: number; code: string; name: string; account: string | null } | null;
  inactive: InactiveLineItem[];
}

export interface ScanNeeds {
  needs: ScanNeed[];
  /** Γραμμές που δεν αναγνωρίζονται σε καμία οικογένεια — θέλουν χειροκίνητη αντιστοίχιση. */
  unclassified: { lines: number; docs: DocRef[]; samples: string[] };
}

const NOT_IGNORED = { OR: [{ reconOverride: null }, { reconOverride: { not: 'IGNORED' as const } }] };

export async function loadScanNeeds(): Promise<ScanNeeds> {
  const docs = await prisma.ocrDocument.findMany({
    where: { ...OPEN_DOCS, AND: [NOT_IGNORED] },
    select: {
      id: true, fileName: true, issuerAfm: true, document: true, softoneSeries: true, seriesSource: true,
      items: {
        orderBy: { rowIndex: 'asc' },
        select: { name: true, vatRate: true, total: true, softoneMtrl: true, softoneExpn: true, softoneLinMtrl: true, softoneAsset: true, softoneMatchedBy: true },
      },
    },
  });
  const targets = await postingTargetsForSeries(docs).catch(() => new Map());

  type Acc = ScanNeed & { docIds: Set<string> };
  const groups = new Map<string, Acc>();
  const unclassified = { lines: 0, docs: [] as DocRef[], samples: [] as string[], docIds: new Set<string>() };
  for (const d of docs) {
    // Οι λογαριασμοί κοινής ωφέλειας έχουν δικό τους τμήμα («χωρίς χρεοπίστωση»).
    if (detectUtilityForItems(d.document, d.issuerAfm, d.items)) continue;
    const key = seriesKey(d);
    const world = key ? worldOfLines(targets.get(key)?.lines) : null;
    for (const it of d.items) {
      if (it.softoneMtrl != null || it.softoneExpn != null || it.softoneLinMtrl != null || it.softoneAsset != null || it.softoneMatchedBy === 'skipped') continue;
      const family = classifyExpenseFamily(it.name);
      if (!family) {
        unclassified.lines++;
        if (!unclassified.docIds.has(d.id)) { unclassified.docIds.add(d.id); unclassified.docs.push({ id: d.id, fileName: d.fileName }); }
        if (unclassified.samples.length < 6 && it.name) unclassified.samples.push(it.name);
        continue;
      }
      const vatRate = it.vatRate == null ? null : Number(it.vatRate);
      const gk = `${family}|${vatRate ?? '?'}|${world ?? '?'}`;
      const g = groups.get(gk) ?? {
        family, label: EXPENSE_FAMILY_LABEL[family], vatRate, world, lines: 0, docs: [], samples: [], docIds: new Set<string>(),
        status: 'no_account' as ScanNeedStatus, suggestions: [], toOpen: null, registry: null, inactive: [],
      };
      g.lines++;
      if (!g.docIds.has(d.id)) { g.docIds.add(d.id); g.docs.push({ id: d.id, fileName: d.fileName }); }
      if (g.samples.length < 3 && it.name && !g.samples.includes(it.name)) g.samples.push(it.name);
      groups.set(gk, g);
    }
  }
  const { docIds: _u, ...unclassifiedOut } = unclassified;
  if (groups.size === 0) return { needs: [], unclassified: unclassifiedOut };

  const [all, lineItems, expenses] = await Promise.all([
    prisma.softoneAccount.findMany({ select: { code: true, name: true, postable: true, isActive: true } }),
    prisma.softoneLineItem.findMany({ where: { isActive: true, acnmsk: { not: null } }, select: { mtrl: true, code: true, name: true, acnmsk: true } }),
    prisma.softoneExpense.findMany({ where: { isActive: true }, select: { expn: true, code: true, name: true } }),
  ]);
  const nameByCode = new Map(all.map((a) => [a.code, a.name]));
  const accounts = all
    .filter((a) => a.isActive && a.postable && EXPENSE_ACCOUNT_PREFIXES.some((p) => a.code.startsWith(p)))
    .map((a) => ({ code: a.code, name: a.name, path: accountPath(a.code, nameByCode) }));
  const inactiveAll = await cachedInactiveLineItems().catch(() => [] as InactiveLineItem[]);

  const needs = [...groups.values()].map(({ docIds: _d, ...g }): ScanNeed => {
    const { suggestions, toOpen } = proposeFamilyAccounts(accounts, g.family, g.vatRate);
    // Οι λογαριασμοί που μετράνε: όσοι ταιριάζουν ΚΑΙ έχουν τον ΦΠΑ των γραμμών (αν τον ξέρουμε).
    const fit = suggestions.filter((a) => g.vatRate == null || vatOfAccount(a.code) === g.vatRate || vatOfAccount(a.code) == null);
    const fitCodes = new Set(fit.map((a) => a.code));

    let registry: ScanNeed['registry'] = null;
    if (g.world !== 'pur') {
      const l = lineItems.find((x) => fitCodes.has(x.acnmsk!.trim()));
      if (l) registry = { kind: 'lineitem', id: l.mtrl, code: l.code, name: l.name, account: l.acnmsk };
    }
    if (!registry && g.world !== 'lin') {
      const e = expenses.find((x) => FAMILY_REGISTRY_HINT[g.family].test(foldName(x.name)));
      if (e) registry = { kind: 'expense', id: e.expn, code: e.code, name: e.name, account: null };
    }
    const inactive = registry || g.world === 'pur' ? [] : inactiveAll
      .filter((x) => (x.acnmsk && fitCodes.has(x.acnmsk.trim())) || FAMILY_REGISTRY_HINT[g.family].test(foldName(x.name)))
      .filter((x) => g.vatRate == null || x.acnmsk == null || vatOfAccount(x.acnmsk) == null || vatOfAccount(x.acnmsk) === g.vatRate)
      .slice(0, 3);

    const status: ScanNeedStatus = registry ? 'registry'
      : inactive.length ? 'activate'
        : fit.length ? 'create_registry'
          : toOpen ? 'open_account'
            : 'no_account';
    return { ...g, status, suggestions, toOpen, registry, inactive };
  });
  const order: Record<ScanNeedStatus, number> = { open_account: 0, activate: 1, create_registry: 2, no_account: 3, registry: 4 };
  needs.sort((a, b) => order[a.status] - order[b.status] || b.lines - a.lines);
  return { needs, unclassified: unclassifiedOut };
}
