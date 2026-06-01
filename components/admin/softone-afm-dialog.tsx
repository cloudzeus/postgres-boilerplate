'use client';

import * as React from 'react';
import { FiCheckCircle, FiXCircle, FiUserCheck, FiTruck } from 'react-icons/fi';
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
      <DialogContent className="w-[95vw] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Έλεγχος ΑΦΜ στο SoftOne</DialogTitle>
          <DialogDescription>
            ΑΦΜ <span className="font-mono font-medium text-foreground">{afm}</span>
            {contextLabel ? ` · ${contextLabel}` : ''}
          </DialogDescription>
        </DialogHeader>

        {loading && <div className="py-10 text-center text-[13px] text-muted-foreground">Έλεγχος…</div>}
        {error && <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-[13px] text-destructive">{error}</div>}

        {result && (
          <div className="space-y-3">
            {/* Summary */}
            <div className="flex flex-wrap gap-2">
              <StatusPill ok={result.suppliers.length > 0} icon={<FiTruck className="h-3.5 w-3.5" />}
                label={result.suppliers.length > 0 ? `Προμηθευτής (${result.suppliers.length})` : 'Όχι προμηθευτής'} />
              <StatusPill ok={result.customers.length > 0} icon={<FiUserCheck className="h-3.5 w-3.5" />}
                label={result.customers.length > 0 ? `Πελάτης (${result.customers.length})` : 'Όχι πελάτης'} />
            </div>

            {!found && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-[13px]"
                style={{ borderColor: '#FCD9A8', backgroundColor: '#FFF8EE', color: '#92400E' }}>
                Δεν βρέθηκε καταχωρημένος στο SoftOne (ούτε ως πελάτης ούτε ως προμηθευτής).
              </div>
            )}

            {result.suppliers.length > 0 && <MatchGroup title="Προμηθευτές" rows={result.suppliers} />}
            {result.customers.length > 0 && <MatchGroup title="Πελάτες" rows={result.customers} />}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StatusPill({ ok, label, icon }: { ok: boolean; label: string; icon: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium"
      style={ok
        ? { backgroundColor: '#ECFDF3', borderColor: '#A7F3D0', color: '#047857' }
        : { backgroundColor: '#F3F4F6', borderColor: '#E5E7EB', color: '#6B7280' }}
    >
      {ok ? <FiCheckCircle className="h-3.5 w-3.5" /> : <FiXCircle className="h-3.5 w-3.5" />}
      {icon}
      {label}
    </span>
  );
}

function MatchGroup({ title, rows }: { title: string; rows: Trdr[] }) {
  return (
    <div className="rounded-lg border border-border">
      <div className="border-b border-border bg-muted/40 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className="divide-y divide-border">
        {rows.map((r) => (
          <div key={r.trdr} className="px-3 py-2 text-[13px]">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[12px] text-muted-foreground">{r.code}</span>
              <span className="font-medium text-foreground">{r.name}</span>
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
              {r.kind && <span className="font-medium text-foreground">{r.kind}</span>}
              {r.doy && <span>ΔΟΥ: {r.doy}</span>}
              {r.city && <span>{r.city}</span>}
              {r.phone && <span>☎ {r.phone}</span>}
              {r.email && <span className="truncate">{r.email.split(';')[0]}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
