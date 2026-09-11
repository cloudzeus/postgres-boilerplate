import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getSetting } from '@/lib/settings';
import { getUsdToEurLatest, getUsdToEurSeries, usdToEurOnDay } from '@/lib/ai/fx';
import { countQueues } from '@/lib/ocr/queues';
import {
  windowFor, bucketByDay, delta, isoDay, dayLabel, isWeekend, successRate, topN,
  type Range, type Delta, type Window,
} from '@/lib/dashboard/series';

/**
 * Το σύνολο δεδομένων του dashboard (`/admin`) σε μία κλήση.
 *
 * Κανόνες: κάθε query είναι φραγμένο — `count`/`aggregate`/`groupBy` όπου γίνεται,
 * `date_trunc('day', …)` για τα ημερήσια γραφήματα και ρητό `take`/`LIMIT` όπου
 * κατεβαίνουν γραμμές. Δεν υπάρχει αφιλτράριστο `findMany` πάνω στα έγγραφα.
 */

// ── Τύποι εξόδου ─────────────────────────────────────────────────────────────

export interface KpiDatum {
  value: number;
  previous: number;
  delta: Delta;
}

export interface DailyDocPoint {
  day: string;
  label: string;
  created: number;
  posted: number;
  weekend: boolean;
}

export interface BreakdownItem {
  key: string;
  label: string;
  value: number;
  color: string;
}

export interface RecentDoc {
  id: string;
  name: string;
  issuer: string | null;
  total: number | null;
  thumbUrl: string | null;
  status: string;
  postStatus: string;
  createdAt: string;
}

export interface SupplierRow {
  name: string;
  docs: number;
  total: number;
}

export interface AttentionRow {
  key: string;
  label: string;
  count: number;
  href: string;
}

export interface TemplateHealth {
  active: number;
  runs: number;
  /** Ποσοστό επιτυχίας ή `null` όταν δεν έτρεξε τίποτα στην περίοδο. */
  successRate: number | null;
  avgDurationMs: number | null;
}

export interface DashboardData {
  range: Range;
  window: Window;
  /** Πλήθος εγγράφων συνολικά (όχι περιόδου) — κρίνει το onboarding empty state. */
  totalDocsEver: number;
  kpis: {
    created: KpiDatum;
    completed: KpiDatum;
    review: KpiDatum;
    posted: KpiDatum;
    failed: KpiDatum;
    costEur: KpiDatum;
  };
  docsDaily: DailyDocPoint[];
  aiDaily: Array<{ label: string; costEur: number; docs: number; rate: number }>;
  statusBreakdown: BreakdownItem[];
  postBreakdown: BreakdownItem[];
  docTypes: Array<{ label: string; value: number }>;
  attention: AttentionRow[];
  recent: RecentDoc[];
  suppliers: SupplierRow[];
  templates: TemplateHealth;
}

// ── Παλέτα γραφημάτων (inline hex — τα γραφήματα δεν πατάνε σε δυναμικές κλάσεις) ──

export const CHART = {
  primary: '#0078D4', // Sisyphus Blue — κύρια σειρά
  posted:  '#2E9E6B', // muted green  — καταχωρημένα
  pending: '#C77F0A', // warm amber   — εκκρεμή
  failed:  '#C4314B', // DG red-ish   — αποτυχίες/ειδοποιήσεις
  none:    '#94A3B8', // warm grey    — «καμία ενέργεια»
} as const;

// ── Κύρια φόρτωση ────────────────────────────────────────────────────────────

