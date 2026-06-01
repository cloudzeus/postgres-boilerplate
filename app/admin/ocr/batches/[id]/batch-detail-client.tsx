'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FiZap, FiCheckCircle, FiTruck, FiBox, FiTool, FiExternalLink } from 'react-icons/fi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

type Row = {
  id: string; fileName: string; status: string; invoiceKind: string | null;
  supplierName: string | null; supplierCode: string | null; supplierKind: string | null;
  supplierChecked: boolean; supplierFound: boolean;
  duplicate: boolean; duplicateRef: string | null;
  totalLines: number; matchedLines: number;
};

export function BatchDetailClient({ batchId, rows }: { batchId: string; rows: Row[] }) {
  const router = useRouter();
  const [running, setRunning] = React.useState(false);
  const [progress, setProgress] = React.useState(0);

  const kpi = {
    total: rows.length,
    completed: rows.filter((r) => r.status === 'COMPLETED').length,
    suppliers: rows.filter((r) => r.supplierFound).length,
    duplicates: rows.filter((r) => r.duplicate).length,
    linesMatched: rows.reduce((a, r) => a + r.matchedLines, 0),
    linesTotal: rows.reduce((a, r) => a + r.totalLines, 0),
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

      {/* Docs table */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/80 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-semibold">Αρχείο</th>
              <th className="px-4 py-2 text-left font-semibold w-[110px]">OCR</th>
              <th className="px-4 py-2 text-left font-semibold w-[130px]">Τύπος</th>
              <th className="px-4 py-2 text-left font-semibold w-[240px]">Προμηθευτής</th>
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
        Όσα δεν βρέθηκαν → <Link href="/admin/ocr/matching" className="text-[#0078D4] hover:underline">Αντιστοιχίσεις SoftOne</Link> για χειροκίνητη ταύτιση.
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
