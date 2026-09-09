'use client';

import * as React from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { type ColumnDef } from '@tanstack/react-table';
import { FiRefreshCw, FiCheckCircle } from 'react-icons/fi';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Combobox } from '@/components/ui/combobox';
import { Switch } from '@/components/ui/switch';

export type DocSeriesRecord = {
  id: number;
  source: 'series' | 'purchase';
  sosource: number;
  family: string;
  code: string;
  abbrev: string | null;
  name: string;
  section: string | null;
  isActive: boolean;
  enabled: boolean;
};

// Business areas in working order (purchases, expenses, assets first). Colors are DG
// palette hex values written inline so the Tailwind JIT never purges them.
const AREAS: Array<{ key: string; label: string; color: string; soft: string; modules: number[] }> = [
  { key: 'purchases', label: 'Αγορές',                color: '#0078D4', soft: '#EAF4FC', modules: [1251, 1253, 1282, 1212] },
  { key: 'expenses',  label: 'Έξοδα',                 color: '#C2410C', soft: '#FFF1E6', modules: [1261, 1653, 1717] },
  { key: 'assets',    label: 'Πάγια',                 color: '#6D28D9', soft: '#F3EEFF', modules: [1154, 1054] },
  { key: 'sales',     label: 'Πωλήσεις',              color: '#047857', soft: '#E8F7F0', modules: [1351, 1361, 1352, 1353, 1312, 1313, 1382] },
  { key: 'cash',      label: 'Εισπράξεις & Πληρωμές', color: '#0369A1', soft: '#E6F3FA', modules: [1381, 1281, 1581, 1681, 1413, 1412, 1415, 1416] },
  { key: 'banks',     label: 'Τράπεζες & Αξιόγραφα',  color: '#B45309', soft: '#FDF3E3', modules: [1481, 1453, 1414, 8100, 1181] },
  { key: 'ledger',    label: 'Λογιστική',             color: '#BE185D', soft: '#FCEBF3', modules: [1089, 1090, 1140] },
  { key: 'other',     label: 'Λοιπά',                 color: '#5C5C5C', soft: '#F3F2F1', modules: [1151, 1171, 5151, 7151, 1553, 2021, 2052] },
];
const OTHER = 'other';
const DASH = <span className="text-muted-foreground/40">—</span>;

type Family = { sosource: number; family: string; count: number; enabled: number };