export async function loadDashboard(range: Range, now = new Date()): Promise<DashboardData> {
  const w = windowFor(now, range);
  const { start, end, prevStart, prevEnd } = w;

  const reviewWhere = (gte: Date, lt: Date): Prisma.OcrDocumentWhereInput => ({
    createdAt: { gte, lt },
    OR: [
      { reviewFlags: { path: ['runStatus'], equals: 'REVIEW' } },
      { reviewFlags: { path: ['runStatus'], equals: 'BLOCKED' } },
      { reviewFlags: { path: ['unknownForm'], equals: true } },
    ],
  });

  const failedWhere = (gte: Date, lt: Date): Prisma.OcrDocumentWhereInput => ({
    createdAt: { gte, lt },
    OR: [{ status: 'FAILED' }, { postStatus: 'FAILED' }],
  });

  const [
    totalDocsEver,
    created, createdPrev,
    completed, completedPrev,
    review, reviewPrev,
    posted, postedPrev,
    failed, failedPrev,
    costRow, costPrevRow,
    statusRows, postRows,
    seriesRows, jsonTypeRows,
    queues, unknownForm, runsFlagged,
    recentRows, supplierRows,
    activeTemplates, runRows, runAvg,
    createdByDay, postedByDay, aiByDay,
    fallbackRate,
  ] = await Promise.all([
    prisma.ocrDocument.count(),

    prisma.ocrDocument.count({ where: { createdAt: { gte: start, lt: end } } }),
    prisma.ocrDocument.count({ where: { createdAt: { gte: prevStart, lt: prevEnd } } }),

    prisma.ocrDocument.count({ where: { status: 'COMPLETED', completedAt: { gte: start, lt: end } } }),
    prisma.ocrDocument.count({ where: { status: 'COMPLETED', completedAt: { gte: prevStart, lt: prevEnd } } }),

    prisma.ocrDocument.count({ where: reviewWhere(start, end) }),
    prisma.ocrDocument.count({ where: reviewWhere(prevStart, prevEnd) }),

    prisma.ocrDocument.count({ where: { postStatus: 'POSTED', postedAt: { gte: start, lt: end } } }),
    prisma.ocrDocument.count({ where: { postStatus: 'POSTED', postedAt: { gte: prevStart, lt: prevEnd } } }),

    prisma.ocrDocument.count({ where: failedWhere(start, end) }),
    prisma.ocrDocument.count({ where: failedWhere(prevStart, prevEnd) }),

    prisma.aiUsage.aggregate({ where: { createdAt: { gte: start, lt: end } }, _sum: { totalCost: true } }),
    prisma.aiUsage.aggregate({ where: { createdAt: { gte: prevStart, lt: prevEnd } }, _sum: { totalCost: true } }),

    prisma.ocrDocument.groupBy({
      by: ['status'], where: { createdAt: { gte: start, lt: end } }, _count: { _all: true },
    }),
    prisma.ocrDocument.groupBy({
      by: ['postStatus'], where: { createdAt: { gte: start, lt: end } }, _count: { _all: true },
    }),

    // Τύποι παραστατικών — πρώτα οι πραγματικές σειρές SoftOne (φραγμένη πληθικότητα).
    prisma.ocrDocument.groupBy({
      by: ['softoneSeries', 'seriesSource'],
      where: { createdAt: { gte: start, lt: end }, softoneSeries: { not: null } },
      _count: { _all: true },
    }),
    // …και για όσα δεν έχουν σειρά, η ετικέτα από το κανονικό JSON (ρητό LIMIT).
    prisma.$queryRaw<Array<{ label: string; n: bigint }>>`
      SELECT COALESCE(
               NULLIF(btrim("document" -> 'type' ->> 'label'), ''),
               NULLIF(btrim("extractedData" ->> 'documentTypeLabel'), ''),
               'Χωρίς τύπο'
             ) AS label,
             COUNT(*) AS n
      FROM   "OcrDocument"
      WHERE  "createdAt" >= ${start} AND "createdAt" < ${end}
        AND  ("softoneSeries" IS NULL OR "softoneSeries" = '')
      GROUP  BY 1
      ORDER  BY n DESC
      LIMIT  20
    `,

    countQueues(),
    prisma.ocrDocument.count({ where: { reviewFlags: { path: ['unknownForm'], equals: true } } }),
    prisma.templateRun.count({
      where: { createdAt: { gte: start, lt: end }, status: { in: ['REVIEW', 'BLOCKED'] } },
    }),

    prisma.ocrDocument.findMany({
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: {
        id: true, fileName: true, originalName: true, thumbUrl: true,
        status: true, postStatus: true, createdAt: true,
        softoneName: true, document: true, extractedData: true,
      },
    }),

    // Κορυφαίοι εκδότες της περιόδου — άθροιση στη βάση, LIMIT 6.
    prisma.$queryRaw<Array<{ name: string | null; docs: bigint; total: string | null }>>`
      SELECT COALESCE(
               NULLIF(btrim("document" -> 'issuer' ->> 'name'), ''),
               NULLIF(btrim("extractedData" ->> 'companyName'), ''),
               NULLIF(btrim("softoneName"), '')
             ) AS name,
             COUNT(*) AS docs,
             SUM(COALESCE(
               CASE WHEN jsonb_typeof("document" -> 'totals' -> 'total') = 'number'
                    THEN ("document" -> 'totals' ->> 'total')::numeric END,
               CASE WHEN jsonb_typeof("extractedData" -> 'totalAmount') = 'number'
                    THEN ("extractedData" ->> 'totalAmount')::numeric END,
               0
             )) AS total
      FROM   "OcrDocument"
      WHERE  "createdAt" >= ${start} AND "createdAt" < ${end}
      GROUP  BY 1
      HAVING COALESCE(
               NULLIF(btrim("document" -> 'issuer' ->> 'name'), ''),
               NULLIF(btrim("extractedData" ->> 'companyName'), ''),
               NULLIF(btrim("softoneName"), '')
             ) IS NOT NULL
      ORDER  BY total DESC NULLS LAST
      LIMIT  6
    `,

    prisma.extractionTemplate.count({ where: { status: 'ACTIVE' } }),
    prisma.templateRun.groupBy({
      by: ['status'], where: { createdAt: { gte: start, lt: end } }, _count: { _all: true },
    }),
    prisma.templateRun.aggregate({
      where: { createdAt: { gte: start, lt: end }, durationMs: { not: null } },
      _avg: { durationMs: true },
    }),

    prisma.$queryRaw<Array<{ day: Date; n: bigint }>>`
      SELECT date_trunc('day', "createdAt") AS day, COUNT(*) AS n
      FROM   "OcrDocument"
      WHERE  "createdAt" >= ${start} AND "createdAt" < ${end}
      GROUP  BY 1
    `,
    prisma.$queryRaw<Array<{ day: Date; n: bigint }>>`
      SELECT date_trunc('day', "postedAt") AS day, COUNT(*) AS n
      FROM   "OcrDocument"
      WHERE  "postedAt" >= ${start} AND "postedAt" < ${end} AND "postStatus" = 'POSTED'
      GROUP  BY 1
    `,
    prisma.$queryRaw<Array<{ day: Date; cost: string | null }>>`
      SELECT date_trunc('day', "createdAt") AS day, SUM("totalCost") AS cost
      FROM   "AiUsage"
      WHERE  "createdAt" >= ${start} AND "createdAt" < ${end}
      GROUP  BY 1
    `,

    getSetting<number>('ai.usdToEur', 0.92),
  ]);

  // FX: USD (αποθηκευμένο) → EUR (εμφανιζόμενο), όπως στο /admin/ai-usage.
  const rate = Number(fallbackRate) || 0.92;
  const latestRate = await getUsdToEurLatest(rate);
  const fxSeries = await getUsdToEurSeries(isoDay(start), isoDay(now));

  const costEur = usdToEurOnDay(Number(costRow._sum.totalCost ?? 0), isoDay(now), fxSeries, latestRate);
  const costEurPrev = usdToEurOnDay(Number(costPrevRow._sum.totalCost ?? 0), isoDay(prevEnd), fxSeries, latestRate);

  // ── Ημερήσιες σειρές ───────────────────────────────────────────────────────
  const createdSeries = bucketByDay(createdByDay.map((r) => ({ day: r.day, value: Number(r.n) })), w.days);
  const postedSeries  = bucketByDay(postedByDay.map((r) => ({ day: r.day, value: Number(r.n) })), w.days);
  const costByDay     = new Map(aiByDay.map((r) => [isoDay(r.day), Number(r.cost ?? 0)]));

  const docsDaily: DailyDocPoint[] = w.days.map((day, i) => ({
    day,
    label: dayLabel(day),
    created: createdSeries[i],
    posted: postedSeries[i],
    weekend: isWeekend(day),
  }));

  const aiDaily = w.days.map((day, i) => ({
    label: dayLabel(day),
    costEur: usdToEurOnDay(costByDay.get(day) ?? 0, day, fxSeries, latestRate),
    docs: createdSeries[i],
    rate: fxSeries[day] ?? latestRate,
  }));

  // ── Κατανομές ──────────────────────────────────────────────────────────────
  const statusCount = Object.fromEntries(statusRows.map((r) => [r.status, r._count._all]));
  const statusBreakdown: BreakdownItem[] = [
    { key: 'COMPLETED', label: 'Ολοκληρωμένα', value: statusCount.COMPLETED ?? 0, color: CHART.posted },
    {
      key: 'INFLIGHT', label: 'Σε επεξεργασία',
      value: (statusCount.PENDING ?? 0) + (statusCount.PROCESSING ?? 0), color: CHART.pending,
    },
    { key: 'FAILED', label: 'Αποτυχημένα', value: statusCount.FAILED ?? 0, color: CHART.failed },
  ];

  const postCount = Object.fromEntries(postRows.map((r) => [r.postStatus, r._count._all]));
  const postBreakdown: BreakdownItem[] = [
    { key: 'POSTED',  label: 'Καταχωρήθηκαν', value: postCount.POSTED ?? 0,  color: CHART.posted },
    { key: 'PENDING', label: 'Σε αναμονή',    value: postCount.PENDING ?? 0, color: CHART.primary },
    { key: 'NONE',    label: 'Χωρίς ενέργεια', value: postCount.NONE ?? 0,   color: CHART.none },
    { key: 'FAILED',  label: 'Απέτυχαν',      value: postCount.FAILED ?? 0,  color: CHART.failed },
  ];

  // ── Τύποι παραστατικών: ετικέτες σειράς + fallback από το JSON ──────────────
  const docTypes = topN(
    [
      ...(await labelSeries(seriesRows)),
      ...jsonTypeRows.map((r) => ({ label: r.label, value: Number(r.n) })),
    ].reduce((acc, row) => {
      const hit = acc.find((a) => a.label === row.label);
      if (hit) hit.value += row.value; else acc.push({ ...row });
      return acc;
    }, [] as Array<{ label: string; value: number }>),
    8,
  );

  // ── Χρειάζονται προσοχή ────────────────────────────────────────────────────
  const attention: AttentionRow[] = [
    { key: 'traders', label: 'Νέοι συναλλασσόμενοι', count: queues.traders, href: '/admin/ocr/new-traders' },
    { key: 'items',   label: 'Είδη & έξοδα',          count: queues.items,   href: '/admin/ocr/new-items' },
    { key: 'runs',    label: 'Εκτελέσεις προτύπων σε έλεγχο', count: runsFlagged, href: '/admin/ocr/templates' },
    { key: 'unknown', label: 'Άγνωστα έντυπα',        count: unknownForm,    href: '/admin/ocr' },
    { key: 'failed',  label: 'Αποτυχημένες σαρώσεις', count: statusCount.FAILED ?? 0, href: '/admin/ocr' },
  ];

  // ── Πρόσφατα έγγραφα ───────────────────────────────────────────────────────
  const recent: RecentDoc[] = recentRows.map((d) => {
    const doc = (d.document ?? null) as { issuer?: { name?: unknown }; totals?: { total?: unknown } } | null;
    const legacy = (d.extractedData ?? null) as { companyName?: unknown; totalAmount?: unknown } | null;
    return {
      id: d.id,
      name: d.fileName || d.originalName,
      issuer: str(doc?.issuer?.name) ?? str(legacy?.companyName) ?? d.softoneName ?? null,
      total: numOrNull(doc?.totals?.total) ?? numOrNull(legacy?.totalAmount),
      thumbUrl: d.thumbUrl,
      status: d.status,
      postStatus: d.postStatus,
      createdAt: d.createdAt.toISOString(),
    };
  });

  const suppliers: SupplierRow[] = supplierRows
    .filter((r) => r.name)
    .map((r) => ({ name: r.name as string, docs: Number(r.docs), total: Number(r.total ?? 0) }));

  const runCounts = Object.fromEntries(runRows.map((r) => [r.status, r._count._all]));
  const templates: TemplateHealth = {
    active: activeTemplates,
    runs: runRows.reduce((s, r) => s + r._count._all, 0),
    successRate: successRate(runCounts),
    avgDurationMs: runAvg._avg.durationMs != null ? Math.round(runAvg._avg.durationMs) : null,
  };

  return {
    range,
    window: w,
    totalDocsEver,
    kpis: {
      created:   kpi(created, createdPrev),
      completed: kpi(completed, completedPrev),
      review:    kpi(review, reviewPrev),
      posted:    kpi(posted, postedPrev),
      failed:    kpi(failed, failedPrev),
      costEur:   kpi(costEur, costEurPrev),
    },
    docsDaily,
    aiDaily,
    statusBreakdown,
    postBreakdown,
    docTypes,
    attention,
    recent,
    suppliers,
    templates,
  };
}

