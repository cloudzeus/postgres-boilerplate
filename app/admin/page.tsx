import Link from 'next/link';
import {
  FiActivity, FiFileText, FiCheckCircle, FiAlertTriangle, FiUploadCloud,
  FiXCircle, FiCpu, FiUsers, FiShield, FiKey, FiUpload,
} from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requireUser, hasPermission } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';
import { AiUsageDailyChart } from '@/components/admin/ai-usage-daily-chart';
import { parseRange } from '@/lib/dashboard/series';
import { loadDashboard, CHART } from '@/lib/dashboard/stats';
import { DocsDailyChart } from '@/components/admin/dashboard/docs-daily-chart';
import {
  RangeTabs, KpiCard, Card, DonutCard, BarList, AttentionCard,
  RecentDocsCard, SuppliersCard, TemplateStrip,
} from '@/components/admin/dashboard/cards';
import { fmtEur, RANGE_LABEL } from '@/components/admin/dashboard/format';

export const dynamic = 'force-dynamic';

export default async function AdminHomePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string | string[] }>;
}) {
  const user = await requireUser();
  const greeting = `Καλώς ήρθες, ${user.name?.split(' ')[0] ?? user.email}`;

  // Το dashboard δείχνει οικονομικά στοιχεία OCR. Όποιος δεν έχει `ocr.read`
  // παίρνει τη λιτή επισκόπηση συστήματος αντί για τα νούμερα των παραστατικών.
  if (!(await hasPermission('ocr.read'))) return <SystemOverview greeting={greeting} />;

  const range = parseRange((await searchParams).range);
  const data = await loadDashboard(range);
  const rangeLabel = RANGE_LABEL[range];

  return (
    <div className="w-full space-y-4">
      {/* Ο επιλογέας περιόδου τυλίγεται σε δική του γραμμή στα στενά πλάτη — μέσα στο
          `actions` του PageHeader θα έστυβε τον τίτλο σε «Κα…» στα 375 px. */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          className="mb-0 min-w-[220px] flex-1"
          icon={<FiActivity />}
          title={greeting}
          description="Επισκόπηση OCR & καταχωρίσεων"
          helpAnchor="admin-home"
        />
        <RangeTabs active={range} />
      </div>

      {data.totalDocsEver === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* 2 — KPIs */}
          <section aria-label="Βασικοί δείκτες" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <KpiCard
              label="Έγγραφα" datum={data.kpis.created} rangeLabel={rangeLabel}
              icon={<FiFileText />} href="/admin/ocr"
            />
            <KpiCard
              label="Ολοκληρώθηκαν" datum={data.kpis.completed} rangeLabel={rangeLabel}
              icon={<FiCheckCircle />} href="/admin/ocr"
            />
            <KpiCard
              label="Σε έλεγχο" datum={data.kpis.review} rangeLabel={rangeLabel}
              icon={<FiAlertTriangle />} href="/admin/ocr/pending" invert
            />
            <KpiCard
              label="Καταχωρήθηκαν στο SoftOne" datum={data.kpis.posted} rangeLabel={rangeLabel}
              icon={<FiUploadCloud />} href="/admin/ocr"
            />
            <KpiCard
              label="Αποτυχίες" datum={data.kpis.failed} rangeLabel={rangeLabel}
              icon={<FiXCircle />} href="/admin/ocr" invert
            />
            <KpiCard
              label="Κόστος AI" datum={data.kpis.costEur} rangeLabel={rangeLabel}
              icon={<FiCpu />} href="/admin/ai-usage" format={fmtEur} invert
            />
          </section>

          {/* 3 — Γραφήματα */}
          <section className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <Card title="Έγγραφα ανά ημέρα" description={`Νέα έγγραφα και καταχωρίσεις στο SoftOne — ${rangeLabel}`}>
              <DocsDailyChart data={data.docsDaily} />
            </Card>
            <Card title="Κόστος AI ανά ημέρα" description={`Κόστος (EUR), έγγραφα και ισοτιμία USD→EUR — ${rangeLabel}`}>
              <AiUsageDailyChart data={data.aiDaily} />
            </Card>
          </section>

          {/* 4 — Κατανομές */}
          <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            <DonutCard
              title="Κατάσταση εγγράφων"
              description={`Όσα δημιουργήθηκαν — ${rangeLabel}`}
              items={data.statusBreakdown}
              totalLabel="έγγραφα"
            />
            <DonutCard
              title="Καταχώριση SoftOne"
              description={`Όσα δημιουργήθηκαν — ${rangeLabel}`}
              items={data.postBreakdown}
              totalLabel="έγγραφα"
            />
            <BarList
              title="Τύποι παραστατικών"
              description={`Κορυφαίοι 8 — ${rangeLabel}`}
              rows={data.docTypes}
              color={CHART.primary}
              emptyText="Δεν υπάρχουν παραστατικά σε αυτή την περίοδο."
            />
          </section>

          {/* 5 + 7 — Εκκρεμότητες & προμηθευτές */}
          <section className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <AttentionCard rows={data.attention} />
            <SuppliersCard rows={data.suppliers} color={CHART.posted} />
          </section>

          {/* 6 — Πρόσφατα έγγραφα */}
          <RecentDocsCard docs={data.recent} />

          {/* 8 — Υγεία προτύπων */}
          <TemplateStrip health={data.templates} />
        </>
      )}
    </div>
  );
}

