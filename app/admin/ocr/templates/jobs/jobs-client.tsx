'use client';

// Η λίστα των εργασιών σάρωσης. Ανανεώνεται μόνη της ΜΟΝΟ όσο υπάρχει κάτι ενεργό: μια σελίδα με
// δέκα τελειωμένες εργασίες δεν έχει λόγο να χτυπά τον server κάθε πέντε δευτερόλεπτα.

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FiDownload, FiExternalLink, FiSearch, FiSlash } from 'react-icons/fi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { JOB_STATUS_LABEL, JOB_STATUS_STYLE } from '@/lib/templates/labels';
import { isActive } from '@/lib/templates/jobs-logic';
import { templatesApi, errorMessage, type JobListRow } from '@/components/templates/api';

const REFRESH_MS = 5000;

export const JobPill = ({ status }: { status: keyof typeof JOB_STATUS_LABEL }) => (
  <span className="inline-flex rounded-full px-2 py-0.5 text-[length:var(--fs-10)] font-semibold" style={JOB_STATUS_STYLE[status] && { backgroundColor: JOB_STATUS_STYLE[status].bg, color: JOB_STATUS_STYLE[status].fg }}>
    {JOB_STATUS_LABEL[status] ?? status}
  </span>
);

/** Η μπάρα προόδου: γεμάτη με ό,τι διαβάστηκε, με το κόκκινο κομμάτι να είναι τα αποτυχημένα. */
export function JobProgressBar({ job }: { job: Pick<JobListRow, 'progress'> }) {
  const { total, done, failed, pct } = job.progress;
  const donePct = total ? (done / total) * 100 : 0;
  const failPct = total ? (failed / total) * 100 : 0;
  return (
    <div className="min-w-[110px]">
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div style={{ width: `${donePct}%`, backgroundColor: '#047857' }} />
        <div style={{ width: `${failPct}%`, backgroundColor: '#B91C1C' }} />
      </div>
      <div className="mt-0.5 text-[length:var(--fs-10)] tabular-nums text-muted-foreground">
        {done}/{total}{failed > 0 && <span className="text-dg-red-600"> · {failed} σφάλμα</span>}
      </div>
    </div>
  );
}

export function JobsClient({ initial, canManage }: { initial: JobListRow[]; canManage: boolean }) {
  const router = useRouter();
  const [jobs, setJobs] = React.useState(initial);
  const [q, setQ] = React.useState('');

  const anyActive = jobs.some((j) => isActive(j.status));

  React.useEffect(() => {
    if (!anyActive) return;
    let cancelled = false;
    const id = setInterval(() => {
      templatesApi.jobs.list({})
        .then(({ jobs: fresh }) => { if (!cancelled) setJobs(fresh); })
        .catch(() => { /* η ανανέωση είναι διακόσμηση — ένα δίκτυο που έπεσε δεν αδειάζει τη λίστα */ });
    }, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [anyActive]);

  const cancel = async (j: JobListRow) => {
    if (!confirm(`Ακύρωση της εργασίας «${j.title}»;\nΌσα αρχεία διαβάστηκαν μένουν — τα υπόλοιπα δεν θα ξεκινήσουν.`)) return;
    try {
      const out = await templatesApi.jobs.cancel(j.id);
      toast.success(out.pending ? `Ακυρώθηκε — ${out.pending} αρχεία δεν θα διαβαστούν` : 'Ακυρώθηκε');
      setJobs((prev) => prev.map((x) => (x.id === j.id ? { ...x, status: 'CANCELLED' } : x)));
      router.refresh();
    } catch (e) { toast.error(errorMessage(e)); }
  };

  const needle = q.trim().toLowerCase();
  const shown = needle
    ? jobs.filter((j) => [j.title, j.reference, j.templateName].some((s) => (s ?? '').toLowerCase().includes(needle)))
    : jobs;

  return (
    <div className="w-full">
      <div className="mb-3 flex items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <FiSearch className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Αναζήτηση (τίτλος, σήμανση, πρότυπο…)" className="pl-8" aria-label="Αναζήτηση εργασιών" />
        </div>
        {anyActive && <span className="text-[length:var(--fs-11)] text-muted-foreground">Ανανέωση κάθε 5 δευτ.</span>}
      </div>

      {shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-[length:var(--fs-13)] text-muted-foreground">
          {jobs.length === 0
            ? 'Καμία εργασία ακόμη. Άνοιξε ένα πρότυπο και διάλεξε «Σάρωση αρχείων».'
            : 'Καμία εργασία δεν ταιριάζει στην αναζήτηση.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-card">
          <table className="w-full text-[length:var(--fs-13)]">
            <thead className="bg-muted/40 text-left text-[length:var(--fs-11)] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Εργασία</th>
                <th className="px-3 py-2 font-medium">Πρότυπο</th>
                <th className="px-3 py-2 font-medium">Πρόοδος</th>
                <th className="px-3 py-2 font-medium">Κατάσταση</th>
                <th className="px-3 py-2 font-medium">Ημερομηνία</th>
                <th className="w-1 px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {shown.map((j) => (
                <tr key={j.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <Link href={`/admin/ocr/templates/jobs/${j.id}`} className="font-medium text-sisyphus-700 hover:underline">{j.title}</Link>
                    {j.reference && (
                      <span className="ml-1.5 inline-flex rounded px-1.5 py-0.5 font-mono text-[length:var(--fs-10)]" style={{ backgroundColor: '#F3F2F1', color: '#5C5C5C' }}>{j.reference}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{j.templateName}</td>
                  <td className="px-3 py-2"><JobProgressBar job={j} /></td>
                  <td className="px-3 py-2"><JobPill status={j.status} /></td>
                  <td className="px-3 py-2 text-[length:var(--fs-11)] tabular-nums text-muted-foreground">{new Date(j.date).toLocaleDateString('el-GR')}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      {j.done > 0 && (
                        <a href={templatesApi.jobs.excelUrl(j.id)} title="Excel" aria-label={`Excel της εργασίας ${j.title}`} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                          <FiDownload className="size-3.5" />
                        </a>
                      )}
                      {canManage && isActive(j.status) && (
                        <button type="button" onClick={() => cancel(j)} title="Ακύρωση" aria-label={`Ακύρωση της εργασίας ${j.title}`} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-dg-red-600">
                          <FiSlash className="size-3.5" />
                        </button>
                      )}
                      <Link href={`/admin/ocr/templates/jobs/${j.id}`} title="Άνοιγμα" aria-label={`Άνοιγμα της εργασίας ${j.title}`} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                        <FiExternalLink className="size-3.5" />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-[length:var(--fs-11)] text-muted-foreground">
        Οι εργασίες τρέχουν μέσα στον server και συνεχίζουν ακόμη κι αν κλείσεις τη σελίδα.
        <Button asChild variant="ghost" size="sm" className="ml-1 h-auto px-1 py-0 text-[length:var(--fs-11)]">
          <Link href="/admin/ocr/templates">Πρότυπα εξαγωγής</Link>
        </Button>
      </p>
    </div>
  );
}
