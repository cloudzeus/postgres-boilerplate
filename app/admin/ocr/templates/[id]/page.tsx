import { notFound } from 'next/navigation';
import { FiLayers } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission, hasPermission } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';
import { TEMPLATE_INCLUDE, toTemplateDto } from '@/lib/templates/serialize';
import { TemplateDesigner } from '@/components/templates/template-designer';

export const dynamic = 'force-dynamic';

export default async function TemplateDesignerPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.read');
  const { id } = await params;
  const [t, canManage, canPost] = await Promise.all([
    prisma.extractionTemplate.findUnique({ where: { id }, include: TEMPLATE_INCLUDE }),
    hasPermission('ocr.categorize'),
    hasPermission('ocr.post'),
  ]);
  if (!t) notFound();
  const dto = toTemplateDto(t);
  return (
    <div className="w-full">
      <PageHeader icon={<FiLayers />} title={dto.name} description={`${dto.supplierName ?? ''} · ΑΦΜ ${dto.vatNumber}`} helpAnchor="templates" />
      <TemplateDesigner initial={dto} canManage={canManage} canPost={canPost} />
    </div>
  );
}
