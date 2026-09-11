'use client';

// Η καρτέλα μιας εργασίας σάρωσης (spec §12): κεφαλίδα με ό,τι δήλωσε ο χρήστης, πίνακας αρχεία ×
// πεδία με τα χρώματα του προτύπου, και πλαϊνό πάνελ με τη σελίδα του αρχείου και τα κουτιά που
// διαβάστηκαν. Polling μόνο όσο η εργασία κινείται — μόλις τελειώσει, η σελίδα ησυχάζει.

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FiAlertTriangle, FiArrowLeft, FiDownload, FiSlash, FiX } from 'react-icons/fi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { RegionMarker } from '@/components/ui/region-marker';
import { JOB_ITEM_STATUS_LABEL } from '@/lib/templates/labels';
import { isActive } from '@/lib/templates/jobs-logic';
import { formatValue } from '@/lib/templates/run-view';
import { isValidBbox } from '@/lib/templates/schema';
import { templatesApi, errorMessage, type JobDetail } from '@/components/templates/api';
import { JobPill, JobProgressBar } from '../jobs-client';

const POLL_MS = 2000;
const EMPTY = '—';

type Item = JobDetail['items'][number];

/** Το κελί μιας τιμής: το χρώμα του πεδίου το ΔΕΝΕΙ με το κουτί που το παρήγαγε στο πλαϊνό πάνελ. */
function ValueCell({ item, field }: { item: Item; field: JobDetail['fields'][number] }) {
  const v = item.values?.[field.key];
  if (item.status !== 'DONE') return <span className="text-muted-foreground">{EMPTY}</span>;
  const flag = item.flags?.fields?.[field.key];
  const text = v ? formatValue(v.value, field.valueType) : EMPTY;
  return (
    <span
      className="inline-flex max-w-[240px] items-center gap-1 truncate"
      style={{ color: flag === 'blocked' ? '#B91C1C' : flag === 'review' ? '#B45309' : undefined }}
      title={flag ? 'Το πεδίο θέλει έλεγχο' : undefined}
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: field.color }} aria-hidden />
      <span className="truncate">{text}</span>
    </span>
  );
}

