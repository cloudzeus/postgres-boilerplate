import { redirect } from 'next/navigation';
import { FiCpu, FiDownload } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { getCurrentUserWithPermissions } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';

export const dynamic = 'force-dynamic';

interface Aggregate {
  count: number;
  totalTokens: number;
  totalCost: number;
}

function fmtUsd(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(n);
}
function fmtNum(n: number) {
  return new Intl.NumberFormat('el-GR').format(n);
}

const SCOPE_LABELS: Record<string, string> = {
  OCR_TEXT:         'OCR · Digital PDF',
  OCR_VISION:       'OCR · Vision',
  OCR_VISION_RETRY: 'OCR · Vision retry (HQ)',
  TRANSLATION:      'Translation',
  OTHER:            'Other',
};

export default async function AiUsagePage() {
  const u = await getCurrentUserWithPermissions();
  if (!u) redirect('/auth/signin');
  if (u.role.key !== 'SUPER_ADMIN') redirect('/admin');

  const now = new Date();
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start30d = new Date(now.getTime() - 30 * 24 * 3600 * 1000);

  const [overall, today, monthRows, scopeRows, modelRows, recent, dailyRows] = await Promise.all([
    prisma.aiUsage.aggregate({
      _count: { _all: true },
      _sum: { totalTokens: true, totalCost: true },
    }),
    prisma.aiUsage.aggregate({
      where: { createdAt: { gte: startToday } },
      _count: { _all: true },
      _sum: { totalTokens: true, totalCost: true },
    }),
    prisma.aiUsage.aggregate({
      where: { createdAt: { gte: startMonth } },
      _count: { _all: true },
      _sum: { totalTokens: true, totalCost: true },
    }),
    prisma.aiUsage.groupBy({
      by: ['scope'],
      _count: { _all: true },
      _sum: { totalTokens: true, totalCost: true },
    }),
    prisma.aiUsage.groupBy({
      by: ['model', 'provider'],
      _count: { _all: true },
      _sum: { totalTokens: true, totalCost: true },
      orderBy: { _sum: { totalCost: 'desc' } },
    }),
    prisma.aiUsage.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    // 30-day daily totals via raw SQL (Postgres)
    prisma.$queryRaw<Array<{ day: Date; tokens: number; cost: string | null; calls: bigint }>>`
      SELECT date_trunc('day', "createdAt") AS day,
             SUM("totalTokens")::int AS tokens,
             SUM("totalCost")        AS cost,
             COUNT(*)                AS calls
      FROM   "AiUsage"
      WHERE  "createdAt" >= ${start30d}
      GROUP  BY 1
      ORDER  BY 1 ASC
    `,
  ]);

  const totalCostAll   = Number(overall._sum.totalCost ?? 0);
  const totalCostMonth = Number(monthRows._sum.totalCost ?? 0);
  const totalCostToday = Number(today._sum.totalCost ?? 0);
  const maxDailyCost = Math.max(...dailyRows.map((r) => Number(r.cost ?? 0)), 0.0001);

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title="AI Usage & κόστος"
        description="Συγκεντρωτική εικόνα της κατανάλωσης AI εργαλείων. Visible only to SUPER_ADMIN."
        icon={<FiCpu />}
        actions={
          <a
            href="/api/admin/ai-usage/export"
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-sisyphus-500 px-3 text-[13px] font-semibold text-white shadow-fluent-2 transition hover:bg-sisyphus-600"
          >
            <FiDownload className="size-4" />
            Excel report
          </a>
        }
      />

      {/* KPI strip */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Σήμερα"     value={fmtUsd(totalCostToday)} sub={`${fmtNum(today._count._all)} κλήσεις`} accent="sisyphus" />
        <Kpi label="Τρέχων μήνας" value={fmtUsd(totalCostMonth)} sub={`${fmtNum(monthRows._count._all)} κλήσεις`} accent="emerald" />
        <Kpi label="Σύνολο"     value={fmtUsd(totalCostAll)}   sub={`${fmtNum(overall._count._all)} κλήσεις`} accent="amber" />
        <Kpi label="Tokens (μήνας)" value={fmtNum(Number(monthRows._sum.totalTokens ?? 0))} sub="input + output" accent="sisyphus" />
      </section>

      {/* Tokens per model chart */}
      <section className="rounded-xl border border-border bg-card p-4 shadow-fluent-2">
        <h3 className="text-[14px] font-semibold tracking-tight">Tokens ανά μοντέλο</h3>
        <p className="text-[11px] text-muted-foreground">Σύνολο tokens που έχουν καταναλωθεί</p>
        {modelRows.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">Δεν υπάρχουν δεδομένα.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {modelRows.map((r) => {
              const tokens = Number(r._sum.totalTokens ?? 0);
              const maxTokens = Math.max(...modelRows.map((m) => Number(m._sum.totalTokens ?? 0)), 1);
              const pct = (tokens / maxTokens) * 100;
              const cost = Number(r._sum.totalCost ?? 0);
              return (
                <div key={r.model} className="flex items-center gap-3">
                  <div className="w-[160px] shrink-0 truncate font-mono text-[11px]" title={r.model}>
                    {r.model}
                  </div>
                  <div className="relative flex-1">
                    <div className="h-5 rounded bg-neutral-8 overflow-hidden">
                      <div
                        className="h-full rounded bg-gradient-to-r from-sisyphus-500 to-sisyphus-600 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <div className="w-[110px] shrink-0 text-right text-[11px] tabular-nums">
                    {fmtNum(tokens)}
                  </div>
                  <div className="w-[80px] shrink-0 text-right text-[11px] tabular-nums font-semibold">
                    {fmtUsd(cost)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Daily sparkline */}
      <section className="rounded-xl border border-border bg-card p-4 shadow-fluent-2">
        <h3 className="text-[14px] font-semibold tracking-tight">Τελευταίες 30 μέρες</h3>
        <p className="text-[11px] text-muted-foreground">USD/ημέρα</p>
        <div className="mt-3 flex h-32 items-end gap-1.5">
          {dailyRows.length === 0 ? (
            <p className="text-xs text-muted-foreground">Δεν υπάρχουν δεδομένα ακόμη.</p>
          ) : dailyRows.map((d) => {
            const cost = Number(d.cost ?? 0);
            const pct = Math.max(2, (cost / maxDailyCost) * 100);
            const label = new Date(d.day).toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit' });
            return (
              <div key={String(d.day)} className="flex flex-1 flex-col items-center gap-1 group">
                <div
                  className="w-full rounded-t-sm bg-sisyphus-500 transition group-hover:bg-sisyphus-600"
                  style={{ height: `${pct}%` }}
                  title={`${label}: ${fmtUsd(cost)} · ${fmtNum(Number(d.tokens ?? 0))} tokens · ${Number(d.calls)} κλήσεις`}
                />
                <span className="text-[9px] tabular-nums text-muted-foreground">{label.slice(0, 5)}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* By scope + by model */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BreakdownTable
          title="Ανά λειτουργία"
          rows={scopeRows.map((r) => ({
            key: r.scope,
            label: SCOPE_LABELS[r.scope] ?? r.scope,
            sublabel: null,
            count: r._count._all,
            tokens: Number(r._sum.totalTokens ?? 0),
            cost: Number(r._sum.totalCost ?? 0),
          }))}
        />
        <BreakdownTable
          title="Ανά μοντέλο"
          rows={modelRows.map((r) => ({
            key: r.model,
            label: r.model,
            sublabel: r.provider,
            count: r._count._all,
            tokens: Number(r._sum.totalTokens ?? 0),
            cost: Number(r._sum.totalCost ?? 0),
          }))}
        />
      </section>

      {/* Recent activity */}
      <section className="rounded-xl border border-border bg-card shadow-fluent-2 overflow-hidden">
        <div className="border-b border-border px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Πρόσφατες κλήσεις (50)
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-neutral-6/60 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Πότε</th>
                <th className="px-3 py-2">Λειτουργία</th>
                <th className="px-3 py-2">Μοντέλο</th>
                <th className="px-3 py-2 text-right">In</th>
                <th className="px-3 py-2 text-right">Out</th>
                <th className="px-3 py-2 text-right">Tokens</th>
                <th className="px-3 py-2 text-right">Κόστος</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {recent.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">Δεν υπάρχουν κλήσεις.</td></tr>
              ) : recent.map((r) => (
                <tr key={r.id} className="hover:bg-neutral-6/40">
                  <td className="px-3 py-2 text-[12px] text-muted-foreground tabular-nums">
                    {r.createdAt.toLocaleString('el-GR')}
                  </td>
                  <td className="px-3 py-2 text-[12px]">{SCOPE_LABELS[r.scope] ?? r.scope}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">{r.model}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtNum(r.inputTokens)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtNum(r.outputTokens)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{fmtNum(r.totalTokens)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">
                    {r.totalCost != null ? fmtUsd(Number(r.totalCost)) : <span className="text-muted-foreground">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: 'sisyphus' | 'emerald' | 'amber' }) {
  const accentMap = { sisyphus: 'bg-sisyphus-500', emerald: 'bg-emerald-500', amber: 'bg-amber-500' } as const;
  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-card px-4 py-3 shadow-fluent-2">
      <span className={`absolute left-0 top-0 h-full w-1 ${accentMap[accent]}`} />
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-title-2 font-bold tabular-nums tracking-tight text-foreground">{value}</p>
      <p className="text-[11px] text-muted-foreground">{sub}</p>
    </div>
  );
}

function BreakdownTable({
  title, rows,
}: {
  title: string;
  rows: Array<{ key: string; label: string; sublabel: string | null; count: number; tokens: number; cost: number }>;
}) {
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  return (
    <div className="rounded-xl border border-border bg-card shadow-fluent-2 overflow-hidden">
      <div className="border-b border-border px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">Δεν υπάρχουν δεδομένα.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-neutral-6/60 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Όνομα</th>
              <th className="px-3 py-2 text-right">Κλήσεις</th>
              <th className="px-3 py-2 text-right">Tokens</th>
              <th className="px-3 py-2 text-right">Κόστος</th>
              <th className="px-3 py-2 w-1/4">%</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => {
              const pct = totalCost > 0 ? (r.cost / totalCost) * 100 : 0;
              return (
                <tr key={r.key} className="hover:bg-neutral-6/40">
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.label}</div>
                    {r.sublabel && <div className="text-[10px] text-muted-foreground">{r.sublabel}</div>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{new Intl.NumberFormat('el-GR').format(r.count)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{new Intl.NumberFormat('el-GR').format(r.tokens)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtUsd(r.cost)}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 rounded-full bg-neutral-8 overflow-hidden">
                        <div className="h-full rounded-full bg-sisyphus-500" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[10px] tabular-nums text-muted-foreground">{pct.toFixed(0)}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
