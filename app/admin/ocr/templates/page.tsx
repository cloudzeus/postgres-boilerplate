import { FiLayers } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission, hasPermission } from '@/lib/rbac';
import { LIST_QUERY, toListRow } from '@/lib/templates/list';
import { PageHeader } from '@/components/admin/page-header';
import { TemplatesTable, type TemplateRow } from './templates-table';
import { NewTemplateDialog } from './new-template-dialog';

export const dynamic = 'force-dynamic';

// Πρότυπα εξαγωγής — λίστα. Το πρότυπο είναι ανεξάρτητο· ο προμηθευτής/τμήμα είναι προαιρετικά.
export default async function TemplatesPage() {
  await requirePermission('ocr.read');
  const [rows, canManage] = await Promise.all([
    prisma.extractionTemplate.findMany(LIST_QUERY),
    hasPermission('ocr.categorize'),
  ]);
  const data: TemplateRow[] = rows.map(toListRow);

  return (
    <div className="w-full">
      <PageHeader
        icon={<FiLayers />}
        title="Πρότυπα εξαγωγής"
        description={`Έντυπα με περιοχές και πεδία· έξοδος JSON ανά έγγραφο (${data.length} πρότυπα).`}
        helpAnchor="templates"
        actions={canManage ? <NewTemplateDialog /> : undefined}
      />
      <TemplatesTable rows={data} canManage={canManage} />
    </div>
  );
}
