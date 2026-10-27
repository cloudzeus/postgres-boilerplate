import Link from 'next/link';
import { FiAlertCircle, FiArrowRight, FiCheckCircle } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';
import { StatCard } from '@/components/admin/stat-card';
import {
  reconMeta, reconMetaFor, deriveReconStatus, RECON_PENDING_ORDER,
  type ReconInput, type ReconStatus,
} from '@/lib/ocr/recon-status';
import { PendingBlockers, type PendingDoc } from './pending-blockers';

export const dynamic = 'force-dynamic';

export default async function OcrPendingPage() {
  await requirePermission('ocr.read');

  // Pull recent docs that could be outstanding (skip already-posted to keep it lean).
  const docs = await prisma.ocrDocument.findMany({
    where: { postStatus: { not: 'POSTED' } },
    orderBy: { createdAt: 'desc' },
    take: 1000,
    select: {
      id: true, fileName: true, createdAt: true, extractedData: true,
      status: true, category: true, postStatus: true,
      softoneTrdr: true, softoneDocExists: true,
      itemsTotal: true, itemsMatched: true, reconOverride: true,
    },
  });

  type Item = {
    id: string; fileName: string; createdAt: Date;
    issuer: string | null; docNumber: string | null; status: ReconStatus;
  };

  const buckets = new Map<ReconStatus, Item[]>();
  for (const d of docs) {
    const input: ReconInput = {
      status: d.status, category: d.category, postStatus: d.postStatus,
      softoneTrdr: d.softoneTrdr, softoneDocExists: d.softoneDocExists,
      itemsTotal: d.itemsTotal, itemsMatched: d.itemsMatched, reconOverride: d.reconOverride,
    };
    const meta = reconMeta(input);
    if (!meta.pending) continue;
    const data = (d.extractedData ?? {}) as any;
    const item: Item = {
      id: d.id, fileName: d.fileName, createdAt: d.createdAt,
      issuer: data?.companyName ?? data?.storeName ?? data?.title ?? null,
      docNumber: data?.invoiceNumber ?? null,
      status: deriveReconStatus(input),
    };
    const list = buckets.get(item.status);
    if (list) list.push(item); else buckets.set(item.status, [item]);
  }

  const ordered = RECON_PENDING_ORDER
    .filter((s) => buckets.has(s))
    .map((s) => ({ meta: reconMetaFor(s), items: buckets.get(s)! }));
  const totalPending = ordered.reduce((n, g) => n + g.items.length, 0);

  // Η σειρά είναι η ίδια με τις ομάδες — ο χρήστης βλέπει πρώτα ό,τι είναι πιο επείγον. Η
  // ημερομηνία μορφοποιείται ΕΔΩ: ο client δεν πρέπει να διαφωνήσει με τον server στο locale.
  const flat: PendingDoc[] = ordered.flatMap((g) => g.items.map((it) => ({
    id: it.id,
    fileName: it.fileName,
    issuer: it.issuer,
    docNumber: it.docNumber,
    createdAt: it.createdAt.toLocaleDateString('el-GR'),
    statusLabel: g.meta.label,
  })));

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title="Εκκρεμότητες OCR"
        description="Όλα τα παραστατικά που χρειάζονται ενέργεια, ομαδοποιημένα κατά κατάσταση."
        icon={<FiAlertCircle />}
        helpAnchor="ocr-pending"
        actions={
          <Link
            href="/admin/ocr"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-[length:var(--fs-12)] font-medium hover:bg-muted"
          >
            Λίστα OCR <FiArrowRight className="size-3.5" />
          </Link>
        }
      />

      {totalPending === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card py-16 text-center shadow-fluent-2">
          <FiCheckCircle className="size-10 text-emerald-500" />
          <p className="text-title-3 font-semibold text-foreground">Καμία εκκρεμότητα</p>
          <p className="text-body-sm text-muted-foreground">Όλα τα παραστατικά είναι τακτοποιημένα.</p>
        </div>
      ) : (
        <>
          <section className="grid auto-rows-fr grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            {ordered.map((g) => (
              <StatCard
                key={g.meta.status}
                label={g.meta.label}
                value={g.items.length}
                icon={<FiAlertCircle />}
                color={{ fg: g.meta.tone.fg, bg: g.meta.tone.bg }}
                sub={`${Math.round((g.items.length / totalPending) * 100)}% των εκκρεμοτήτων`}
              />
            ))}
          </section>

          <PendingBlockers docs={flat} />
        </>
      )}
    </div>
  );
}
