import { redirect } from 'next/navigation';
import ExcelJS from 'exceljs';
import { prisma } from '@/lib/db';
import { getCurrentUserWithPermissions } from '@/lib/rbac';
import { getSetting } from '@/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SCOPE_LABELS: Record<string, string> = {
  OCR_TEXT:         'OCR · Digital PDF',
  OCR_VISION:       'OCR · Vision',
  OCR_VISION_RETRY: 'OCR · Vision retry (HQ)',
  TRANSLATION:      'Translation',
  OTHER:            'Other',
};

export async function GET() {
  const u = await getCurrentUserWithPermissions();
  if (!u || u.role.key !== 'SUPER_ADMIN') redirect('/admin');

  // Stored costs are USD → display EUR via the admin-configurable rate.
  const usdToEur = Number(await getSetting<number>('ai.usdToEur', 0.92)) || 0.92;
  const toEur = (usd: number) => usd * usdToEur;

  const now = new Date();
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const start30d = new Date(now.getTime() - 30 * 24 * 3600 * 1000);

  const [overall, monthAgg, scopeRows, modelRows, monthlyRows, dailyRows, recent] = await Promise.all([
    prisma.aiUsage.aggregate({
      _count: { _all: true },
      _sum: { totalTokens: true, totalCost: true, inputTokens: true, outputTokens: true },
    }),
    prisma.aiUsage.aggregate({
      where: { createdAt: { gte: startMonth } },
      _count: { _all: true },
      _sum: { totalTokens: true, totalCost: true },
    }),
    prisma.aiUsage.groupBy({
      by: ['scope'],
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, totalTokens: true, totalCost: true },
    }),
    prisma.aiUsage.groupBy({
      by: ['model', 'provider'],
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, totalTokens: true, totalCost: true },
      orderBy: { _sum: { totalCost: 'desc' } },
    }),
    prisma.$queryRaw<Array<{ month: Date; tokens: number; cost: string | null; calls: bigint }>>`
      SELECT date_trunc('month', "createdAt") AS month,
             SUM("totalTokens")::int          AS tokens,
             SUM("totalCost")                 AS cost,
             COUNT(*)                         AS calls
      FROM   "AiUsage"
      GROUP  BY 1
      ORDER  BY 1 DESC
      LIMIT  24
    `,
    prisma.$queryRaw<Array<{ day: Date; tokens: number; cost: string | null; calls: bigint }>>`
      SELECT date_trunc('day', "createdAt") AS day,
             SUM("totalTokens")::int        AS tokens,
             SUM("totalCost")               AS cost,
             COUNT(*)                       AS calls
      FROM   "AiUsage"
      WHERE  "createdAt" >= ${start30d}
      GROUP  BY 1
      ORDER  BY 1 ASC
    `,
    prisma.aiUsage.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5000,
    }),
  ]);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'DGEspa ERP';
  wb.created = now;

  // ───────────────────── Summary
  const summary = wb.addWorksheet('Σύνοψη');
  summary.columns = [{ width: 32 }, { width: 22 }];
  summary.addRow(['Αναφορά AI κόστους', '']).font = { bold: true, size: 14 };
  summary.addRow(['Δημιουργήθηκε', now.toLocaleString('el-GR')]);
  summary.addRow([]);
  summary.addRow(['Σύνολο κλήσεων (lifetime)', overall._count._all]);
  summary.addRow(['Σύνολο tokens (lifetime)', Number(overall._sum.totalTokens ?? 0)]);
  summary.addRow(['Σύνολο input tokens', Number(overall._sum.inputTokens ?? 0)]);
  summary.addRow(['Σύνολο output tokens', Number(overall._sum.outputTokens ?? 0)]);
  summary.addRow(['Σύνολο κόστους (EUR)', toEur(Number(overall._sum.totalCost ?? 0))])
    .getCell(2).numFmt = '#,##0.000000" €"';
  summary.addRow([]);
  summary.addRow(['Τρέχων μήνας — κλήσεις', monthAgg._count._all]);
  summary.addRow(['Τρέχων μήνας — tokens', Number(monthAgg._sum.totalTokens ?? 0)]);
  summary.addRow(['Τρέχων μήνας — κόστος (EUR)', toEur(Number(monthAgg._sum.totalCost ?? 0))])
    .getCell(2).numFmt = '#,##0.000000" €"';

  // ───────────────────── Ανά μοντέλο
  const sModel = wb.addWorksheet('Ανά μοντέλο');
  sModel.columns = [
    { header: 'Provider',     key: 'provider',     width: 16 },
    { header: 'Model',        key: 'model',        width: 36 },
    { header: 'Κλήσεις',      key: 'calls',        width: 12 },
    { header: 'Input tokens', key: 'inputTokens',  width: 16 },
    { header: 'Output tokens',key: 'outputTokens', width: 16 },
    { header: 'Σύνολο tokens',key: 'totalTokens',  width: 18 },
    { header: 'Κόστος (EUR)', key: 'totalCost',    width: 16, style: { numFmt: '#,##0.000000" €"' } },
  ];
  sModel.getRow(1).font = { bold: true };
  for (const r of modelRows) {
    sModel.addRow({
      provider: r.provider,
      model: r.model,
      calls: r._count._all,
      inputTokens: Number(r._sum.inputTokens ?? 0),
      outputTokens: Number(r._sum.outputTokens ?? 0),
      totalTokens: Number(r._sum.totalTokens ?? 0),
      totalCost: toEur(Number(r._sum.totalCost ?? 0)),
    });
  }

  // ───────────────────── Ανά λειτουργία
  const sScope = wb.addWorksheet('Ανά λειτουργία');
  sScope.columns = [
    { header: 'Λειτουργία',    key: 'scope',        width: 28 },
    { header: 'Κλήσεις',       key: 'calls',        width: 12 },
    { header: 'Input tokens',  key: 'inputTokens',  width: 16 },
    { header: 'Output tokens', key: 'outputTokens', width: 16 },
    { header: 'Σύνολο tokens', key: 'totalTokens',  width: 18 },
    { header: 'Κόστος (EUR)',  key: 'totalCost',    width: 16, style: { numFmt: '#,##0.000000" €"' } },
  ];
  sScope.getRow(1).font = { bold: true };
  for (const r of scopeRows) {
    sScope.addRow({
      scope: SCOPE_LABELS[r.scope] ?? r.scope,
      calls: r._count._all,
      inputTokens: Number(r._sum.inputTokens ?? 0),
      outputTokens: Number(r._sum.outputTokens ?? 0),
      totalTokens: Number(r._sum.totalTokens ?? 0),
      totalCost: toEur(Number(r._sum.totalCost ?? 0)),
    });
  }

  // ───────────────────── Μηνιαία
  const sMonthly = wb.addWorksheet('Μηνιαία');
  sMonthly.columns = [
    { header: 'Μήνας',         key: 'month',       width: 14 },
    { header: 'Κλήσεις',       key: 'calls',       width: 12 },
    { header: 'Σύνολο tokens', key: 'totalTokens', width: 18 },
    { header: 'Κόστος (EUR)',  key: 'totalCost',   width: 16, style: { numFmt: '#,##0.000000" €"' } },
  ];
  sMonthly.getRow(1).font = { bold: true };
  for (const r of monthlyRows) {
    sMonthly.addRow({
      month: new Date(r.month).toLocaleDateString('el-GR', { month: '2-digit', year: 'numeric' }),
      calls: Number(r.calls),
      totalTokens: Number(r.tokens ?? 0),
      totalCost: toEur(Number(r.cost ?? 0)),
    });
  }

  // ───────────────────── 30 ημέρες
  const sDaily = wb.addWorksheet('30 ημέρες');
  sDaily.columns = [
    { header: 'Ημερομηνία',    key: 'day',         width: 14 },
    { header: 'Κλήσεις',       key: 'calls',       width: 12 },
    { header: 'Σύνολο tokens', key: 'totalTokens', width: 18 },
    { header: 'Κόστος (EUR)',  key: 'totalCost',   width: 16, style: { numFmt: '#,##0.000000" €"' } },
  ];
  sDaily.getRow(1).font = { bold: true };
  for (const r of dailyRows) {
    sDaily.addRow({
      day: new Date(r.day).toLocaleDateString('el-GR'),
      calls: Number(r.calls),
      totalTokens: Number(r.tokens ?? 0),
      totalCost: toEur(Number(r.cost ?? 0)),
    });
  }

  // ───────────────────── Detailed log (μέχρι 5000)
  const sLog = wb.addWorksheet('Αναλυτικό');
  sLog.columns = [
    { header: 'Πότε',          key: 'createdAt',    width: 22 },
    { header: 'Scope',         key: 'scope',        width: 22 },
    { header: 'Provider',      key: 'provider',     width: 14 },
    { header: 'Model',         key: 'model',        width: 32 },
    { header: 'Operation',     key: 'operation',    width: 22 },
    { header: 'Input tokens',  key: 'inputTokens',  width: 14 },
    { header: 'Output tokens', key: 'outputTokens', width: 14 },
    { header: 'Total tokens',  key: 'totalTokens',  width: 14 },
    { header: 'Κόστος (EUR)',  key: 'totalCost',    width: 16, style: { numFmt: '#,##0.000000" €"' } },
    { header: 'Duration (ms)', key: 'durationMs',   width: 14 },
    { header: 'Ref',           key: 'ref',          width: 28 },
  ];
  sLog.getRow(1).font = { bold: true };
  for (const r of recent) {
    sLog.addRow({
      createdAt: r.createdAt.toLocaleString('el-GR'),
      scope: SCOPE_LABELS[r.scope] ?? r.scope,
      provider: r.provider,
      model: r.model,
      operation: r.operation ?? '',
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      totalTokens: r.totalTokens,
      totalCost: r.totalCost ? toEur(Number(r.totalCost)) : 0,
      durationMs: r.durationMs ?? '',
      ref: r.refId ? `${r.refType ?? ''}:${r.refId}` : '',
    });
  }

  // Pretty header styling on every sheet
  for (const ws of wb.worksheets) {
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    const header = ws.getRow(1);
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0078D4' } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { vertical: 'middle' };
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  const filename = `ai-usage-${now.toISOString().slice(0, 10)}.xlsx`;
  return new Response(new Uint8Array(buffer as ArrayBuffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
