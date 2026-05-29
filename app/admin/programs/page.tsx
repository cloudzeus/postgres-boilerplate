import { FiGlobe, FiCheckCircle, FiClock, FiAlertCircle } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission, hasPermission } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';
import { ProgramUploader } from './uploader';
import { ProgramsTable, type ProgramRow } from './programs-table';

export const dynamic = 'force-dynamic';

export default async function ProgramsPage() {
  await requirePermission('programs.read');
  const [canCreate, canUpdate, canDelete] = await Promise.all([
    hasPermission('programs.create'),
    hasPermission('programs.update'),
    hasPermission('programs.delete'),
  ]);

  const programs = await prisma.program.findMany({
    orderBy: { createdAt: 'desc' },
    take: 500,
    include: { _count: { select: { kads: true, expenseCats: true, regions: true } } },
  });

  const rows: ProgramRow[] = programs.map((p) => ({
    id: p.id,
    title: p.title,
    referenceCode: p.referenceCode,
    summary: p.summary,
    publicationDate: p.publicationDate?.toISOString() ?? null,
    submissionStart: p.submissionStart?.toISOString() ?? null,
    submissionEnd:   p.submissionEnd?.toISOString() ?? null,
    totalBudget: p.totalBudget != null ? Number(p.totalBudget) : null,
    fundingRate: p.fundingRate != null ? Number(p.fundingRate) : null,
    durationMonths: p.durationMonths,
    status: p.status,
    extractStatus: p.extractStatus,
    errorMessage: p.errorMessage,
    sourceFileName: p.sourceFileName,
    createdAt: p.createdAt.toISOString(),
    kadCount: p._count.kads,
    expenseCount: p._count.expenseCats,
    regionCount: p._count.regions,
  }));

  // KPI strip stats
  const now = Date.now();
  const active = programs.filter((p) => {
    const end = p.submissionEnd?.getTime();
    return end != null && end >= now && p.status !== 'ARCHIVED';
  }).length;
  const completed = programs.filter((p) => p.extractStatus === 'COMPLETED').length;
  const failed = programs.filter((p) => p.extractStatus === 'FAILED').length;
  const totalBudget = programs.reduce((sum, p) => sum + (p.totalBudget != null ? Number(p.totalBudget) : 0), 0);

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title="Ευρωπαϊκά Προγράμματα"
        description="Έξυπνη εξαγωγή προσκλήσεων ΕΣΠΑ/EU με Gemini 2.5 Pro. Επεξεργασία, ΚΑΔ, δαπάνες, περιφέρειες."
        icon={<FiGlobe />}
        helpAnchor="self-assessment"
      />

      {/* KPI strip */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiTile label="Ενεργές προσκλήσεις" value={String(active)} accent="sisyphus" icon={<FiClock className="size-3.5" />} sub="μέχρι λήξης υποβολής" />
        <KpiTile label="Επιτυχημένα scans"   value={String(completed)} accent="emerald"  icon={<FiCheckCircle className="size-3.5" />} sub={`${programs.length} σύνολο`} />
        <KpiTile label="Σφάλματα"            value={String(failed)} accent={failed > 0 ? 'red' : 'neutral'} icon={<FiAlertCircle className="size-3.5" />} sub="χρειάζονται resubmit" />
        <KpiTile label="Συνολικός π/υ"       value={fmtCompact(totalBudget)} accent="sisyphus" sub="€ ενοποιημένο" />
      </section>

      {canCreate && <ProgramUploader />}

      <ProgramsTable
        rows={rows}
        canUpdate={canUpdate}
        canDelete={canDelete}
        canCreate={canCreate}
      />
    </div>
  );
}

function fmtCompact(n: number) {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return new Intl.NumberFormat('el-GR').format(n);
}

function KpiTile({
  label, value, sub, accent, icon,
}: {
  label: string; value: string; sub?: string;
  accent: 'sisyphus' | 'emerald' | 'red' | 'neutral';
  icon?: React.ReactNode;
}) {
  const stripe = {
    sisyphus: 'bg-sisyphus-500',
    emerald:  'bg-emerald-500',
    red:      'bg-dg-red-500',
    neutral:  'bg-neutral-20',
  }[accent];
  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-card px-4 py-3 shadow-fluent-2 transition hover:shadow-fluent-4">
      <span className={`absolute left-0 top-0 h-full w-1 ${stripe}`} />
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
        {icon && <span className="text-muted-foreground">{icon}</span>}
      </div>
      <p className="mt-0.5 text-title-2 font-bold tabular-nums tracking-tight text-foreground">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
