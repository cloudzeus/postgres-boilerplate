'use client';

import * as React from 'react';
import {
  FiCopy, FiTruck, FiBox, FiCheck, FiAlertTriangle, FiAlertOctagon, FiChevronDown, FiLoader,
} from 'react-icons/fi';
import { toast } from 'sonner';
import { FiPlusCircle } from 'react-icons/fi';
import { cn } from '@/lib/utils';
import { SoftoneMatchPicker } from '@/components/admin/softone-match-picker';
import { CreateSoftoneItemModal } from '@/components/admin/create-softone-item-modal';

type Checks = {
  duplicate: { checked: boolean; exists: boolean; ref: string | null };
  supplier: { checked: boolean; found: boolean; name: string | null; code: string | null; kind: string | null; afm: string };
  items: { total: number; matched: number; unmatched: { id: string; code: string | null; name: string }[] };
};

type Tone = 'ok' | 'warn' | 'danger' | 'idle';
const TONE: Record<Tone, { bg: string; fg: string; bd: string }> = {
  ok:     { bg: '#ECFDF5', fg: '#047857', bd: '#A7F3D0' },
  warn:   { bg: '#FFF8EE', fg: '#B45309', bd: '#FCD9A8' },
  danger: { bg: '#FEF2F2', fg: '#B91C1C', bd: '#FECACA' },
  idle:   { bg: '#F3F4F6', fg: '#6B7280', bd: '#E5E7EB' },
};

export function SoftoneChecksStrip({ docId }: { docId: string }) {
  const [data, setData] = React.useState<Checks | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [open, setOpen] = React.useState(false);
  const [createFor, setCreateFor] = React.useState<{ lineId: string; code: string | null; name: string } | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/ocr/${docId}/checks`);
      if (res.ok) setData(await res.json());
    } finally { setLoading(false); }
  }, [docId]);
  React.useEffect(() => { void load(); }, [load]);

  if (loading) {
    return <div className="h-[52px] animate-pulse rounded-xl border border-border bg-muted/30" />;
  }
  if (!data) return null;

  // ---- derive the 3 statuses ----
  const dupTone: Tone = !data.duplicate.checked ? 'idle' : data.duplicate.exists ? 'danger' : 'ok';
  const supTone: Tone = !data.supplier.checked ? 'idle' : data.supplier.found ? 'ok' : 'warn';
  const itemsUnmatched = data.items.unmatched.length;
  const itemsTone: Tone = data.items.total === 0 ? 'idle' : itemsUnmatched === 0 ? 'ok' : 'warn';

  const needsAction = supTone === 'warn' || itemsTone === 'warn' || dupTone === 'danger';

  const matchSupplier = async (trdr: number, name: string) => {
    const res = await fetch(`/api/admin/ocr/${docId}/match-supplier`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trdr }),
    });
    if (res.ok) { toast.success(`Προμηθευτής: ${name}`); void load(); } else toast.error('Αποτυχία');
  };
  const matchLine = async (lineId: string, mtrl: number, name: string) => {
    const res = await fetch('/api/admin/ocr/match-line', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lineId, mtrl }),
    });
    if (res.ok) { toast.success(`Αντιστοιχίστηκε: ${name}`); void load(); } else toast.error('Αποτυχία');
  };

  return (
   <>
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
      {/* The strip — 3 segments */}
      <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Segment
          tone={dupTone}
          icon={dupTone === 'danger' ? <FiAlertOctagon /> : <FiCopy />}
          title="Διπλό"
          value={!data.duplicate.checked ? 'Δεν ελέγχθηκε'
            : data.duplicate.exists ? `Υπάρχει ήδη${data.duplicate.ref ? ` · ${data.duplicate.ref}` : ''}` : 'Δεν υπάρχει διπλό'}
        />
        <Segment
          tone={supTone}
          icon={<FiTruck />}
          title="Προμηθευτής"
          value={!data.supplier.checked ? 'Δεν ελέγχθηκε'
            : data.supplier.found ? `${data.supplier.name}` : 'Δεν βρέθηκε'}
          action={supTone === 'warn'
            ? <SoftoneMatchPicker type="suppliers" triggerLabel="Σύνδεσε" onPick={(p) => matchSupplier(p.id, p.name)} />
            : undefined}
        />
        <Segment
          tone={itemsTone}
          icon={<FiBox />}
          title="Είδη / Υπηρεσίες"
          value={data.items.total === 0 ? '—'
            : itemsUnmatched === 0 ? `Όλα βρέθηκαν (${data.items.total})` : `${itemsUnmatched} χωρίς αντιστοίχιση`}
          action={itemsTone === 'warn'
            ? <button onClick={() => setOpen((o) => !o)}
                className="inline-flex items-center gap-1 rounded-md border border-current/20 px-2 py-1 text-[11px] font-semibold hover:bg-current/5">
                Λύσε <FiChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
              </button>
            : undefined}
        />
      </div>

      {/* Inline resolution for unmatched items */}
      {open && itemsUnmatched > 0 && (
        <div className="border-t border-border bg-muted/20 p-2">
          <div className="max-h-56 overflow-auto rounded-lg border border-border bg-card">
            {data.items.unmatched.map((l) => (
              <div key={l.id} className="flex items-center gap-2 border-b border-border/60 px-3 py-2 last:border-0">
                <span className="w-[90px] shrink-0 font-mono text-[11px] text-muted-foreground">{l.code || '—'}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">{l.name}</span>
                <button onClick={() => setCreateFor({ lineId: l.id, code: l.code, name: l.name })}
                  className="inline-flex items-center gap-1 rounded-md border border-sisyphus-500/30 px-2 py-1 text-[11px] font-semibold text-sisyphus-600 hover:bg-sisyphus-50"
                  title="Δημιουργία νέου είδους/υπηρεσίας στο SoftOne">
                  <FiPlusCircle className="h-3 w-3" /> Νέο
                </button>
                <SoftoneMatchPicker type="items" triggerLabel="Ψάξε & σύνδεσε" onPick={(p) => matchLine(l.id, p.id, p.name)} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer hint only when everything is clean */}
      {!needsAction && (
        <div className="flex items-center gap-1.5 border-t border-border bg-emerald-50/40 px-3 py-1.5 text-[11px] font-medium" style={{ color: '#047857' }}>
          <FiCheck className="h-3.5 w-3.5" /> Όλοι οι έλεγχοι ΟΚ — έτοιμο για καταχώριση.
        </div>
      )}
    </div>

    <CreateSoftoneItemModal
      open={createFor != null}
      onOpenChange={(o) => { if (!o) setCreateFor(null); }}
      lineId={createFor?.lineId}
      initialCode={createFor?.code ?? ''}
      initialName={createFor?.name ?? ''}
      onCreated={() => { setCreateFor(null); void load(); }}
    />
   </>
  );
}

function Segment({
  tone, icon, title, value, action,
}: { tone: Tone; icon: React.ReactNode; title: string; value: string; action?: React.ReactNode }) {
  const t = TONE[tone];
  const StatusIcon = tone === 'ok' ? FiCheck : tone === 'danger' ? FiAlertOctagon : tone === 'warn' ? FiAlertTriangle : FiLoader;
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ backgroundColor: t.bg, color: t.fg }}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </div>
        <div className="flex items-center gap-1.5">
          <StatusIcon className="h-3.5 w-3.5 shrink-0" style={{ color: t.fg }} />
          <span className="truncate text-[13px] font-medium text-foreground" title={value}>{value}</span>
        </div>
      </div>
      {action && <div className="shrink-0" style={{ color: t.fg }}>{action}</div>}
    </div>
  );
}
