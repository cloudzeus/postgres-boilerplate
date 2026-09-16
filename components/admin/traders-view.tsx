'use client';

import * as React from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { type ColumnDef } from '@tanstack/react-table';
import { FiRefreshCw, FiGlobe, FiUsers } from 'react-icons/fi';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { syncErrorMessage } from '@/lib/softone-sync/sync-error';

export type TraderRecord = {
  trdr: number;
  sodtype: number;
  kind: string;
  code: string;
  name: string;
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

// SoftOne «Συναλλασσόμενοι» in the ERP's own order. Colors are DG-palette hex
// written inline so the Tailwind JIT never purges them.
const TYPES: Array<{ sodtype: number; label: string; color: string; soft: string }> = [
  { sodtype: 13, label: 'Πελάτες',                color: '#0078D4', soft: '#EAF4FC' },
  { sodtype: 12, label: 'Προμηθευτές',            color: '#047857', soft: '#E8F7F0' },
  { sodtype: 15, label: 'Χρεώστες',               color: '#6D28D9', soft: '#F3EEFF' },
  { sodtype: 16, label: 'Πιστωτές',               color: '#C2410C', soft: '#FFF1E6' },
  { sodtype: 14, label: 'Χρηματικοί λογαριασμοί', color: '#0F766E', soft: '#E6F6F4' },
];
const typeOf = (sodtype: number) => TYPES.find((t) => t.sodtype === sodtype) ?? { sodtype, label: `Τύπος ${sodtype}`, color: '#5C5C5C', soft: '#F3F2F1' };
const DASH = <span className="text-muted-foreground/40">—</span>;
const muted = (v: string | null, mono = false) =>
  v ? <span className={cn('text-[12px] text-muted-foreground', mono && 'font-mono tabular-nums')}>{v}</span> : DASH;
const normalizeUrl = (w: string) => (/^https?:\/\//i.test(w) ? w : `https://${w}`);

export function TradersView({
  rows,
  canManage,
  lastSync,
}: {
  rows: TraderRecord[];
  canManage: boolean;
  lastSync: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [busy, setBusy] = React.useState(false);

  const counts = React.useMemo(() => {
    const m = new Map<number, number>();
    for (const r of rows) m.set(r.sodtype, (m.get(r.sodtype) ?? 0) + 1);
    return m;
  }, [rows]);
  const tiles = React.useMemo(() => {
    const known = TYPES.map((t) => ({ ...t, count: counts.get(t.sodtype) ?? 0 }));
    const extra = Array.from(counts.keys()).filter((k) => !TYPES.some((t) => t.sodtype === k)).map((k) => ({ ...typeOf(k), count: counts.get(k) ?? 0 }));
    return [...known, ...extra].filter((t) => t.count > 0);
  }, [counts]);

  // ?type=13 selects one τύπος; nothing → all.
  const typeParam = Number(search.get('type'));
  const activeType = Number.isFinite(typeParam) && counts.has(typeParam) ? typeParam : null;
  const selectType = (t: number | null) => {
    const p = new URLSearchParams(search.toString());
    if (t == null || t === activeType) p.delete('type'); else p.set('type', String(t));
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const visible = React.useMemo(() => (activeType == null ? rows : rows.filter((r) => r.sodtype === activeType)), [rows, activeType]);
  const active = activeType != null ? typeOf(activeType) : null;

  const sync = async () => {
    setBusy(true);
    const res = await fetch('/api/admin/metadata/sync-traders-softone', { method: 'POST' });
    setBusy(false);
    if (res.ok) {
      const d = await res.json();
      toast.success(`Συγχρονίστηκαν ${d.total.toLocaleString('el-GR')} συναλλασσόμενοι`);
      router.refresh();
    } else {
      const e = await res.json().catch(() => ({}));
      toast.error(syncErrorMessage(e, 'Αποτυχία συγχρονισμού'));
    }
  };

  const columns = React.useMemo<ColumnDef<TraderRecord>[]>(() => {
    const cols: ColumnDef<TraderRecord>[] = [
      {
        accessorKey: 'code', header: 'Κωδικός', size: 110,
        cell: ({ row }) => <span className="font-mono text-[12px] tabular-nums text-muted-foreground">{row.original.code || '—'}</span>,
      },
      {
        accessorKey: 'name', header: 'Επωνυμία', size: 300,
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate text-[12px] font-medium text-foreground">{row.original.name || '—'}</div>
            {row.original.profession && <div className="truncate text-[10px] text-muted-foreground">{row.original.profession}</div>}
          </div>
        ),
      },
    ];
    if (activeType == null) {
      cols.push({
        accessorKey: 'kind', header: 'Τύπος', size: 150,
        cell: ({ row }) => {
          const t = typeOf(row.original.sodtype);
          return (
            <button
              type="button"
              onClick={() => selectType(row.original.sodtype)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold"
              style={{ backgroundColor: t.soft, color: t.color, borderColor: t.color + '55' }}
              title={`Μόνο ${t.label}`}
            >
              <span aria-hidden className="size-1.5 rounded-full" style={{ backgroundColor: t.color }} />
              {row.original.kind}
            </button>
          );
        },
      });
    }
    cols.push(
      { accessorKey: 'afm', header: 'Α.Φ.Μ.', size: 110, cell: ({ row }) => muted(row.original.afm, true) },
      { accessorKey: 'doy', header: 'Δ.Ο.Υ.', size: 130, cell: ({ row }) => muted(row.original.doy) },
      {
        accessorKey: 'address', header: 'Διεύθυνση', size: 220,
        cell: ({ row }) => {
          const c = row.original;
          const sub = [c.zip, c.city].filter(Boolean).join(' ');
          return (
            <div className="min-w-0">
              <div className="truncate text-[12px] text-foreground">{c.address || '—'}</div>
              {sub && <div className="truncate text-[10px] text-muted-foreground">{sub}</div>}
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
      { accessorKey: 'district', header: 'Περιοχή', size: 140, enableHiding: true, cell: ({ row }) => muted(row.original.district) },
      { accessorKey: 'fax', header: 'Fax', size: 130, enableHiding: true, cell: ({ row }) => muted(row.original.fax, true) },
    );
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeType]);

  const toolbar = canManage ? (
    <Button variant="secondary" size="sm" onClick={sync} disabled={busy}>
      <FiRefreshCw className={cn('mr-1.5 h-3.5 w-3.5', busy && 'animate-spin')} />
      {busy ? 'Συγχρονισμός…' : 'Συγχρονισμός από SoftOne'}
    </Button>
  ) : undefined;

  return (
    <div className="space-y-4 rounded-lg bg-neutral-8 p-3 sm:p-4">
      {/* Type tiles — click filters, click again clears */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Tile active={activeType == null} onClick={() => selectType(null)} label="Όλοι" count={rows.length} color="#5C5C5C" soft="#F3F2F1" icon />
        {tiles.map((t) => (
          <Tile key={t.sodtype} active={activeType === t.sodtype} onClick={() => selectType(t.sodtype)} label={t.label} count={t.count} color={t.color} soft={t.soft} />
        ))}
      </div>

      <div className="rounded-md border border-border bg-white shadow-fluent-2">
        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-neutral-4 px-3 py-2.5">
          <h2 className="text-[14px] font-semibold text-foreground" style={active ? { color: active.color } : undefined}>
            {active ? active.label : 'Όλοι οι συναλλασσόμενοι'}
          </h2>
          <span className="rounded-full bg-sisyphus-50 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-sisyphus-700">
            {visible.length.toLocaleString('el-GR')}
          </span>
          {lastSync && (
            <span className="ml-auto text-[11px] text-muted-foreground">
              Τελευταίος συγχρονισμός: {new Date(lastSync).toLocaleString('el-GR')}
            </span>
          )}
        </div>
        <div className="overflow-x-auto p-3">
          <DataTable
            key={activeType ?? 'all'}
            columns={columns}
            data={visible}
            searchKey="name"
            searchPlaceholder="Αναζήτηση (κωδικός, επωνυμία, ΑΦΜ, ΔΟΥ, πόλη, τηλ…)"
            persistKey="admin.traders.table.v1"
            toolbar={toolbar}
          />
        </div>
      </div>
    </div>
  );
}

function Tile({
  active, onClick, label, count, color, soft, icon,
}: { active: boolean; onClick: () => void; label: string; count: number; color: string; soft: string; icon?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'relative flex min-h-[72px] cursor-pointer flex-col justify-between overflow-hidden rounded-md border bg-white p-2.5 text-left cx-transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'border-transparent shadow-fluent-4' : 'border-border shadow-fluent-2 hover:shadow-fluent-4',
      )}
      style={active ? { boxShadow: `0 0 0 2px ${color}`, backgroundColor: soft } : undefined}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: color }} />
      <span className="flex items-center gap-1.5 pl-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color }}>
        {icon && <FiUsers className="size-3" />}{label}
      </span>
      <span className="pl-1.5 text-[20px] font-semibold leading-none tabular-nums text-foreground">{count.toLocaleString('el-GR')}</span>
    </button>
  );
}
