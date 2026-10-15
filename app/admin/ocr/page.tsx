import { withFeesFromDocument } from '@/lib/ocr/canonical';
import { FiCheckCircle, FiClock, FiFileText, FiUploadCloud } from 'react-icons/fi';
import { StatCard, StatGrid } from '@/components/admin/stat-card';
import { detectUtility, utilityInputFromDocument } from '@/lib/ocr/utility-bills';
import { lineCoverage } from '@/lib/ocr/coverage';
import { MatchCoverage } from '@/components/admin/match-coverage';
import { prisma } from '@/lib/db';
import { requirePermission, hasPermission } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';
import type { ReviewFlags } from '@/lib/templates/run-logic';
import { OcrUploadForm } from './upload-form';
import { OcrTable, type OcrRow, type SeriesOption } from './ocr-table';
import { loadSeriesOptions } from '@/lib/ocr/series-options';

export const dynamic = 'force-dynamic';


export default async function AdminOcrPage() {
  await requirePermission('ocr.read');

  const [docs, canCategorize, canPost, canDelete, canCreateCompany] = await Promise.all([
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
        // Μόνο για την αναγνώριση λογαριασμού κοινής ωφέλειας — δεν φεύγει προς τον browser.
        document: true, issuerAfm: true,
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
  ]);

  // Ένας loader για λίστα ΚΑΙ σελίδα παραστατικού (`lib/ocr/series-options.ts`): μαζί με τις
  // απενεργοποιημένες σειρές που κρατούν ακόμη παραστατικά, ώστε κανένα <select> να μη φαίνεται άδειο.
  const seriesRows: SeriesOption[] = await loadSeriesOptions(docs);

  const rows: OcrRow[] = docs.map((d) => {
    const data = withFeesFromDocument((d.extractedData ?? {}) as Record<string, unknown>, d.document) as any;
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
      utility: (() => {
        const input = utilityInputFromDocument(d.document, d.issuerAfm);
        const u = input ? detectUtility(input) : null;
        return u ? { kind: u.kind, provider: u.provider } : null;
      })(),
    };
  });

  const stats = computeStats(rows);
  const coverage = await lineCoverage();

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title="OCR & εξαγωγή δεδομένων"
        description="Έξυπνη αναγνώριση τιμολογίων, αποδείξεων και ελεύθερου κειμένου με ένα drop."
        icon={<FiFileText />}
        helpAnchor="ocr"
      />

      {/* Στατιστικά — ίδια κάρτα παντού (components/admin/stat-card) */}
      <StatGrid>
        <StatCard label="Σύνολο" value={fmtInt(stats.total)} icon={<FiFileText />} tone="blue" sub="έγγραφα στη λίστα" />
        <StatCard label="Επιτυχημένα" value={fmtInt(stats.completed)} icon={<FiCheckCircle />} tone="emerald" sub={`${pctOf(stats.completed, stats.total)}% του συνόλου`} progress={pctOf(stats.completed, stats.total)} />
        <StatCard label="Σε εκκρεμότητα" value={fmtInt(stats.pending)} icon={<FiClock />} tone="amber" sub={stats.pending ? 'προς επεξεργασία' : 'καμία εκκρεμότητα'} />
        <StatCard label="Αναρτημένα" value={fmtInt(stats.posted)} icon={<FiUploadCloud />} tone="violet" sub={`${pctOf(stats.posted, stats.completed)}% των επιτυχημένων`} progress={pctOf(stats.posted, stats.completed)} />
        <MatchCoverage coverage={coverage} canRematch={canCategorize} />
      </StatGrid>

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

const fmtInt = (n: number) => n.toLocaleString('el-GR');
const pctOf = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);
