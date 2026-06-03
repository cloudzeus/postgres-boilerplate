import { FiSliders } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission, hasPermission } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';
import { FieldRulesClient, type FieldRuleRow } from './field-rules-client';

export const dynamic = 'force-dynamic';

export default async function OcrFieldRulesPage() {
  await requirePermission('ocr.read');
  const canManage = await hasPermission('ocr.categorize');
  const rules = await prisma.supplierFieldRule.findMany({
    orderBy: [{ supplierName: 'asc' }, { vatNumber: 'asc' }, { docType: 'asc' }, { label: 'asc' }],
  });
  const rows: FieldRuleRow[] = rules.map((r) => ({
    id: r.id, vatNumber: r.vatNumber, supplierName: r.supplierName,
    docType: r.docType, label: r.label, description: r.description,
    isActive: r.isActive, timesUsed: r.timesUsed,
  }));
  return (
    <div className="w-full">
      <PageHeader
        icon={<FiSliders />}
        title="Ειδικά πεδία προμηθευτών"
        description="Κανόνες για επιπλέον πεδία που εξάγονται αυτόματα από τα παραστατικά συγκεκριμένων προμηθευτών."
        helpAnchor="ocr-field-rules"
      />
      <FieldRulesClient rows={rows} canManage={canManage} />
    </div>
  );
}
