import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FiArrowLeft, FiDownload } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission, hasPermission } from '@/lib/rbac';
import { Badge } from '@/components/ui/badge';
import { OcrResultView } from './result-view';
import { DeleteButton } from './delete-button';
import { DocumentJsonCard } from './document-json';
import { SoftoneChecksStrip } from '@/components/admin/softone-checks-strip';
import { RunResult } from '@/components/templates/run-result';
import type { RunDto } from '@/components/templates/api';
import type { TemplateSummary } from '@/components/templates/template-picker';
import { RUN_INCLUDE, toRunDto } from '@/lib/templates/run-dto';
import { findHelpAnchor } from '@/lib/wiki/loader';
import { canAccessWikiPage } from '@/lib/wiki/access';
import type { WikiRoleKey } from '@/lib/wiki/types';
import { lineAccountsFor } from '@/lib/ocr/account-chart';
import { postingTargetsForSeries, seriesKey } from '@/lib/ocr/required-trader-kind';

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

  // Οι κατηγορίες δαπανών (LINCATEGORY) τροφοδοτούν ΜΟΝΟ το φίλτρο χρεοπιστώσεων του picker
  // γραμμών — χωρίς `ocr.categorize` δεν υπάρχει picker, οπότε δεν πληρώνουμε το ερώτημα.
  const lineCategories = canManage
    ? await prisma.softoneLineCategory.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { mtrCategory: true, code: true, name: true },
    })
    : [];

  // Οι γραμμές κρατούν ΑΡΙΘΜΟΥΣ αναλυτικής (`softoneCostCntr` κ.λπ.). Οι ετικέτες
  // «κωδικός — περιγραφή» έρχονται με τρία ερωτήματα για ΟΛΟ το παραστατικό, όχι ανά γραμμή.
  const items = doc.items;
  const ids = (pick: (i: (typeof items)[number]) => number | null) =>
    Array.from(new Set(items.map(pick).filter((v): v is number => v != null)));
  const [ccRows, pjRows, psRows, lineAccounts] = await Promise.all([
    ids((i) => i.softoneCostCntr).length
      ? prisma.softoneCostCenter.findMany({
        where: { costcntr: { in: ids((i) => i.softoneCostCntr) } }, select: { costcntr: true, code: true, name: true },
      })
      : Promise.resolve([]),
    ids((i) => i.softonePrjc).length
      ? prisma.softoneProject.findMany({
        where: { prjc: { in: ids((i) => i.softonePrjc) } }, select: { prjc: true, code: true, name: true },
      })
      : Promise.resolve([]),
    ids((i) => i.softonePrjcStage).length
      ? prisma.softoneProjectStage.findMany({
        where: { prjcStage: { in: ids((i) => i.softonePrjcStage) } }, select: { prjcStage: true, code: true, name: true },
      })
      : Promise.resolve([]),
    // Σε ποιον λογαριασμό γενικής θα πήγαινε κάθε αντιστοιχισμένη γραμμή — με το όνομά του.
    lineAccountsFor(items),
  ]);
  const byId = <T,>(rows: T[], key: (r: T) => number): Record<number, string> =>
    Object.fromEntries(rows.map((r) => [key(r), `${(r as { code: string }).code} — ${(r as { name: string }).name}`]));

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
  // Η σειρά ζει σε δύο μητρώα: αγορές (1251) στο `PurchaseDocType`, ΚΑΘΕ άλλη ενότητα στο
  // `SoftoneDocSeries`. Το `family` είναι το όνομα της ίδιας της ενότητας, ό,τι κι αν είναι αυτή.
  const series = doc.softoneSeries
    ? (doc.seriesSource ?? 1251) === 1251
      ? await prisma.purchaseDocType.findUnique({ where: { code: doc.softoneSeries }, select: { abbrev: true, name: true } })
        .then((r) => (r ? { ...r, family: 'Παραστατικά αγορών' } : null))
      : await prisma.softoneDocSeries.findFirst({
        where: { code: doc.softoneSeries, sosource: doc.seriesSource ?? undefined },
        select: { abbrev: true, name: true, family: true },
      })
    : null;
  const manualSeries = doc.seriesBy === 'manual';
  const seriesTone = manualSeries || (doc.seriesConfidence ?? 0) >= 0.8 ? '#047857' : doc.seriesConfidence != null ? '#B45309' : '#94A3B8';

  /**
   * Πού καταχωρείται αυτό το παραστατικό. Το ίδιο ερώτημα που απαντά η κάρτα «Προορισμός» —
   * αλλά η απάντηση χρειάζεται ΚΑΙ στον πίνακα γραμμών, για να ξέρει ο picker ποια μητρώα
   * χωράνε. Χωρίς αυτό, η σελίδα έδειχνε τον προορισμό και ταυτόχρονα πρότεινε ενέργειες που
   * τον αγνοούσαν.
   */
  const seriesRef = { seriesSource: doc.seriesSource, softoneSeries: doc.softoneSeries };
  const sKey = seriesKey(seriesRef);
  const postingTarget = sKey ? (await postingTargetsForSeries([seriesRef])).get(sKey) ?? null : null;

  const issuerVat = ((doc.extractedData ?? {}) as { vatNumber?: unknown }).vatNumber;
  // Η βοήθεια της λωρίδας περνά από τον ΙΔΙΟ δρόμο με κάθε άλλο «?» της εφαρμογής
  // (`findHelpAnchor` + έλεγχος ρόλου), αντί για σταθερή διαδρομή: μια wiki σελίδα που
  // μετακινήθηκε ή που ο ρόλος δεν βλέπει δεν πρέπει να αφήνει πίσω σπασμένο εικονίδιο.
  const checksHelpHref = completed
    ? helpHrefFor('doc-resolve', (user.role.key as WikiRoleKey | undefined) ?? null)
    : null;
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
                {series?.family && <span>· {series.family}</span>}
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

      {completed && <SoftoneChecksStrip docId={doc.id} helpHref={checksHelpHref} />}

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
          unknownForm={(doc.reviewFlags as { unknownForm?: boolean } | null)?.unknownForm === true}
          helpHref={helpHref}
        />
      )}

      {completed && <DocumentJsonCard docId={doc.id} canPost={canPost} />}

      <OcrResultView
        doc={doc}
        match={{
          canManage,
          lineCategories: lineCategories.map((c) => ({ id: c.mtrCategory, label: c.name || c.code })),
          analyticsLabels: {
            costCntr: byId(ccRows, (r) => r.costcntr),
            prjc: byId(pjRows, (r) => r.prjc),
            prjcStage: byId(psRows, (r) => r.prjcStage),
          },
          trdr: doc.softoneTrdr ?? null,
          lineAccounts,
          target: postingTarget,
        }}
      />
    </div>
  );
}
