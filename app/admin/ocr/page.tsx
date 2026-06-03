import { FiFileText } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission, hasPermission } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';
import { OcrUploadForm } from './upload-form';
import { OcrTable, type OcrRow } from './ocr-table';

export const dynamic = 'force-dynamic';

export default async function AdminOcrPage() {
  await requirePermission('ocr.read');

  const [docs, canCategorize, canPost, canDelete, canCreateCompany, seriesRows] = await Promise.all([
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
        softoneSeries: true,
      },
    }),
    hasPermission('ocr.categorize'),
    hasPermission('ocr.post'),
    hasPermission('ocr.delete'),
    hasPermission('companies.create'),
    prisma.purchaseDocType.findMany({
      where: { isActive: true },
      orderBy: [{ order: 'asc' }, { code: 'asc' }],
      select: { code: true, abbrev: true, name: true, section: true },
    }),
  ]);

  const rows: OcrRow[] = docs.map((d) => {
    const data = (d.extractedData ?? {}) as any;
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
    };
  });

  const stats = computeStats(rows);

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title="OCR & εξαγωγή δεδομένων"
        description="Έξυπνη αναγνώριση τιμολογίων, αποδείξεων και ελεύθερου κειμένου με ένα drop."
        icon={<FiFileText />}
        actions={
          <a href="/admin/ocr/field-rules" className="inline-flex h-8 items-center rounded-md border border-input bg-background px-3 text-[12px] font-semibold hover:bg-muted">
            Ειδικά πεδία
          </a>
        }
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
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-title-2 font-bold tabular-nums tracking-tight text-foreground">{value}</p>
    </div>
  );
}
