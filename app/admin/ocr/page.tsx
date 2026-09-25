import { FiFileText } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission, hasPermission } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';
import type { ReviewFlags } from '@/lib/templates/run-logic';
import { OcrUploadForm } from './upload-form';
import { OcrTable, type OcrRow, type SeriesOption } from './ocr-table';

export const dynamic = 'force-dynamic';

/** Η ετικέτα της ενότητας αγορών — ζει στο `PurchaseDocType`, που δεν κρατά στήλη `family`. */
const PURCHASE_FAMILY = 'Παραστατικά αγορών';

export default async function AdminOcrPage() {
  await requirePermission('ocr.read');

  const [docs, canCategorize, canPost, canDelete, canCreateCompany, purchaseSeries, otherSeries] = await Promise.all([
    prisma.ocrDocument.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: {
        id: true, fileName: true, mimeType: true, size: true,
        docType: true, language: true, status: true, category: true,
        postStatus: true, postedRef: true,
        createdAt: true, completedAt: true,
        thumbUrl: true,
        extractedData: true,
        errorMessage: true,
        softoneTrdr: true, softoneCode: true, softoneName: true, softoneKind: true, softoneChecked: true,
        softoneDocExists: true,
        reconOverride: true, itemsTotal: true, itemsMatched: true,
        softoneSeries: true, seriesSource: true, seriesConfidence: true, seriesReason: true, seriesBy: true,
        reviewFlags: true,
      },
    }),
    hasPermission('ocr.categorize'),
    hasPermission('ocr.post'),
    hasPermission('ocr.delete'),
    hasPermission('companies.create'),
    // Σειρές αγορών (SOSOURCE 1251): όπως και οι πιστωτών, μόνο οι ενεργοποιημένες — ο επιλογέας
    // και ο αυτόματος ταξινομητής πρέπει να βλέπουν το ΙΔΙΟ σύνολο (spec 2026-09-11 §1.1).
    prisma.purchaseDocType.findMany({
      where: { enabled: true, isActive: true },
      orderBy: [{ order: 'asc' }, { code: 'asc' }],
      select: { code: true, abbrev: true, name: true, section: true },
    }),
    // Σειρές ΚΑΘΕ ΑΛΛΗΣ ενότητας: μόνο όσες έχει ενεργοποιήσει ο χρήστης — ο ταξινομητής διαλέγει
    // από το ίδιο σύνολο (spec 2026-09-11 §1.1, `loadEnabledSeries`). Δεν φιλτράρουμε σε 1653:
    // ποιες ενότητες χρησιμοποιεί η εγκατάσταση το λέει το /admin/doc-series, όχι ο κώδικας.
    prisma.softoneDocSeries.findMany({
      where: { enabled: true, isActive: true },
      orderBy: [{ sosource: 'asc' }, { order: 'asc' }, { code: 'asc' }],
      select: { code: true, abbrev: true, name: true, section: true, sosource: true, family: true },
    }),
  ]);

  const seriesRows: SeriesOption[] = [
    ...purchaseSeries.map((s) => ({ ...s, family: PURCHASE_FAMILY, sosource: 1251, enabled: true })),
    ...otherSeries.map((s) => ({ ...s, enabled: true })),
  ];
  // Ένα παραστατικό μπορεί να κρατάει σειρά που απενεργοποιήθηκε μετά την ταξινόμηση. Χωρίς αυτήν
  // στον επιλογέα η γραμμή θα έδειχνε γυμνό κωδικό και το <select> θα φαινόταν άδειο· τη φέρνουμε
  // πίσω σημαδεμένη «ανενεργή» (απενεργοποιημένη επιλογή — δεν ξαναεπιλέγεται).
  seriesRows.push(...(await loadInactiveSeries(docs, seriesRows)));

  const rows: OcrRow[] = docs.map((d) => {
    const data = (d.extractedData ?? {}) as any;
    // The latest template run, cached on the document by the runner (spec §15.4/§15.7).
    const rf = (d.reviewFlags ?? null) as Partial<ReviewFlags> | null;
    return {
      id: d.id,
      fileName: d.fileName,
      mimeType: d.mimeType,
      size: d.size,
      docType: d.docType,
      language: d.language,
      status: d.status,
      category: d.category,
      postStatus: d.postStatus,
      postedRef: d.postedRef,
      createdAt: d.createdAt.toISOString(),
      thumbUrl: d.thumbUrl,
      issuer: data?.companyName ?? data?.storeName ?? data?.title ?? null,
      docNumber: data?.invoiceNumber ?? null,
      docDate: data?.date ?? null,
      vatNumber: data?.vatNumber ?? null,
      customerVatNumber: data?.customerVatNumber ?? null,
      total: typeof data?.totalAmount === 'number' ? data.totalAmount : null,
      extractedData: data,
      errorMessage: d.errorMessage,
      softoneTrdr: d.softoneTrdr,
      softoneCode: d.softoneCode,
      softoneName: d.softoneName,
      softoneKind: d.softoneKind,
      softoneChecked: d.softoneChecked ? d.softoneChecked.toISOString() : null,
      softoneDocExists: d.softoneDocExists,
      reconOverride: d.reconOverride,
      itemsTotal: d.itemsTotal,
      itemsMatched: d.itemsMatched,
      softoneSeries: d.softoneSeries,
      seriesSource: d.seriesSource,
      seriesConfidence: d.seriesConfidence,
      seriesReason: d.seriesReason,
      seriesBy: d.seriesBy,
      templateName: rf?.templateName ?? null,
      templateRunStatus: rf?.runStatus ?? null,
      reviewCount: Array.isArray(rf?.review) ? rf.review.length : 0,
      blockedCount: Array.isArray(rf?.blocked) ? rf.blocked.length : 0,
      unknownForm: rf?.unknownForm === true,
    };
  });

  const stats = computeStats(rows);

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title="OCR & εξαγωγή δεδομένων"
        description="Έξυπνη αναγνώριση τιμολογίων, αποδείξεων και ελεύθερου κειμένου με ένα drop."
        icon={<FiFileText />}
        helpAnchor="ocr"
      />

      {/* Stats strip */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Σύνολο" value={stats.total} accent="sisyphus" />
        <StatTile label="Επιτυχημένα" value={stats.completed} accent="emerald" />
        <StatTile label="Σε εκκρεμότητα" value={stats.pending} accent="amber" />
        <StatTile label="Αναρτημένα" value={stats.posted} accent="sisyphus" />
      </section>

      <OcrUploadForm />

      <OcrTable
        rows={rows}
        canCategorize={canCategorize}
        canPost={canPost}
        canDelete={canDelete}
        canCreateCompany={canCreateCompany}
        seriesOptions={seriesRows}
      />
    </div>
  );
}

