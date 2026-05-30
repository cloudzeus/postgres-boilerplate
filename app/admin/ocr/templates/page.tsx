import { FiLayers } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';
import { DeleteTemplateButton } from './delete-button';

export const dynamic = 'force-dynamic';

export default async function OcrTemplatesPage() {
  await requirePermission('ocr.read');

  const templates = await prisma.supplierTemplate.findMany({ orderBy: { updatedAt: 'desc' } });

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title="Πρότυπα Προμηθευτών (OCR)"
        description="Αποθηκευμένα πρότυπα εξαγωγής δεδομένων ανά προμηθευτή και τύπο εγγράφου."
        icon={<FiLayers />}
        helpAnchor="ocr-templates"
      />

      <div className="rounded-lg border border-border bg-card shadow-fluent-2 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="px-4 py-2.5 text-left font-semibold text-muted-foreground">Προμηθευτής</th>
              <th className="px-4 py-2.5 text-left font-semibold text-muted-foreground">ΑΦΜ</th>
              <th className="px-4 py-2.5 text-left font-semibold text-muted-foreground">Τύπος</th>
              <th className="px-4 py-2.5 text-right font-semibold text-muted-foreground">Χρήσεις</th>
              <th className="px-4 py-2.5 text-left font-semibold text-muted-foreground">Ενημ.</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {templates.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  Δεν υπάρχουν αποθηκευμένα πρότυπα.
                </td>
              </tr>
            ) : (
              templates.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-2.5 font-medium text-foreground">
                    {t.supplierName ?? <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{t.vatNumber}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{t.docType}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{t.timesUsed}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {t.updatedAt.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <DeleteTemplateButton id={t.id} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
