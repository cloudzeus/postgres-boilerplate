import { notFound } from 'next/navigation';
import { FiFolder } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';
import { BatchDetailClient } from './batch-detail-client';

export const dynamic = 'force-dynamic';

export default async function BatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.read');
  const { id } = await params;

  const batch = await prisma.ocrBatch.findUnique({ where: { id } });
  if (!batch) notFound();

  const docs = await prisma.ocrDocument.findMany({
    where: { batchId: id },
    orderBy: { fileName: 'asc' },
    select: {
      id: true, fileName: true, status: true, invoiceKind: true,
      softoneTrdr: true, softoneCode: true, softoneName: true, softoneKind: true, softoneChecked: true,
      softoneDocExists: true, softoneDocRef: true,
      _count: { select: { items: true } },
      items: { where: { softoneMtrl: { not: null } }, select: { id: true } },
    },
  });

  const rows = docs.map((d) => ({
    id: d.id, fileName: d.fileName, status: d.status, invoiceKind: d.invoiceKind,
    supplierName: d.softoneName, supplierCode: d.softoneCode, supplierKind: d.softoneKind,
    supplierChecked: !!d.softoneChecked, supplierFound: d.softoneTrdr != null,
    duplicate: d.softoneDocExists === true, duplicateRef: d.softoneDocRef,
    totalLines: d._count.items, matchedLines: d.items.length,
  }));

  return (
    <div className="w-full">
      <PageHeader icon={<FiFolder />} title={batch.name}
        description={`${rows.length} παραστατικά · δημιουργήθηκε ${batch.createdAt.toLocaleString('el-GR')}`} />
      <BatchDetailClient batchId={id} rows={rows} />
    </div>
  );
}
