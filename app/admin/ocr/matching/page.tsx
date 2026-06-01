import { FiLink } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';
import { MatchingClient } from './matching-client';

export const dynamic = 'force-dynamic';

export default async function OcrMatchingPage() {
  await requirePermission('ocr.read');

  const [unmatchedLines, suppliers] = await Promise.all([
    // All unmatched lines; product/service split is computed below from the
    // per-line override (softoneIsService) falling back to the document kind.
    prisma.ocrInvoiceItem.findMany({
      where: { softoneMtrl: null },
      orderBy: { id: 'desc' }, take: 1000,
      select: {
        id: true, code: true, name: true, softoneIsService: true,
        document: { select: { id: true, fileName: true, softoneName: true, invoiceKind: true } },
      },
    }),
    // Documents whose supplier was checked but not found in SoftOne.
    prisma.ocrDocument.findMany({
      where: { softoneTrdr: null, softoneChecked: { not: null }, status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' }, take: 500,
      select: { id: true, fileName: true, extractedData: true },
    }),
  ]);

  const toLine = (l: typeof unmatchedLines[number]) => ({
    id: l.id, code: l.code, name: l.name,
    docId: l.document.id, fileName: l.document.fileName, supplier: l.document.softoneName,
  });
  // Effective type: per-line override wins, else the document's invoiceKind.
  const isServiceLine = (l: typeof unmatchedLines[number]) =>
    l.softoneIsService ?? (l.document.invoiceKind === 'service');
  const productLines = unmatchedLines.filter((l) => !isServiceLine(l));
  const serviceLines = unmatchedLines.filter((l) => isServiceLine(l));
  const supRows = suppliers.map((d) => {
    const ed = (d.extractedData ?? {}) as Record<string, unknown>;
    return { docId: d.id, fileName: d.fileName, afm: String(ed.vatNumber ?? ''), issuer: String(ed.companyName ?? ed.storeName ?? '') };
  });

  return (
    <div className="w-full">
      <PageHeader
        icon={<FiLink />}
        title="Αντιστοιχίσεις SoftOne"
        description="Γραμμές & προμηθευτές που δεν βρέθηκαν αυτόματα — αναζήτησε και αντιστοίχισε χειροκίνητα."
        helpAnchor="ocr-matching"
      />
      <MatchingClient
        products={productLines.map(toLine)}
        services={serviceLines.map(toLine)}
        suppliers={supRows}
      />
    </div>
  );
}
