import Link from 'next/link';
import { FiAlertCircle, FiArrowRight, FiCheckCircle } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';
import {
  reconMeta, reconMetaFor, deriveReconStatus, RECON_PENDING_ORDER,
  type ReconInput, type ReconStatus,
} from '@/lib/ocr/recon-status';

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
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-[12px] font-medium hover:bg-muted"
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
          <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            {ordered.map((g) => (
              <a
                key={g.meta.status}
                href={`#${g.meta.status}`}
                className="relative overflow-hidden rounded-lg border border-border bg-card px-3 py-2.5 shadow-fluent-2"
                style={{ borderColor: g.meta.tone.bd }}
              >
                <span className="absolute left-0 top-0 h-full w-1" style={{ backgroundColor: g.meta.tone.fg }} />
                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: g.meta.tone.fg }}>{g.meta.label}</p>
                <p className="mt-0.5 text-title-2 font-bold tabular-nums tracking-tight text-foreground">{g.items.length}</p>
              </a>
            ))}
          </section>

          <div className="space-y-4">
            {ordered.map((g) => (
              <section
                key={g.meta.status}
                id={g.meta.status}
                className="scroll-mt-6 overflow-hidden rounded-lg border bg-card shadow-fluent-2"
                style={{ borderColor: g.meta.tone.bd }}
              >
                <div className="flex items-center gap-2 px-4 py-2.5" style={{ backgroundColor: g.meta.tone.bg }}>
                  <FiAlertCircle className="size-4" style={{ color: g.meta.tone.fg }} />
                  <span className="text-[13px] font-semibold" style={{ color: g.meta.tone.fg }}>{g.meta.label}</span>
                  <span
                    className="rounded-full border bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
                    style={{ color: g.meta.tone.fg, borderColor: g.meta.tone.bd }}
                  >
                    {g.items.length}
                  </span>
                  {g.meta.solution && (
                    <span className="ml-2 truncate text-[11px] text-foreground/70">
                      <span className="font-semibold">Λύση:</span> {g.meta.solution}
                    </span>
                  )}
                </div>
                <ul className="divide-y divide-border">
                  {g.items.map((it) => (
                    <li key={it.id}>
                      <Link
                        href={`/admin/ocr/${it.id}`}
                        className="flex items-center gap-3 px-4 py-2 text-[12px] hover:bg-muted/50"
                      >
                        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{it.fileName}</span>
                        <span className="hidden min-w-0 flex-1 truncate text-muted-foreground sm:block">{it.issuer ?? '—'}</span>
                        <span className="hidden font-mono text-[11px] text-muted-foreground md:block">{it.docNumber ?? '—'}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {it.createdAt.toLocaleDateString('el-GR')}
                        </span>
                        <FiArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
