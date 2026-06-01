'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { type ColumnDef } from '@tanstack/react-table';
import { FiRefreshCw, FiGlobe } from 'react-icons/fi';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';

export type TrdrRecord = {
  trdr: number;
  code: string;
  name: string;
  kind: string | null;
  afm: string | null;
  doy: string | null;
  profession: string | null;
  address: string | null;
  district: string | null;
  zip: string | null;
  city: string | null;
  phone: string | null;
  phone2: string | null;
  fax: string | null;
  email: string | null;
  webpage: string | null;
};

const DASH = <span className="text-muted-foreground/40">—</span>;

// Inline hex per trader kind — guaranteed visible in light & dark themes.
const KIND_STYLE: Record<string, { bg: string; fg: string; bd: string }> = {
  'Πελάτης':     { bg: '#EAF2FF', fg: '#1D4ED8', bd: '#BFD7FF' },
  'Προμηθευτής': { bg: '#ECFDF5', fg: '#047857', bd: '#A7F3D0' },
  'Πιστωτής':    { bg: '#FFF1E6', fg: '#C2410C', bd: '#FFD8B5' },
};
const muted = (v: string | null, mono = false) =>
  v ? <span className={cn('text-[12px] text-muted-foreground', mono && 'font-mono tabular-nums')}>{v}</span> : DASH;

function normalizeUrl(u: string): string {
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

export function TrdrTableClient({
  rows,
  syncEntity,
  canManage,
  lastSync,
}: {
  rows: TrdrRecord[];
  syncEntity: 'customers' | 'suppliers';
  canManage: boolean;
  lastSync: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  const sync = async () => {
    setBusy(true);
    const res = await fetch(`/api/admin/metadata/sync-${syncEntity}-softone`, { method: 'POST' });
    setBusy(false);
    if (res.ok) {
      const d = await res.json();
      toast.success(`Συγχρονίστηκαν ${d.total.toLocaleString('el-GR')} εγγραφές`);
      router.refresh();
    } else {
      const e = await res.json().catch(() => ({}));
      toast.error(e.error === 'softone_error' ? `Σφάλμα SoftOne: ${e.message ?? ''}` : 'Αποτυχία συγχρονισμού');
    }
  };

  const columns = React.useMemo<ColumnDef<TrdrRecord>[]>(() => ([
    {
      accessorKey: 'code', header: 'Κωδικός', size: 110,
      cell: ({ row }) => <span className="font-mono text-[12px] tabular-nums text-muted-foreground">{row.original.code || '—'}</span>,
    },
    {
      accessorKey: 'name', header: 'Επωνυμία', size: 280,
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="font-medium text-foreground text-[12px] truncate">{row.original.name || '—'}</div>
          {row.original.profession && <div className="text-[10px] text-muted-foreground truncate">{row.original.profession}</div>}
        </div>
      ),
    },
    {
      accessorKey: 'kind', header: 'Τύπος', size: 120,
      cell: ({ row }) => {
        const k = row.original.kind;
        if (!k) return DASH;
        const st = KIND_STYLE[k] ?? { bg: '#F3F4F6', fg: '#374151', bd: '#E5E7EB' };
        return (
          <span className="inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-semibold"
            style={{ backgroundColor: st.bg, color: st.fg, borderColor: st.bd }}>
            {k}
          </span>
        );
      },
    },
    {
      accessorKey: 'afm', header: 'Α.Φ.Μ.', size: 120,
      cell: ({ row }) => muted(row.original.afm, true),
    },
    {
      accessorKey: 'doy', header: 'Δ.Ο.Υ.', size: 130,
      cell: ({ row }) => muted(row.original.doy),
    },
    {
      accessorKey: 'address', header: 'Διεύθυνση', size: 220,
      cell: ({ row }) => {
        const c = row.original;
        const sub = [c.zip, c.city].filter(Boolean).join(' ');
        return (
          <div className="min-w-0">
            <div className="text-[12px] text-foreground truncate">{c.address || '—'}</div>
            {sub && <div className="text-[10px] text-muted-foreground truncate">{sub}</div>}
          </div>
        );
      },
    },
    {
      accessorKey: 'phone', header: 'Τηλέφωνα', size: 150,
      cell: ({ row }) => {
        const c = row.original;
        if (!c.phone && !c.phone2) return DASH;
        return (
          <div className="font-mono text-[12px] tabular-nums">
            <div>{c.phone || ''}</div>
            {c.phone2 && <div className="text-[10px] text-muted-foreground">{c.phone2}</div>}
          </div>
        );
      },
    },
    {
      accessorKey: 'email', header: 'Email', size: 210,
      cell: ({ row }) => {
        const em = row.original.email?.split(';').filter(Boolean) ?? [];
        if (em.length === 0) return DASH;
        return (
          <div className="min-w-0">
            {em.slice(0, 2).map((e, i) => (
              <div key={i} className="truncate text-[12px]">
                <a href={`mailto:${e.trim()}`} className="text-sisyphus-600 hover:underline">{e.trim()}</a>
              </div>
            ))}
          </div>
        );
      },
    },
    {
      accessorKey: 'webpage', header: 'Web', size: 160,
      cell: ({ row }) => {
        const w = row.original.webpage;
        if (!w) return DASH;
        return (
          <a href={normalizeUrl(w)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-sisyphus-600 hover:underline">
            <FiGlobe className="h-3 w-3 shrink-0" /> <span className="truncate">{w}</span>
          </a>
        );
      },
    },
    // Hidden by default — togglable via the Στήλες menu
    {
      accessorKey: 'district', header: 'Περιοχή', size: 140, enableHiding: true,
      cell: ({ row }) => muted(row.original.district),
    },
    {
      accessorKey: 'fax', header: 'Fax', size: 130, enableHiding: true,
      cell: ({ row }) => muted(row.original.fax, true),
    },
  ]), []);

  const toolbar = canManage ? (
    <Button variant="secondary" size="sm" onClick={sync} disabled={busy}>
      <FiRefreshCw className={cn('mr-1.5 h-3.5 w-3.5', busy && 'animate-spin')} />
      {busy ? 'Συγχρονισμός…' : 'Συγχρονισμός από SoftOne'}
    </Button>
  ) : undefined;

  return (
    <div className="space-y-2">
      <DataTable
        columns={columns}
        data={rows}
        searchKey="name"
        searchPlaceholder="Αναζήτηση (κωδικός, επωνυμία, ΑΦΜ, ΔΟΥ, πόλη, τηλ…)"
        persistKey={`admin.${syncEntity}.table.v1`}
        toolbar={toolbar}
        pageSize={50}
      />
      {lastSync && (
        <p className="text-[11px] text-muted-foreground">
          Τελευταίος συγχρονισμός: {new Date(lastSync).toLocaleString('el-GR')}
        </p>
      )}
    </div>
  );
}