/** Onboarding — εμφανίζεται μόνο όταν δεν υπάρχει ούτε ένα έγγραφο στο σύστημα. */
function EmptyState() {
  return (
    <section className="cx-card p-6">
      <h2 className="text-subtitle font-semibold text-foreground">Επόμενα βήματα</h2>
      <p className="mt-1 text-body-sm text-muted-foreground">
        Δεν έχει σαρωθεί κανένα έγγραφο ακόμη — μόλις ανέβει το πρώτο, εδώ θα εμφανιστούν
        δείκτες, γραφήματα και εκκρεμότητες.
      </p>
      <ol className="mt-4 list-inside list-decimal space-y-1.5 text-body text-muted-foreground">
        <li>
          Ανέβασε παραστατικά στο{' '}
          <Link href="/admin/ocr" className="font-semibold text-primary hover:underline">OCR &amp; έγγραφα</Link>
        </li>
        <li>
          Ενεργοποίησε{' '}
          <Link href="/admin/doc-series" className="font-semibold text-primary hover:underline">σειρές παραστατικών</Link>
        </li>
        <li>
          Φτιάξε ένα{' '}
          <Link href="/admin/ocr/templates" className="font-semibold text-primary hover:underline">πρότυπο εξαγωγής</Link>
          {' '}για τους συχνούς προμηθευτές
        </li>
      </ol>
    </section>
  );
}

/** Fallback για χρήστες χωρίς `ocr.read` — καμία οικονομική πληροφορία. */
async function SystemOverview({ greeting }: { greeting: string }) {
  const [userCount, roleCount, permissionCount, importCount] = await Promise.all([
    prisma.user.count(),
    prisma.role.count(),
    prisma.permission.count(),
    prisma.excelImport.count(),
  ]);

  const stats = [
    { label: 'Χρήστες', value: userCount, icon: FiUsers, href: '/admin/users' },
    { label: 'Ρόλοι', value: roleCount, icon: FiShield, href: '/admin/roles' },
    { label: 'Δικαιώματα', value: permissionCount, icon: FiKey, href: '/admin/permissions' },
    { label: 'Imports', value: importCount, icon: FiUpload, href: '/admin/imports' },
  ];

  return (
    <div className="w-full">
      <PageHeader
        icon={<FiActivity />}
        title={greeting}
        description="Επισκόπηση συστήματος"
        helpAnchor="admin-home"
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="cx-card cx-transition block p-4 hover:-translate-y-0.5 hover:shadow-fluent-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2"
          >
            <span aria-hidden className="inline-flex size-8 items-center justify-center rounded-sm bg-[var(--cx-accent-soft)] text-primary [&_svg]:size-4">
              <s.icon />
            </span>
            <div className="mt-3 text-title-2 font-semibold leading-none tabular-nums text-foreground">{s.value}</div>
            <div className="mt-1 text-body-sm text-muted-foreground">{s.label}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
