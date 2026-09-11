import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FiArrowLeft, FiDownload } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission, hasPermission } from '@/lib/rbac';
import { Badge } from '@/components/ui/badge';
import { OcrResultView } from './result-view';
import { DeleteButton } from './delete-button';
import { SoftoneChecksStrip } from '@/components/admin/softone-checks-strip';
import { RunResult } from '@/components/templates/run-result';
import type { RunDto } from '@/components/templates/api';
import type { TemplateSummary } from '@/components/templates/template-picker';
import { RUN_INCLUDE, toRunDto } from '@/lib/templates/run-dto';
import { findHelpAnchor } from '@/lib/wiki/loader';
import { canAccessWikiPage } from '@/lib/wiki/access';
import type { WikiRoleKey } from '@/lib/wiki/types';

export const dynamic = 'force-dynamic';

/** Same resolution `<PageHeader helpAnchor>` does (findHelpAnchor → /wiki/<module>/<slug>), minus the
 *  server component: the run card is a client component, so it takes the finished href as a prop. */
function helpHrefFor(anchor: string, role: WikiRoleKey | null): string | null {
  const page = findHelpAnchor(anchor);
  if (!page || !canAccessWikiPage(role, page.frontmatter.roles)) return null;
  return `/wiki/${page.frontmatter.module}/${page.frontmatter.slug}`;
}

export default async function OcrDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('ocr.read');
  const { id } = await params;
  const doc = await prisma.ocrDocument.findUnique({
    where: { id },
    include: { items: { orderBy: { rowIndex: 'asc' } } },
  });
  if (!doc) notFound();

  const [canDelete, canManage, canPost] = await Promise.all([
    hasPermission('ocr.delete'),
    hasPermission('ocr.categorize'),
    hasPermission('ocr.post'),
  ]);

  // Only a COMPLETED document shows the run card, so only a COMPLETED document pays for its data —
  // a failed or still-processing upload would fetch runs and every template for nothing.
  const completed = doc.status === 'COMPLETED';
  const [runRows, templateRows] = completed
    ? await Promise.all([
      prisma.templateRun.findMany({ where: { documentId: id }, orderBy: { createdAt: 'desc' }, take: 20, include: RUN_INCLUDE }),
      prisma.extractionTemplate.findMany({
        orderBy: { name: 'asc' },
        // The picker is a dropdown a human reads: bound it rather than shipping every template ever made.
        take: 200,
        select: { id: true, name: true, slug: true, status: true, mode: true, vatNumber: true, department: true },
      }),
    ])
    : [[], []];
  const runs: RunDto[] = runRows.map(toRunDto);
  const templates: TemplateSummary[] = templateRows;
  // «Τύπος: ΤΠΥ — Τιμολόγιο Παροχής Υπηρεσιών · 92 % · <αιτιολογία>» (spec 2026-09-11 §1.5).
  const series = doc.softoneSeries
    ? doc.seriesSource === 1653
      ? await prisma.softoneDocSeries.findFirst({ where: { code: doc.softoneSeries, sosource: 1653 }, select: { abbrev: true, name: true } })
      : await prisma.purchaseDocType.findUnique({ where: { code: doc.softoneSeries }, select: { abbrev: true, name: true } })
    : null;
  const manualSeries = doc.seriesBy === 'manual';
  const seriesTone = manualSeries || (doc.seriesConfidence ?? 0) >= 0.8 ? '#047857' : doc.seriesConfidence != null ? '#B45309' : '#94A3B8';

  const issuerVat = ((doc.extractedData ?? {}) as { vatNumber?: unknown }).vatNumber;
  const helpHref = completed ? helpHrefFor('template-runs', (user.role.key as WikiRoleKey | undefined) ?? null) : null;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <Link href="/admin/ocr" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <FiArrowLeft className="size-4" /> Πίσω στη λίστα
        </Link>
        <div className="flex items-center gap-2">
          <a
            href={`/api/admin/ocr/${doc.id}/file`}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-muted"
          >
            <FiDownload className="size-3.5" /> Πρωτότυπο
          </a>
          {canDelete && <DeleteButton id={doc.id} />}
        </div>
      </div>

      <header className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">{doc.fileName}</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {doc.docType} · {doc.language.toUpperCase()} · {doc.mimeType} · {(doc.size / 1024).toFixed(1)} KB
              {doc.pdfSource && ` · ${doc.pdfSource}`}
              {doc.durationMs && ` · ${doc.durationMs} ms`}
              {doc.model && ` · ${doc.model}`}
            </p>
            {doc.softoneSeries && (
              <p
                className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
                aria-label={`Τύπος παραστατικού ${series?.abbrev ?? doc.softoneSeries}, ${manualSeries ? 'χειροκίνητη επιλογή' : (doc.seriesConfidence ?? 0) >= 0.8 ? 'σίγουρο' : 'να ελεγχθεί'}`}
              >
                <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: seriesTone }} />
                <span className="font-semibold text-foreground">
                  Τύπος: {series?.abbrev ?? doc.softoneSeries}{series?.name ? ` — ${series.name}` : ''}
                </span>
                <span>· {doc.seriesSource === 1653 ? 'Πιστωτών' : 'Αγορών'}</span>
                {manualSeries
                  ? <span>· χειροκίνητη επιλογή</span>
                  : (
                    <>
                      {doc.seriesConfidence != null && <span>· {Math.round(doc.seriesConfidence * 100)} %</span>}
                      {doc.seriesReason && <span>· {doc.seriesReason}</span>}
                    </>
                  )}
              </p>
            )}
          </div>
          <Badge variant={doc.status === 'COMPLETED' ? 'default' : doc.status === 'FAILED' ? 'destructive' : 'secondary'}>
            {doc.status}
          </Badge>
        </div>
        {doc.errorMessage && (
          <pre className="mt-3 whitespace-pre-wrap rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
            {doc.errorMessage}
          </pre>
        )}
      </header>

      {completed && <SoftoneChecksStrip docId={doc.id} />}

      {completed && (
        <RunResult
          docId={doc.id}
          fileName={doc.fileName}
          issuerVat={typeof issuerVat === 'string' ? issuerVat : null}
          initialRuns={runs}
          templates={templates}
          canManage={canManage}
          canPost={canPost}
          postStatus={doc.postStatus}
          helpHref={helpHref}
        />
      )}

      <OcrResultView doc={doc} />
    </div>
  );
}
