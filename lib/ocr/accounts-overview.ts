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
        select: { name: true, vatRate: true, total: true, softoneMtrl: true, softoneExpn: true, softoneLinMtrl: true, softoneMatchedBy: true },
      },
    },
  });
  const gaps = new Map<string, UtilityGap & { docIds: Set<string>; rates: Map<number, number> }>();
  for (const d of docs) {
    const u = detectUtilityForItems(d.document, d.issuerAfm, d.items);
    if (!u) continue;
    for (const it of d.items) {
      if (it.softoneMtrl != null || it.softoneExpn != null || it.softoneLinMtrl != null || it.softoneMatchedBy === 'skipped') continue;
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
