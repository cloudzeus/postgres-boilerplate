import Link from 'next/link';
import { FiFolder, FiChevronRight } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';
import { OcrFolderUpload } from '@/components/admin/ocr-folder-upload';

export const dynamic = 'force-dynamic';

export default async function OcrBatchesPage() {
  await requirePermission('ocr.read');

  const batches = await prisma.ocrBatch.findMany({
    orderBy: { createdAt: 'desc' }, take: 100,
    include: { _count: { select: { documents: true } } },
  });
  const stats = await Promise.all(batches.map((b) =>
    prisma.ocrDocument.groupBy({
      by: ['status'], where: { batchId: b.id }, _count: true,
    }).then((g) => Object.fromEntries(g.map((x) => [x.status, x._count]))),
  ));

  return (
    <div className="w-full space-y-5">
      <PageHeader icon={<FiFolder />} title="Φάκελοι παραστατικών"
        description="Ανέβασε ολόκληρους φακέλους — αυτόματο OCR, ομαδοποίηση, αντιστοιχίσεις & έλεγχοι." />

      <OcrFolderUpload />

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/80 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-semibold">Φάκελος</th>
              <th className="px-4 py-2 text-left font-semibold w-[120px]">Αρχεία</th>
              <th className="px-4 py-2 text-left font-semibold w-[220px]">Κατάσταση</th>
              <th className="px-4 py-2 text-left font-semibold w-[160px]">Δημιουργία</th>
              <th className="px-4 py-2 w-[48px]" />
            </tr>
          </thead>
          <tbody>
            {batches.map((b, i) => {
              const s = stats[i] as Record<string, number>;
              const total = b._count.documents;
              const completed = s.COMPLETED ?? 0;
              const processing = s.PROCESSING ?? 0;
              const failed = s.FAILED ?? 0;
              return (
                <tr key={b.id} className="border-t border-border/60 hover:bg-muted/30">
                  <td className="px-4 py-2.5">
                    <Link href={`/admin/ocr/batches/${b.id}`} className="flex items-center gap-2 font-medium text-foreground hover:underline">
                      <FiFolder className="h-4 w-4 text-[#0078D4]" /> {b.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{total}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5 text-[11px]">
                      {completed > 0 && <span className="rounded-full px-1.5 py-0.5 font-semibold" style={{ background: '#ECFDF5', color: '#047857' }}>{completed} ✓</span>}
                      {processing > 0 && <span className="rounded-full px-1.5 py-0.5 font-semibold" style={{ background: '#EAF2FF', color: '#1D4ED8' }}>{processing} …</span>}
                      {failed > 0 && <span className="rounded-full px-1.5 py-0.5 font-semibold" style={{ background: '#FEF2F2', color: '#B91C1C' }}>{failed} ✕</span>}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-[12px] text-muted-foreground">{b.createdAt.toLocaleString('el-GR')}</td>
                  <td className="px-4 py-2.5 text-right"><FiChevronRight className="ml-auto h-4 w-4 text-muted-foreground" /></td>
                </tr>
              );
            })}
            {batches.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-[13px] text-muted-foreground">Δεν υπάρχουν φάκελοι ακόμα — ανέβασε τον πρώτο.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
