import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FiArrowLeft, FiDownload } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission, hasPermission } from '@/lib/rbac';
import { Badge } from '@/components/ui/badge';
import { OcrResultView } from './result-view';
import { DeleteButton } from './delete-button';

export const dynamic = 'force-dynamic';

export default async function OcrDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.read');
  const { id } = await params;
  const doc = await prisma.ocrDocument.findUnique({
    where: { id },
    include: { items: { orderBy: { rowIndex: 'asc' } } },
  });
  if (!doc) notFound();

  const canDelete = await hasPermission('ocr.delete');

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <Link href="/admin/ocr" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <FiArrowLeft className="size-4" /> Πίσω στη λίστα
        </Link>
        <div className="flex items-center gap-2">
          <a
            href={`/api/admin/ocr/${doc.id}/file`}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-muted"
          >
            <FiDownload className="size-3.5" /> Πρωτότυπο
          </a>
          {canDelete && <DeleteButton id={doc.id} />}
        </div>
      </div>

      <header className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">{doc.fileName}</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {doc.docType} · {doc.language.toUpperCase()} · {doc.mimeType} · {(doc.size / 1024).toFixed(1)} KB
              {doc.pdfSource && ` · ${doc.pdfSource}`}
              {doc.durationMs && ` · ${doc.durationMs} ms`}
              {doc.model && ` · ${doc.model}`}
            </p>
          </div>
          <Badge variant={doc.status === 'COMPLETED' ? 'default' : doc.status === 'FAILED' ? 'destructive' : 'secondary'}>
            {doc.status}
          </Badge>
        </div>
        {doc.errorMessage && (
          <pre className="mt-3 whitespace-pre-wrap rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
            {doc.errorMessage}
          </pre>
        )}
      </header>

      <OcrResultView doc={doc} />
    </div>
  );
}
