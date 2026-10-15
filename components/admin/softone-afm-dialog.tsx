'use client';

import * as React from 'react';
import { FiCheckCircle, FiXCircle, FiUserCheck, FiTruck, FiSearch, FiAlertTriangle } from 'react-icons/fi';
import { FormSection, type SectionTone } from '@/components/admin/form-kit';
import { cn } from '@/lib/utils';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';

type Trdr = {
  trdr: number; code: string; name: string; kind: string | null; afm: string | null;
  doy: string | null; city: string | null; phone: string | null; email: string | null;
};
type LookupResult = { afm: string; customers: Trdr[]; suppliers: Trdr[] };

export function SoftoneAfmDialog({
  afm,
  contextLabel,
  onClose,
}: {
  afm: string | null;
  contextLabel?: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<LookupResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!afm) return;
    let cancelled = false;
    setLoading(true); setResult(null); setError(null);
    (async () => {
      try {
        const res = await fetch('/api/admin/softone/lookup-afm', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ afm }),
        });
        const d = await res.json();
        if (cancelled) return;
        if (!res.ok) setError(d.error === 'softone_error' ? (d.message ?? 'Σφάλμα SoftOne') : 'Αποτυχία ελέγχου');
        else setResult(d);
      } catch {
        if (!cancelled) setError('Σφάλμα δικτύου');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [afm]);

  const found = !!result && (result.customers.length > 0 || result.suppliers.length > 0);

  return (
    <Dialog open={afm != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[95vw] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="flex-row items-center gap-3 border-b border-border px-4 py-2.5 pr-12">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-sisyphus-50 text-sisyphus-600 dark:bg-sisyphus-500/15"><FiSearch className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[length:var(--fs-15)]">Έλεγχος ΑΦΜ στο SoftOne</DialogTitle>
            <DialogDescription className="truncate text-[length:var(--fs-11)]">
              ΑΦΜ <span className="font-mono font-medium text-foreground">{afm}</span>
              {contextLabel ? ` · ${contextLabel}` : ''}
            </DialogDescription>
          </div>
          {result && (
            <div className="hidden shrink-0 flex-wrap justify-end gap-1.5 sm:flex">
              <StatusPill ok={result.suppliers.length > 0} icon={<FiTruck className="size-3.5" />}
                label={result.suppliers.length > 0 ? `Προμηθευτής (${result.suppliers.length})` : 'Όχι προμηθευτής'} />
              <StatusPill ok={result.customers.length > 0} icon={<FiUserCheck className="size-3.5" />}
                label={result.customers.length > 0 ? `Πελάτης (${result.customers.length})` : 'Όχι πελάτης'} />
            </div>
          )}
        </DialogHeader>

        <div className="max-h-[66vh] space-y-3 overflow-auto bg-muted/20 px-4 py-3">
          {loading && <div role="status" className="py-8 text-center text-[length:var(--fs-13)] text-muted-foreground">Έλεγχος…</div>}
          {error && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[length:var(--fs-13)] text-destructive">{error}</div>}

          {result && (
            <>
              {/* Σύνοψη — σε στενή οθόνη εδώ· από sm και πάνω στην κεφαλίδα. */}
              <div className="flex flex-wrap gap-1.5 sm:hidden">
                <StatusPill ok={result.suppliers.length > 0} icon={<FiTruck className="size-3.5" />}
                  label={result.suppliers.length > 0 ? `Προμηθευτής (${result.suppliers.length})` : 'Όχι προμηθευτής'} />
                <StatusPill ok={result.customers.length > 0} icon={<FiUserCheck className="size-3.5" />}
                  label={result.customers.length > 0 ? `Πελάτης (${result.customers.length})` : 'Όχι πελάτης'} />
              </div>

              {!found && (
                <div className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-50/70 px-3 py-2 text-[length:var(--fs-13)] text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                  <FiAlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                  Δεν βρέθηκε καταχωρημένος στο SoftOne (ούτε ως πελάτης ούτε ως προμηθευτής).
                </div>
              )}

              {result.suppliers.length > 0 && <MatchGroup tone="emerald" icon={<FiTruck />} title="Προμηθευτές" rows={result.suppliers} />}
              {result.customers.length > 0 && <MatchGroup tone="violet" icon={<FiUserCheck />} title="Πελάτες" rows={result.customers} />}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StatusPill({ ok, label, icon }: { ok: boolean; label: string; icon: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[length:var(--fs-11)] font-medium',
        ok
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
          : 'border-border bg-muted text-muted-foreground',
      )}
    >
      {ok ? <FiCheckCircle className="size-3.5" /> : <FiXCircle className="size-3.5" />}
      {icon}
      {label}
    </span>
  );
}

function MatchGroup({ title, rows, tone, icon }: { title: string; rows: Trdr[]; tone: SectionTone; icon: React.ReactNode }) {
  return (
    <FormSection tone={tone} icon={icon} title={title} aside={<span className="tabular-nums">{rows.length}</span>}>
      <div className="-mx-3 -my-2.5 divide-y divide-border">
        {rows.map((r) => (
          <div key={r.trdr} className="px-3 py-1.5 text-[length:var(--fs-13)]">
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="shrink-0 font-mono text-[length:var(--fs-12)] text-muted-foreground">{r.code}</span>
              <span className="min-w-0 truncate font-medium text-foreground" title={r.name}>{r.name}</span>
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[length:var(--fs-11)] text-muted-foreground">
              {r.kind && <span className="font-medium text-foreground">{r.kind}</span>}
              {r.doy && <span>ΔΟΥ: {r.doy}</span>}
              {r.city && <span>{r.city}</span>}
              {r.phone && <span>☎ {r.phone}</span>}
              {r.email && <span className="truncate">{r.email.split(';')[0]}</span>}
            </div>
          </div>
        ))}
      </div>
    </FormSection>
  );
}