/** Σειρές που χρησιμοποιούν παραστατικά αλλά δεν είναι πια ενεργοποιημένες (§1.1). */
async function loadInactiveSeries(
  docs: { softoneSeries: string | null; seriesSource: number | null }[],
  enabled: SeriesOption[],
): Promise<SeriesOption[]> {
  const have = new Set(enabled.map((o) => `${o.sosource}:${o.code}`));
  const missing = new Map<number, Set<string>>();
  for (const d of docs) {
    if (!d.softoneSeries) continue;
    const sosource = d.seriesSource ?? 1251;
    if (have.has(`${sosource}:${d.softoneSeries}`)) continue;
    if (!missing.has(sosource)) missing.set(sosource, new Set());
    missing.get(sosource)!.add(d.softoneSeries);
  }
  if (!missing.size) return [];

  const purchaseCodes = [...(missing.get(1251) ?? [])];
  const otherCodes = [...missing].filter(([s]) => s !== 1251).flatMap(([, codes]) => [...codes]);
  const [purchases, others] = await Promise.all([
    purchaseCodes.length
      ? prisma.purchaseDocType.findMany({
        where: { code: { in: purchaseCodes } },
        select: { code: true, abbrev: true, name: true, section: true },
      })
      : [],
    otherCodes.length
      ? prisma.softoneDocSeries.findMany({
        where: { code: { in: otherCodes }, sosource: { in: [...missing.keys()].filter((s) => s !== 1251) } },
        select: { code: true, abbrev: true, name: true, section: true, sosource: true, family: true },
      })
      : [],
  ]);
  return [
    ...purchases.map((s) => ({ ...s, family: PURCHASE_FAMILY, sosource: 1251, enabled: false })),
    // Η ενότητα κουβαλά το δικό της όνομα — καμία σειρά δεν εμφανίζεται πια ως «Άλλη ενότητα».
    ...others.filter((s) => missing.get(s.sosource)?.has(s.code)).map((s) => ({ ...s, enabled: false })),
  ];
}

function computeStats(rows: OcrRow[]) {
  return {
    total: rows.length,
    completed: rows.filter((r) => r.status === 'COMPLETED').length,
    pending: rows.filter((r) => r.status === 'PROCESSING' || r.status === 'PENDING' || r.status === 'FAILED').length,
    posted: rows.filter((r) => r.postStatus === 'POSTED').length,
  };
}

function StatTile({ label, value, accent }: { label: string; value: number; accent: 'sisyphus' | 'emerald' | 'amber' }) {
  const accentMap = {
    sisyphus: 'bg-sisyphus-500',
    emerald:  'bg-emerald-500',
    amber:    'bg-amber-500',
  } as const;
  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-card px-4 py-3 shadow-fluent-2">
      <span className={`absolute left-0 top-0 h-full w-1 ${accentMap[accent]}`} />
      <p className="text-[length:var(--fs-10)] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-title-2 font-bold tabular-nums tracking-tight text-foreground">{value}</p>
    </div>
  );
}
