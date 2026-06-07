import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FiArrowLeft } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { TaxTemplateEditor } from './editor';

export const dynamic = 'force-dynamic';

export default async function TaxTemplateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('programs.read');
  const { id } = await params;

  const template = await prisma.taxFormTemplate.findUnique({
    where: { id },
    include: { fields: { orderBy: { order: 'asc' } } },
  });
  if (!template) notFound();

  const serialized = {
    id: template.id,
    code: template.code,
    name: template.name,
    year: template.year,
    description: template.description,
    status: template.status as 'DRAFT' | 'READY',
    sampleStorageKey: template.sampleStorageKey,
    samplePageCount: template.samplePageCount,
    sampleThumbUrl: template.sampleThumbUrl,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
    fields: template.fields.map((f) => ({
      id: f.id,
      fieldKey: f.fieldKey,
      label: f.label,
      section: f.section,
      valueType: f.valueType as 'CURRENCY' | 'NUMBER' | 'PERCENT' | 'INTEGER' | 'DATE' | 'BOOLEAN',
      regionHint: f.regionHint as { page: number; bbox: [number, number, number, number] } | null,
      aiHint: f.aiHint,
      required: f.required,
      order: f.order,
    })),
  };

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-center">
        <Link href="/admin/tax-templates" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <FiArrowLeft className="size-4" /> Πίσω στη λίστα
        </Link>
      </div>
      <TaxTemplateEditor template={serialized} />
    </div>
  );
}
