import Link from 'next/link';
import { FiArrowRight, FiUploadCloud, FiInbox, FiExternalLink } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';
import { OBJECTS_FOR_SOSOURCE, LINES_FOR_OBJECT, type PostLineTable } from '@/lib/ocr/posting-target';

export const dynamic = 'force-dynamic';

/**
 * Σύντομη ετικέτα πίνακα γραμμών ΓΙΑ ΣΤΗΛΗ. Το κοινό `POST_LINES_LABEL` είναι επεξηγηματικό
 * («Αυτόματα ανά γραμμή (Είδη / Υπηρεσίες / Έξοδα)») — σωστό σε κάρτα, αλλά σε κελί σπάει σε
 * τέσσερις σειρές και κρύβει τα υπόλοιπα. Ο ΠΡΩΤΟΣ πίνακας είναι ο προεπιλεγμένος της ενότητας.
 */
const SHORT_LINES: Record<PostLineTable, string> = {
  AUTO: 'ανά γραμμή',
  ITELINES: 'Είδη',
  SRVLINES: 'Υπηρεσίες',
  EXPANAL: 'Έξοδα',
  LINLINES: 'Ειδικές συναλλαγές',
  SXDOCLINES: 'Λογ. εσόδων/εξόδων',
};

const eur = (v: unknown) =>
  v == null ? '—' : `${Number(v).toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

const day = (d: Date | null) =>
  d ? d.toLocaleString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

/** Ημέρα-κλειδί για ομαδοποίηση, στην τοπική ζώνη (ίδια λογική με τον πίνακα OCR). */
const dayKey = (d: Date) => d.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });

export default async function OcrPostedPage() {
  await requirePermission('ocr.read');

  const docs = await prisma.ocrDocument.findMany({
    where: { OR: [{ postStatus: 'POSTED' }, { postedRef: { not: null } }] },
    orderBy: { postedAt: 'desc' },
    take: 500,
    select: {
      id: true, fileName: true, postedAt: true, postedRef: true,
      softoneName: true, softoneCode: true, issuerAfm: true,
      softoneSeries: true, seriesSource: true,
      document: true,
      _count: { select: { items: true } },
    },
  });

  type Row = {
    id: string; fileName: string; postedAt: Date | null; postedRef: string | null;
    supplier: string; afm: string; series: string; object: string; linesLabel: string;
    number: string; docDate: string; total: number | null; lines: number;
  };

  const rows: Row[] = docs.map((d) => {
    const doc = (d.document ?? {}) as any;
    const object = d.seriesSource ? OBJECTS_FOR_SOSOURCE[Number(d.seriesSource)] : undefined;
    return {
      id: d.id, fileName: d.fileName, postedAt: d.postedAt, postedRef: d.postedRef,
      supplier: d.softoneName ?? doc?.issuer?.name ?? '—',
      afm: d.issuerAfm ?? doc?.issuer?.vat ?? '—',
      series: [d.seriesSource, d.softoneSeries].filter(Boolean).join(':') || '—',
      object: object ?? '—',
      linesLabel: object ? SHORT_LINES[LINES_FOR_OBJECT[object][0]] : '—',
      number: doc?.type?.number ?? '—',
      docDate: doc?.date ?? '—',
      total: doc?.totals?.total == null ? null : Number(doc.totals.total),
      lines: d._count.items,
    };
  });

  const sum = rows.reduce((t, r) => t + (r.total ?? 0), 0);

  // Ομαδοποίηση ανά ημέρα ΑΝΑΡΤΗΣΗΣ — αυτό ρωτά ο λογιστής («τι έστειλα σήμερα;»).
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const k = r.postedAt ? dayKey(r.postedAt) : 'Χωρίς ημερομηνία';
    const list = groups.get(k);
    if (list) list.push(r); else groups.set(k, [r]);
  }

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title="Αναρτημένα στο SoftOne"
        description="Κάθε παραστατικό που στάλθηκε, με τον κωδικό που γύρισε το SoftOne και τον προορισμό του."
        icon={<FiUploadCloud />}
        helpAnchor="ocr-posted"
        actions={
          <Link
            href="/admin/ocr"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-[length:var(--fs-12)] font-medium hover:bg-muted"
          >
            Λίστα OCR <FiArrowRight className="size-3.5" />
          </Link>
        }
      />

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card py-16 text-center shadow-fluent-2">
          <FiInbox className="size-10 text-muted-foreground" />
          <p className="text-title-3 font-semibold text-foreground">Κανένα αναρτημένο παραστατικό</p>
          <p className="text-body-sm text-muted-foreground">Μόλις ανεβεί το πρώτο, θα εμφανιστεί εδώ.</p>
        </div>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-border bg-card px-3 py-2.5 shadow-fluent-2">
              <p className="text-[length:var(--fs-10)] font-bold uppercase tracking-wider text-muted-foreground">Παραστατικά</p>
              <p className="mt-0.5 text-title-2 font-bold tabular-nums text-foreground">{rows.length}</p>
            </div>
            <div className="rounded-lg border border-border bg-card px-3 py-2.5 shadow-fluent-2">
              <p className="text-[length:var(--fs-10)] font-bold uppercase tracking-wider text-muted-foreground">Συνολική αξία</p>
              <p className="mt-0.5 text-title-2 font-bold tabular-nums text-foreground">{eur(sum)}</p>
            </div>
            <div className="rounded-lg border border-border bg-card px-3 py-2.5 shadow-fluent-2">
              <p className="text-[length:var(--fs-10)] font-bold uppercase tracking-wider text-muted-foreground">Γραμμές</p>
              <p className="mt-0.5 text-title-2 font-bold tabular-nums text-foreground">{rows.reduce((t, r) => t + r.lines, 0)}</p>
            </div>
            <div className="rounded-lg border border-border bg-card px-3 py-2.5 shadow-fluent-2">
              <p className="text-[length:var(--fs-10)] font-bold uppercase tracking-wider text-muted-foreground">Ημέρες ανάρτησης</p>
              <p className="mt-0.5 text-title-2 font-bold tabular-nums text-foreground">{groups.size}</p>
            </div>
          </section>

          <div className="space-y-4">
            {Array.from(groups.entries()).map(([label, items]) => (
              <section key={label} className="overflow-hidden rounded-lg border border-border bg-card shadow-fluent-2">
                <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
                  <FiUploadCloud className="size-4 text-emerald-600" />
                  <span className="text-[length:var(--fs-13)] font-semibold text-foreground">{label}</span>
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[length:var(--fs-11)] font-semibold text-emerald-700 dark:text-emerald-300">
                    {items.length}
                  </span>
                  <span className="ml-auto text-[length:var(--fs-12)] font-semibold tabular-nums text-muted-foreground">
                    {eur(items.reduce((t, r) => t + (r.total ?? 0), 0))}
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-[length:var(--fs-12)]">
                    <thead className="bg-muted/20 text-[length:var(--fs-11)] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Κωδ. SoftOne</th>
                        <th className="px-3 py-2 text-left font-semibold">Εκδότης</th>
                        <th className="px-3 py-2 text-left font-semibold">Παραστατικό</th>
                        <th className="px-3 py-2 text-left font-semibold">Προορισμός</th>
                        <th className="px-3 py-2 text-right font-semibold">Γραμμές</th>
                        <th className="px-3 py-2 text-right font-semibold">Αξία</th>
                        <th className="px-3 py-2 text-left font-semibold">Ανάρτηση</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((r) => (
                        <tr key={r.id} className="border-t border-border/60 hover:bg-muted/30">
                          <td className="px-3 py-2">
                            <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 font-mono font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
                              {r.postedRef ?? '—'}
                            </span>
                          </td>
                          {/* Δύο πληροφορίες σε μία στήλη ⇒ ΔΥΟ γραμμές. Στη σειρά έμοιαζαν με μία
                              συμβολοσειρά («…ΕΤΑΙΡΕΙΑ999717970»), που δεν διαβάζεται. */}
                          <td className="px-3 py-2">
                            <div className="font-medium text-foreground">{r.supplier}</div>
                            <div className="font-mono text-[length:var(--fs-11)] text-muted-foreground">{r.afm}</div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="text-foreground">{r.number}</div>
                            <div className="text-[length:var(--fs-11)] text-muted-foreground">{r.docDate}</div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-mono text-[length:var(--fs-11)] text-foreground">{r.object}</div>
                            <div className="text-[length:var(--fs-11)] text-muted-foreground">
                              σειρά {r.series} · {r.linesLabel}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.lines}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums text-foreground">{eur(r.total)}</td>
                          <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">{day(r.postedAt)}</td>
                          <td className="px-3 py-2 text-right">
                            <Link
                              href={`/admin/ocr/${r.id}`}
                              title={r.fileName}
                              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[length:var(--fs-11)] font-medium hover:bg-muted"
                            >
                              Άνοιγμα <FiExternalLink className="size-3" />
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
