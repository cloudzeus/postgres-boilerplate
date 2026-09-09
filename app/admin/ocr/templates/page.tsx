import { FiLayers } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission, hasPermission } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';
import { TemplatesTable, type TemplateRow } from './templates-table';
import { NewTemplateDialog } from './new-template-dialog';

export const dynamic = 'force-dynamic';

// Πρότυπα εξαγωγής προμηθευτών — λίστα. Αντικαθιστά την παλιά σελίδα SupplierTemplate.
export default async function TemplatesPage() {
  await requirePermission('ocr.read');
  const [rows, canManage] = await Promise.all([
    prisma.extractionTemplate.findMany({
      orderBy: [{ supplierName: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { fields: true, runs: true } } },
    }),
    hasPermission('ocr.categorize'),
  ]);
  const data: TemplateRow[] = rows.map((t) => ({
    id: t.id, name: t.name, vatNumber: t.vatNumber, supplierName: t.supplierName, docType: t.docType,
    mode: t.mode, status: t.status, version: t.version, fieldsCount: t._count.fields, runsCount: t._count.runs,
    timesUsed: t.timesUsed, hasSample: !!t.sampleStorageKey, updatedAt: t.updatedAt.toISOString(),
  }));

  return (
    <div className="w-full">
      <PageHeader
        icon={<FiLayers />}
        title="Πρότυπα προμηθευτών"
        description={`Περιοχές, πεδία, mapping και conditions ανά προμηθευτή (${data.length} πρότυπα).`}
        helpAnchor="templates"
        actions={canManage ? <NewTemplateDialog /> : undefined}
      />
      <TemplatesTable rows={data} canManage={canManage} />
    </div>
  );
}