export function JobDetailClient({ initial, canManage }: { initial: JobDetail; canManage: boolean }) {
  const router = useRouter();
  const [job, setJob] = React.useState(initial);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [page, setPage] = React.useState(0);

  const active = isActive(job.status);

  React.useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const id = setInterval(() => {
      templatesApi.jobs.get(job.id)
        .then(({ job: fresh }) => { if (!cancelled) setJob(fresh); })
        .catch(() => { /* το polling είναι διακόσμηση· μια αποτυχία δεν αδειάζει τη σελίδα */ });
    }, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [active, job.id]);

  const cancel = async () => {
    if (!confirm('Ακύρωση της εργασίας;\nΌσα αρχεία διαβάστηκαν μένουν — τα υπόλοιπα δεν θα ξεκινήσουν.')) return;
    try {
      const out = await templatesApi.jobs.cancel(job.id);
      toast.success(out.pending ? `Ακυρώθηκε — ${out.pending} αρχεία δεν θα διαβαστούν` : 'Ακυρώθηκε');
      const { job: fresh } = await templatesApi.jobs.get(job.id);
      setJob(fresh);
      router.refresh();
    } catch (e) { toast.error(errorMessage(e)); }
  };

  const open = job.items.find((i) => i.id === openId) ?? null;
  // Τα κουτιά του ΑΝΟΙΧΤΟΥ αρχείου, στη σελίδα που κοιτά ο χρήστης — ίδια χρώματα με τη στήλη τους.
  const regions = React.useMemo(() => {
    if (!open?.values) return [];
    return job.fields
      .map((f) => ({ f, v: open.values?.[f.key] }))
      .filter((x) => x.v && x.v.page === page && isValidBbox(x.v.bbox))
      .map((x) => ({ bbox: x.v!.bbox as [number, number, number, number], color: x.f.color, label: x.f.label }));
  }, [open, job.fields, page]);

  // Το αρχείο που άνοιξε μπορεί να έχει λιγότερες σελίδες από το προηγούμενο.
  React.useEffect(() => { setPage(0); }, [openId]);

  const dateText = new Date(job.date).toLocaleDateString('el-GR');

  return (
    <div className="w-full">
      {/* Η ζωντανή μπάρα: κατάσταση, πρόοδος και οι ενέργειες που εξαρτώνται από αυτήν. Η κεφαλίδα
          της σελίδας (τίτλος + βοήθεια) μένει στον server — βλ. page.tsx. */}
      <div className="mb-3 flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card px-4 py-3 shadow-card">
        <JobPill status={job.status} />
        <JobProgressBar job={job} />
        {job.reference && (
          <div className="text-[12px]"><span className="text-muted-foreground">Σήμανση: </span><span className="font-mono">{job.reference}</span></div>
        )}
        <div className="text-[12px]"><span className="text-muted-foreground">Ημερομηνία: </span>{dateText}</div>
        <div className="ml-auto flex items-center gap-1">
          {active && <span className="mr-2 text-[11px] text-muted-foreground">Ανανέωση κάθε 2 δευτ.</span>}
          {job.done > 0 && (
            <Button asChild size="sm" variant="ghost">
              <a href={templatesApi.jobs.excelUrl(job.id)}><FiDownload className="mr-1.5 size-3.5" /> Excel</a>
            </Button>
          )}
          {canManage && active && (
            <Button size="sm" variant="ghost" className="text-dg-red-600" onClick={cancel}>
              <FiSlash className="mr-1.5 size-3.5" /> Ακύρωση
            </Button>
          )}
          <Button asChild size="sm" variant="ghost">
            <Link href="/admin/ocr/templates/jobs"><FiArrowLeft className="mr-1.5 size-3.5" /> Εργασίες</Link>
          </Button>
        </div>
        {job.description && <p className="w-full text-[12px] text-muted-foreground">{job.description}</p>}
      </div>

      <div className={open ? 'grid gap-3 lg:grid-cols-[minmax(0,1fr)_420px]' : ''}>
        <div className="min-w-0 overflow-x-auto rounded-xl border border-border bg-card shadow-card">
          <table className="w-full text-[12px]">
            <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Αρχείο</th>
                <th className="px-3 py-2 font-medium">Κατάσταση</th>
                {job.fields.map((f) => (
                  <th key={f.key} className="whitespace-nowrap px-3 py-2 font-medium">
                    <span className="mr-1 inline-block size-1.5 rounded-full align-middle" style={{ backgroundColor: f.color }} aria-hidden />
                    {f.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {job.items.map((i) => (
                <tr
                  key={i.id}
                  onClick={() => setOpenId(openId === i.id ? null : i.id)}
                  className={`cursor-pointer border-t border-border hover:bg-muted/30 ${openId === i.id ? 'bg-muted/40' : ''}`}
                >
                  <td className="max-w-[220px] px-3 py-2">
                    <div className="truncate font-medium">{i.fileName}</div>
                    {i.error && (
                      <div className="flex items-center gap-1 truncate text-[10px] text-dg-red-600" title={i.error}>
                        <FiAlertTriangle className="size-3 shrink-0" aria-hidden /> {i.error}
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{JOB_ITEM_STATUS_LABEL[i.status] ?? i.status}</td>
                  {job.fields.map((f) => (
                    <td key={f.key} className="px-3 py-2"><ValueCell item={i} field={f} /></td>
                  ))}
                </tr>
              ))}
              {job.items.length === 0 && (
                <tr><td colSpan={2 + job.fields.length} className="px-3 py-8 text-center text-muted-foreground">Η εργασία δεν έχει αρχεία.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {open && (
          <aside className="rounded-xl border border-border bg-card p-3 shadow-card">
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium">{open.fileName}</p>
                <p className="text-[11px] text-muted-foreground">
                  {JOB_ITEM_STATUS_LABEL[open.status] ?? open.status}
                  {open.model && ` · ${open.model}`}
                  {open.durationMs != null && ` · ${(open.durationMs / 1000).toFixed(1)} δ`}
                </p>
              </div>
              <button type="button" aria-label="Κλείσιμο" onClick={() => setOpenId(null)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                <FiX className="size-3.5" />
              </button>
            </div>
            <RegionMarker
              pageImageUrl={(p) => templatesApi.jobs.pageImageUrl(job.id, open.id, p)}
              pageCount={open.page ?? 1}
              page={page}
              onPageChange={setPage}
              savedRegions={regions}
              isMarking={false}
              onRegionComplete={() => { /* read-only */ }}
              pageLabel={`${open.fileName}, σελίδα ${page + 1}`}
            />
            {open.flags?.review?.length ? (
              <ul className="mt-2 space-y-0.5 text-[11px] text-amber-700">
                {open.flags.review.map((r) => <li key={r}>· {r}</li>)}
              </ul>
            ) : null}
          </aside>
        )}
      </div>
    </div>
  );
}