export function DocSeriesTabs({
  rows: initialRows,
  canManage,
  lastSync,
}: {
  rows: DocSeriesRecord[];
  canManage: boolean;
  lastSync: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [rows, setRows] = React.useState(initialRows);
  React.useEffect(() => setRows(initialRows), [initialRows]);
  const [busy, setBusy] = React.useState(false);
  const [onlyEnabled, setOnlyEnabled] = React.useState(false);

  // ενότητες present in the data, with counts
  const families = React.useMemo(() => {
    const m = new Map<number, Family>();
    for (const r of rows) {
      const f = m.get(r.sosource) ?? { sosource: r.sosource, family: r.family, count: 0, enabled: 0 };
      f.count++; if (r.enabled) f.enabled++;
      m.set(r.sosource, f);
    }
    return m;
  }, [rows]);

  const areas = React.useMemo(() => {
    const listed = new Set(AREAS.flatMap((a) => a.modules));
    const unknown = Array.from(families.keys()).filter((id) => !listed.has(id)).sort((a, b) => a - b);
    return AREAS.map((a) => {
      const ids = a.key === OTHER ? [...a.modules, ...unknown] : a.modules;
      const items = ids.map((id) => families.get(id)).filter((f): f is Family => !!f);
      return { ...a, items, count: items.reduce((n, f) => n + f.count, 0), enabled: items.reduce((n, f) => n + f.enabled, 0) };
    }).filter((a) => a.items.length > 0);
  }, [families]);
  const areaOf = React.useCallback((sosource: number) => areas.find((a) => a.items.some((f) => f.sosource === sosource)) ?? null, [areas]);

  // URL state: ?area=expenses (whole area) or ?tab=1261 (one ενότητα). Nothing → all series.
  const tabParam = search.get('tab');
  const areaParam = search.get('area');
  const activeModule = tabParam && families.has(Number(tabParam)) ? Number(tabParam) : null;
  const activeArea = activeModule != null ? areaOf(activeModule) : (areas.find((a) => a.key === areaParam) ?? null);

  const navigate = (params: Record<string, string | null>) => {
    const p = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(params)) { if (v == null) p.delete(k); else p.set(k, v); }
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const selectArea = (key: string | null) => navigate({ area: activeArea?.key === key && activeModule == null ? null : key, tab: null });
  const selectValue = (v: string) => {
    if (v === 'all') return navigate({ area: null, tab: null });
    if (v.startsWith('area:')) return navigate({ area: v.slice(5), tab: null });
    navigate({ area: null, tab: v });
  };

  // Combobox items: «Όλες», then each area followed by its ενότητες (searchable by both names).
  const comboItems = React.useMemo(() => {
    const items: { value: string; label: string }[] = [{ value: 'all', label: `Όλες οι σειρές (${rows.length.toLocaleString('el-GR')})` }];
    for (const a of areas) {
      items.push({ value: `area:${a.key}`, label: `${a.label} — όλες (${a.count})` });
      for (const f of a.items) items.push({ value: String(f.sosource), label: `${a.label} › ${f.family} (${f.count})` });
    }
    return items;
  }, [areas, rows.length]);
  const comboValue = activeModule != null ? String(activeModule) : activeArea ? `area:${activeArea.key}` : 'all';

  const visible = React.useMemo(() => {
    let out = rows;
    if (activeModule != null) out = out.filter((r) => r.sosource === activeModule);
    else if (activeArea) { const ids = new Set(activeArea.items.map((f) => f.sosource)); out = out.filter((r) => ids.has(r.sosource)); }
    if (onlyEnabled) out = out.filter((r) => r.enabled);
    return out;
  }, [rows, activeModule, activeArea, onlyEnabled]);

  const sync = async () => {
    setBusy(true);
    const res = await fetch('/api/admin/metadata/sync-docseries-softone', { method: 'POST' });
    setBusy(false);
    if (res.ok) {
      const d = await res.json();
      const extra = d.removed ? ` · ${d.removed} διαγραφές` : '';
      toast.success(`Σειρές παραστατικών: ${d.total} (νέες ${d.created}, ενημερώσεις ${d.updated})${extra}`);
      router.refresh();
    } else {
      const e = await res.json().catch(() => ({}));
      toast.error(e.error === 'softone_error' ? `Σφάλμα SoftOne: ${e.message ?? ''}` : 'Αποτυχία συγχρονισμού');
    }
  };

  // Optimistic on/off; reverts on failure.
  const toggle = async (rec: DocSeriesRecord, enabled: boolean) => {
    setRows((rs) => rs.map((r) => (r.source === rec.source && r.id === rec.id ? { ...r, enabled } : r)));
    const res = await fetch('/api/admin/metadata/doc-series', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: rec.source, id: rec.id, enabled }),
    });
    if (!res.ok) {
      setRows((rs) => rs.map((r) => (r.source === rec.source && r.id === rec.id ? { ...r, enabled: !enabled } : r)));
      toast.error(`Αποτυχία αλλαγής για τη σειρά ${rec.code}`);
    }
  };

  const showModuleColumn = activeModule == null;
  const columns = React.useMemo<ColumnDef<DocSeriesRecord>[]>(() => {
    const cols: ColumnDef<DocSeriesRecord>[] = [
      {
        id: 'enabled', accessorKey: 'enabled', header: 'Σε χρήση', size: 96, enableSorting: true,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Switch
              checked={row.original.enabled}
              disabled={!canManage}
              onCheckedChange={(v) => toggle(row.original, v)}
              aria-label={`Σειρά ${row.original.code} σε χρήση`}
            />
          </div>
        ),
      },
      {
        accessorKey: 'code', header: 'Σειρά', size: 84,
        cell: ({ row }) => <span className="font-mono text-[12px] tabular-nums text-muted-foreground">{row.original.code}</span>,
      },
      {
        accessorKey: 'abbrev', header: 'Σύντμηση', size: 130,
        cell: ({ row }) => row.original.abbrev
          ? <span className="inline-flex rounded-sm border border-border bg-neutral-6 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-foreground">{row.original.abbrev}</span>
          : DASH,
      },
      {
        accessorKey: 'name', header: 'Περιγραφή', size: 560,
        cell: ({ row }) => (
          <span className={cn('text-[13px]', row.original.enabled ? 'font-medium text-foreground' : 'text-foreground/80')}>{row.original.name}</span>
        ),
      },
    ];
    if (showModuleColumn) {
      cols.push({
        accessorKey: 'family', header: 'Ενότητα', size: 260,
        cell: ({ row }) => {
          const a = areaOf(row.original.sosource);
          return (
            <button
              type="button"
              onClick={() => navigate({ area: null, tab: String(row.original.sosource) })}
              className="inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-sm text-left text-[12px] text-foreground/80 hover:text-foreground hover:underline"
              title={`Μόνο αυτή η ενότητα (SOSOURCE ${row.original.sosource})`}
            >
              <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: a?.color ?? '#5C5C5C' }} />
              <span className="truncate">{row.original.family}</span>
            </button>
          );
        },
      });
    }
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showModuleColumn, canManage, areaOf]);

  const toolbar = (
    <div className="flex items-center gap-3">
      <label className="inline-flex cursor-pointer items-center gap-2 text-[12px] text-foreground/80">
        <Switch checked={onlyEnabled} onCheckedChange={setOnlyEnabled} aria-label="Μόνο σε χρήση" />
        Μόνο σε χρήση
      </label>
      {canManage && (
        <Button variant="secondary" size="sm" onClick={sync} disabled={busy}>
          <FiRefreshCw className={cn('mr-1.5 h-3.5 w-3.5', busy && 'animate-spin')} />
          {busy ? 'Συγχρονισμός…' : 'Συγχρονισμός από SoftOne'}
        </Button>
      )}
    </div>
  );

  return (
    <div className="space-y-4 rounded-lg bg-neutral-8 p-3 sm:p-4">
      {/* Area tiles — the at-a-glance map; click filters, click again clears. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {areas.map((a) => {
          const active = activeArea?.key === a.key;
          return (
            <button
              key={a.key}
              type="button"
              onClick={() => selectArea(a.key)}
              aria-pressed={active}
              className={cn(
                'group relative flex min-h-[72px] cursor-pointer flex-col justify-between overflow-hidden rounded-md border bg-white p-2.5 text-left cx-transition',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active ? 'border-transparent shadow-fluent-4 ring-2' : 'border-border shadow-fluent-2 hover:shadow-fluent-4',
              )}
              style={active ? { boxShadow: `0 0 0 2px ${a.color}`, backgroundColor: a.soft } : undefined}
            >
              <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: a.color }} />
              <span className="pl-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: a.color }}>{a.label}</span>
              <span className="flex items-end justify-between pl-1.5">
                <span className="text-[20px] font-semibold leading-none tabular-nums text-foreground">{a.count.toLocaleString('el-GR')}</span>
                <span className="inline-flex items-center gap-1 text-[10px] tabular-nums text-muted-foreground" title="Σε χρήση">
                  <FiCheckCircle className="size-3" style={a.enabled ? { color: a.color } : undefined} />
                  {a.enabled}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Selector + table card */}
      <div className="rounded-md border border-border bg-white shadow-fluent-2">
        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-neutral-4 px-3 py-2.5">
          <div className="w-full sm:w-[380px]">
            <Combobox value={comboValue} items={comboItems} onSelect={selectValue} placeholder="Ενότητα…" />
          </div>
          {(activeArea || activeModule != null) && (
            <button type="button" onClick={() => selectValue('all')} className="text-[12px] text-sisyphus-700 hover:underline">
              Καθαρισμός φίλτρου
            </button>
          )}
          <span className="ml-auto text-[11px] text-muted-foreground">
            {visible.length.toLocaleString('el-GR')} σειρές{lastSync ? ` · συγχρονισμός ${new Date(lastSync).toLocaleString('el-GR')}` : ''}
          </span>
        </div>
        <div className="overflow-x-auto p-3">
          <DataTable
            key={`${comboValue}:${onlyEnabled}`}
            columns={columns}
            data={visible}
            searchKey="name"
            searchPlaceholder="Αναζήτηση (σειρά, σύντμηση, περιγραφή…)"
            persistKey="admin.doc-series.table.v4"
            toolbar={toolbar}
            pageSize={50}
          />
        </div>
      </div>
    </div>
  );
}
