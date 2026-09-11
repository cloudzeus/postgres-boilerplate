'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FiZap, FiCheckCircle, FiTruck, FiBox, FiTool, FiExternalLink, FiDownload, FiCode } from 'react-icons/fi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { RunStatusPill } from '@/components/templates/run-status-pill';
import type { RunStatus } from '@/lib/templates/schema';

type Row = {
  id: string; fileName: string; status: string; invoiceKind: string | null;
  supplierName: string | null; supplierCode: string | null; supplierKind: string | null;
  supplierChecked: boolean; supplierFound: boolean;
  duplicate: boolean; duplicateRef: string | null;
  totalLines: number; matchedLines: number;
  /** Latest template run, cached on OcrDocument.reviewFlags by the runner (spec §15.7). */
  templateName: string | null; templateRunStatus: RunStatus | null;
};

/** The folder exports 404 when no document of the folder has a usable run — say so up front. */
const NO_RUNS_HINT = 'Δεν έχει τρέξει πρότυπο σε κανένα παραστατικό του φακέλου';

export function BatchDetailClient({ batchId, rows }: { batchId: string; rows: Row[] }) {
  const router = useRouter();
  const [running, setRunning] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [reading, setReading] = React.useState(false);
  const [readProgress, setReadProgress] = React.useState(0);
  // FAILED runs stored no values and the export routes skip them, so a folder whose only runs failed
  // has nothing to export — offering the buttons would just hand the user a 404.
  const hasRuns = rows.some((r) => r.templateRunStatus != null && r.templateRunStatus !== 'FAILED');

  // Παιδιά ενός διαχωρισμένου PDF που δεν πρόλαβαν να διαβαστούν (κλειστή καρτέλα, πεσμένο δίκτυο)
  // ή που απέτυχαν. Μένουν εδώ μέχρι κάποιος να τα διαβάσει — δεν χάνονται, αλλά πρέπει να φαίνονται.
  const unread = rows.filter((r) => r.status === 'PENDING' || r.status === 'FAILED');

  const kpi = {
    total: rows.length,
    completed: rows.filter((r) => r.status === 'COMPLETED').length,
    suppliers: rows.filter((r) => r.supplierFound).length,
    duplicates: rows.filter((r) => r.duplicate).length,
    linesMatched: rows.reduce((a, r) => a + r.matchedLines, 0),
    linesTotal: rows.reduce((a, r) => a + r.totalLines, 0),
  };

  /**
   * Διαβάζει ΟΛΑ τα αδιάβαστα παιδιά, ένα-ένα, με τη ΦΘΗΝΗ διαδρομή (`/extract`, το κανονικό
   * μοντέλο του ανεβάσματος) — όχι με το «Επανασκανάρισμα», που ανεβάζει σε gemini-2.5-pro.
   * Σειριακά και όχι παράλληλα: κάθε ανάγνωση είναι μια ακριβή κλήση, και η σειρά κρατάει το
   * κόστος προβλέψιμο αν ο χρήστης αλλάξει γνώμη στη μέση.
   */
  const readPending = async () => {
    if (unread.length === 0) return;
    setReading(true); setReadProgress(0);
    let done = 0, errors = 0;
    for (const row of unread) {
      try {
        const res = await fetch(`/api/admin/ocr/${row.id}/extract`, { method: 'POST' });
        if (!res.ok) errors += 1;
      } catch { errors += 1; }
      done += 1;
      setReadProgress(Math.round((done / unread.length) * 100));
    }
    setReading(false);
    if (errors > 0) toast.warning(`Ολοκληρώθηκε με ${errors} αποτυχίες`);
    else toast.success('Όλα τα παραστατικά διαβάστηκαν');
    router.refresh();
  };

  // Run correlation across all completed docs (concurrency 3).
  const runAll = async () => {
    const targets = rows.filter((r) => r.status === 'COMPLETED');
    if (targets.length === 0) { toast.info('Δεν υπάρχουν ολοκληρωμένα παραστατικά'); return; }
    setRunning(true); setProgress(0);
    let cursor = 0, done = 0;
    const worker = async () => {
      while (cursor < targets.length) {
        const t = targets[cursor++];
        try { await fetch(`/api/admin/ocr/${t.id}/correlate`, { method: 'POST' }); } catch { /* ignore */ }
        done++; setProgress(Math.round((done / targets.length) * 100));
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, targets.length) }, worker));
    setRunning(false);
    toast.success('Οι αντιστοιχίσεις ολοκληρώθηκαν');
    router.refresh();
  };

  return (
    <div className="space-y-4">
      {unread.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-[13px] font-medium text-amber-900 dark:text-amber-200">
          <span>
            {unread.length === 1
              ? '1 παραστατικό δεν έχει διαβαστεί ακόμη'
              : `${unread.length} παραστατικά δεν έχουν διαβαστεί ακόμη`}
            {' '}— η ανάγνωση γίνεται με το κανονικό (φθηνό) μοντέλο.
          </span>
          <Button size="sm" onClick={readPending} disabled={reading}>
            <FiZap className="mr-1.5 h-3.5 w-3.5" />
            {reading ? `Ανάγνωση… ${readProgress}%` : `Διάβασε τα υπόλοιπα (${unread.length})`}
          </Button>
        </div>
      )}
      {kpi.duplicates > 0 && (
        <div className="flex items-center gap-2 rounded-lg border px-4 py-2.5 text-[13px] font-medium"
          style={{ background: '#FEF2F2', borderColor: '#FECACA', color: '#B91C1C' }}>
          ⚠ {kpi.duplicates} {kpi.duplicates === 1 ? 'παραστατικό υπάρχει ήδη' : 'παραστατικά υπάρχουν ήδη'} στο SoftOne — έλεγξε πριν την καταχώριση.
        </div>
      )}
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Παραστατικά" value={`${kpi.completed}/${kpi.total}`} hint="ολοκληρωμένα" />
        <Kpi label="Προμηθευτές" value={`${kpi.suppliers}/${kpi.total}`} hint="ταυτοποιήθηκαν" accent="#047857" />
        <Kpi label="Γραμμές" value={`${kpi.linesMatched}/${kpi.linesTotal}`} hint="αντιστοιχίστηκαν" accent="#1D4ED8" />
        <div className="rounded-xl border border-border bg-card p-3 shadow-card flex flex-col justify-between">
          <span className="text-[11px] text-muted-foreground">Αντιστοιχίσεις</span>
          <Button size="sm" onClick={runAll} disabled={running} className="mt-1">
            <FiZap className="mr-1.5 h-3.5 w-3.5" /> {running ? `Εκτέλεση… ${progress}%` : 'Τρέξε όλες'}
          </Button>
        </div>
      </div>

      {/* Template exports for the whole folder — one Excel with a sheet per template, or a JSON array. */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {hasRuns ? (
          <>
            <Button size="sm" variant="outline" asChild>
              <a href={`/api/admin/ocr/batches/${batchId}/template-excel`}>
                <FiDownload className="mr-1.5 h-3.5 w-3.5" /> Excel προτύπων
              </a>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href={`/api/admin/ocr/batches/${batchId}/template-json?download=1`}>
                <FiCode className="mr-1.5 h-3.5 w-3.5" /> JSON
              </a>
            </Button>
          </>
        ) : (
          <>
            {/* A disabled button never fires the pointer events a tooltip needs, so the reason is written out. */}
            <span className="text-[11px] text-muted-foreground">{NO_RUNS_HINT}</span>
            <Button size="sm" variant="outline" disabled>
              <FiDownload className="mr-1.5 h-3.5 w-3.5" /> Excel προτύπων
            </Button>
            <Button size="sm" variant="outline" disabled>
              <FiCode className="mr-1.5 h-3.5 w-3.5" /> JSON
            </Button>
          </>
        )}
      </div>

      {/* Docs table */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/80 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-semibold">Αρχείο</th>
              <th className="px-4 py-2 text-left font-semibold w-[110px]">OCR</th>
              <th className="px-4 py-2 text-left font-semibold w-[130px]">Τύπος</th>
              <th className="px-4 py-2 text-left font-semibold w-[240px]">Προμηθευτής</th>
              <th className="px-4 py-2 text-left font-semibold w-[180px]">Πρότυπο</th>
              <th className="px-4 py-2 text-left font-semibold w-[120px]">Γραμμές</th>
              <th className="px-4 py-2 w-[48px]" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border/60 hover:bg-muted/30">
                <td className="px-4 py-2.5 max-w-[260px]">
                  <span className="font-medium text-foreground truncate block">{r.fileName}</span>
                  {r.duplicate && (
                    <span className="mt-0.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                      style={{ background: '#FEF2F2', color: '#B91C1C' }} title={`Υπάρχει ήδη: ${r.duplicateRef ?? ''}`}>
                      ⚠ ΔΙΠΛΟ{r.duplicateRef ? ` · ${r.duplicateRef}` : ''}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {r.status === 'COMPLETED'
                    ? <span className="inline-flex items-center gap-1 text-emerald-600"><FiCheckCircle className="h-3.5 w-3.5" /> OK</span>
                    : <span className="text-[12px] text-muted-foreground">{r.status}</span>}
                </td>
                <td className="px-4 py-2.5">{kindBadge(r.invoiceKind)}</td>
                <td className="px-4 py-2.5">{supplierCell(r)}</td>
                <td className="px-4 py-2.5">{templateCell(r)}</td>
                <td className="px-4 py-2.5 text-[12px] tabular-nums text-muted-foreground">
                  {r.totalLines > 0 ? `${r.matchedLines}/${r.totalLines}` : '—'}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Link href={`/admin/ocr/${r.id}`} className="text-muted-foreground hover:text-foreground"><FiExternalLink className="ml-auto h-4 w-4" /></Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Όσα δεν βρέθηκαν → <Link href="/admin/ocr/new-items" className="text-[#0078D4] hover:underline">Είδη & έξοδα</Link> για χειροκίνητη ταύτιση.
      </p>
    </div>
  );
}

function Kpi({ label, value, hint, accent = 'currentColor' }: { label: string; value: string; hint: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-card">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-xl font-bold tabular-nums" style={{ color: accent }}>{value}</p>
      <p className="text-[10px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function kindBadge(kind: string | null) {
  if (!kind || kind === 'unknown') return <span className="text-muted-foreground/50">—</span>;
  const map: Record<string, { label: string; icon: React.ReactNode; bg: string; fg: string }> = {
    service: { label: 'Υπηρεσιών', icon: <FiTool className="h-3 w-3" />, bg: '#FFF1E6', fg: '#C2410C' },
    product: { label: 'Προϊόντων', icon: <FiBox className="h-3 w-3" />, bg: '#ECFDF5', fg: '#047857' },
    mixed: { label: 'Μικτό', icon: <FiBox className="h-3 w-3" />, bg: '#EAF2FF', fg: '#1D4ED8' },
  };
  const s = map[kind] ?? map.mixed;
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: s.bg, color: s.fg }}>
      {s.icon} {s.label}
    </span>
  );
}

function templateCell(r: Row) {
  if (!r.templateRunStatus) return <span className="text-muted-foreground/50">—</span>;
  return (
    <div className="flex flex-col items-start gap-0.5">
      <span className="max-w-[160px] truncate text-[12px] font-medium" title={r.templateName ?? undefined}>
        {r.templateName ?? '—'}
      </span>
      <RunStatusPill status={r.templateRunStatus} />
    </div>
  );
}

function supplierCell(r: Row) {
  if (r.supplierFound) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <FiTruck className="h-3.5 w-3.5 text-emerald-600" />
        <span className="truncate">{r.supplierName}</span>
        <span className="font-mono text-[11px] text-muted-foreground">#{r.supplierCode}</span>
      </span>
    );
  }
  if (r.supplierChecked) return <span className="text-[12px]" style={{ color: '#B45309' }}>Δεν βρέθηκε</span>;
  return <span className="text-muted-foreground/50">—</span>;
}