// ── Βοηθοί ───────────────────────────────────────────────────────────────────

function kpi(value: number, previous: number): KpiDatum {
  return { value, previous, delta: delta(value, previous) };
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Μεταφράζει τα ζεύγη (σειρά, ενότητα) σε ονόματα — ίδια αναζήτηση με τη στήλη
 * «Σειρά» της λίστας OCR: 1251 → `PurchaseDocType`, οτιδήποτε άλλο → `SoftoneDocSeries`.
 */
async function labelSeries(
  rows: Array<{ softoneSeries: string | null; seriesSource: number | null; _count: { _all: number } }>,
): Promise<Array<{ label: string; value: number }>> {
  const purchaseCodes = new Set<string>();
  const otherCodes = new Set<string>();
  for (const r of rows) {
    if (!r.softoneSeries) continue;
    ((r.seriesSource ?? 1251) === 1251 ? purchaseCodes : otherCodes).add(r.softoneSeries);
  }
  if (!purchaseCodes.size && !otherCodes.size) return [];

  const [purchases, others] = await Promise.all([
    purchaseCodes.size
      ? prisma.purchaseDocType.findMany({
        where: { code: { in: [...purchaseCodes] } },
        select: { code: true, abbrev: true, name: true },
      })
      : [],
    otherCodes.size
      ? prisma.softoneDocSeries.findMany({
        where: { code: { in: [...otherCodes] } },
        select: { code: true, abbrev: true, name: true, sosource: true },
      })
      : [],
  ]);

  const byPurchase = new Map(purchases.map((p) => [p.code, p.name || p.abbrev || p.code]));
  const byOther = new Map(others.map((o) => [`${o.sosource}:${o.code}`, o.name || o.abbrev || o.code]));

  const out = new Map<string, number>();
  for (const r of rows) {
    if (!r.softoneSeries) continue;
    const sosource = r.seriesSource ?? 1251;
    const label = (sosource === 1251
      ? byPurchase.get(r.softoneSeries)
      : byOther.get(`${sosource}:${r.softoneSeries}`)) ?? `Σειρά ${r.softoneSeries}`;
    out.set(label, (out.get(label) ?? 0) + r._count._all);
  }
  return [...out].map(([label, value]) => ({ label, value }));
}
