'use client';

// Τα σκαναρισμένα παραστατικά ενός συναλλασσομένου — μέσα στην ανάπτυξη της γραμμής του μητρώου.
// Φορτώνει μόνο όταν ανοίξει (λίστα συναλλασσομένων με χιλιάδες γραμμές).
import * as React from 'react';
import Link from 'next/link';
import { FiAlertTriangle, FiExternalLink, FiFileText, FiLink2 } from 'react-icons/fi';
import { reconMeta } from '@/lib/ocr/recon-status';
import type { TraderDocRow } from '@/lib/ocr/trader-docs';

const money = (n: number | null) => (n == null ? '—' : n.toLocaleString('el-GR', { style: 'currency', currency: 'EUR' }));
const dateOf = (s: string | null, fallback: string) => {
  const v = s ?? fallback;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
};

export function TraderDocsPanel({ trdr, count }: { trdr: number; count: number }) {
  const [docs, setDocs] = React.useState<TraderDocRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    let ignore = false;
    fetch(`/api/admin/traders/${trdr}/documents`, { cache: 'no-store' })
      .then(async (r) => { const d = await r.json().catch(() => null); if (ignore) return; if (!r.ok) setError(d?.error ?? `HTTP ${r.status}`); else setDocs(d.docs); })
      .catch(() => { if (!ignore) setError('Σφάλμα δικτύου'); });
    return () => { ignore = true; };
  }, [trdr]);

  if (error) return <p className="flex items-center gap-1.5 px-3 py-2 text-[length:var(--fs-12)] text-destructive"><FiAlertTriangle className="size-3.5" /> {error}</p>;
  if (!docs) {
    return (
      <div className="space-y-1 px-3 py-2" role="status"><span className="sr-only">Φόρτωση παραστατικών…</span>
        {Array.from({ length: Math.min(count || 2, 4) }).map((_, i) => <div key={i} className="h-6 animate-pulse rounded bg-muted motion-reduce:animate-none" />)}
      </div>
    );
  }
  if (docs.length === 0) return <p className="px-3 py-2 text-[length:var(--fs-12)] text-muted-foreground">Δεν υπάρχουν σκαναρισμένα παραστατικά από αυτόν.</p>;

  const sum = docs.reduce((s, d) => s + (d.total ?? 0), 0);
  return (
    <div className="px-3 py-2">
      <p className="mb-1.5 flex items-center gap-2 text-[length:var(--fs-11)] font-semibold uppercase tracking-wide text-sisyphus-700 dark:text-sisyphus-300">
        <FiFileText aria-hidden className="size-3.5" /> Σκαναρισμένα παραστατικά · {docs.length}
        <span className="ml-auto font-normal normal-case tracking-normal text-muted-foreground">Σύνολο <strong className="tabular-nums text-foreground">{money(sum)}</strong></span>
      </p>
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <table className="w-full table-fixed text-[length:var(--fs-12)]">
          <thead className="bg-muted/50 text-[length:var(--fs-10)] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-[38%] px-2 py-1.5 text-left font-semibold">Αρχείο</th>
              <th className="px-2 py-1.5 text-left font-semibold">Αριθμός</th>
              <th className="w-24 px-2 py-1.5 text-left font-semibold">Ημ/νία</th>
              <th className="w-28 px-2 py-1.5 text-right font-semibold">Σύνολο</th>
              <th className="w-40 px-2 py-1.5 text-left font-semibold">Κατάσταση</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {docs.map((d) => {
              const m = reconMeta(d);
              return (
                <tr key={d.id} className="hover:bg-muted/40">
                  <td className="truncate px-2 py-1">
                    <Link href={`/admin/ocr/${d.id}`} className="inline-flex max-w-full items-center gap-1 font-medium text-sisyphus-700 hover:underline dark:text-sisyphus-300" title={d.fileName}>
                      <span className="truncate">{d.fileName}</span><FiExternalLink aria-hidden className="size-3 shrink-0 opacity-60" />
                    </Link>
                    {!d.linked && <span className="ml-1.5 inline-flex items-center gap-0.5 text-[length:var(--fs-10)] text-amber-800 dark:text-amber-300" title="Ίδιος ΑΦΜ, δεν έχει συνδεθεί ακόμη με την καρτέλα"><FiLink2 className="size-3" /> ίδιο ΑΦΜ</span>}
                  </td>
                  <td className="truncate px-2 py-1 font-mono tabular-nums">{d.number ?? '—'}</td>
                  <td className="px-2 py-1 tabular-nums text-muted-foreground">{dateOf(d.date, d.createdAt)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{money(d.total)}</td>
                  <td className="px-2 py-1">
                    <span className="inline-flex max-w-full truncate rounded-full border px-1.5 py-0.5 text-[length:var(--fs-10)] font-semibold" style={{ backgroundColor: m.tone.bg, color: m.tone.fg, borderColor: m.tone.bd }}>{m.label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
