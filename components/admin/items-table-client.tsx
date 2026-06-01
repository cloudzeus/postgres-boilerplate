'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { type ColumnDef } from '@tanstack/react-table';
import { FiRefreshCw } from 'react-icons/fi';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';

export type ItemRecord = {
  mtrl: number;
  code: string;
  code1: string | null;
  code2: string | null;
  name: string;
  name2: string | null;
  price: number | null;
  isService: boolean;
};

const DASH = <span className="text-muted-foreground/40">—</span>;
const mono = (v: string | null) =>
  v ? <span className="font-mono text-[12px] tabular-nums text-muted-foreground">{v}</span> : DASH;

function fmtPrice(n: number | null) {
  if (n == null || n === 0) return DASH;
  return <span className="tabular-nums">{new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' }).format(n)}</span>;
}

export function ItemsTableClient({
  rows,
  variant,
  canManage,
  lastSync,
}: {
  rows: ItemRecord[];
  variant: 'products' | 'services';
  canManage: boolean;
  lastSync: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  const sync = async () => {
    setBusy(true);
    const res = await fetch('/api/admin/metadata/sync-items-softone', { method: 'POST' });
    setBusy(false);
    if (res.ok) {
      const d = await res.json();
      toast.success(`Συγχρονίστηκαν ${d.products.toLocaleString('el-GR')} είδη + ${d.services.toLocaleString('el-GR')} υπηρεσίες`);
      router.refresh();
    } else {
      const e = await res.json().catch(() => ({}));
      toast.error(e.error === 'softone_error' ? `Σφάλμα SoftOne: ${e.message ?? ''}` : 'Αποτυχία συγχρονισμού');
    }
  };

  const columns = React.useMemo<ColumnDef<ItemRecord>[]>(() => {
    const base: ColumnDef<ItemRecord>[] = [
      {
        accessorKey: 'code', header: 'Κωδικός', size: 130,
        cell: ({ row }) => <span className="font-mono text-[12px] tabular-nums text-foreground">{row.original.code || '—'}</span>,
      },
      {
        accessorKey: 'name', header: 'Περιγραφή', size: 320,
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="font-medium text-foreground text-[12px] truncate">{row.original.name || '—'}</div>
            {row.original.name2 && <div className="text-[10px] text-muted-foreground truncate">{row.original.name2}</div>}
          </div>
        ),
      },
    ];
    // EAN + factory code only matter for products.
    if (variant === 'products') {
      base.push(
        { accessorKey: 'code1', header: 'Barcode / EAN', size: 150, cell: ({ row }) => mono(row.original.code1) },
        { accessorKey: 'code2', header: 'Κωδ. εργοστασίου', size: 160, cell: ({ row }) => mono(row.original.code2) },
      );
    }
    base.push({
      accessorKey: 'price', header: () => <span className="block text-right">Τιμή λιανικής</span>, size: 130,
      cell: ({ row }) => <span className="block text-right">{fmtPrice(row.original.price)}</span>,
    });
    return base;
  }, [variant]);

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
        searchPlaceholder="Αναζήτηση (κωδικός, EAN, εργοστασίου, περιγραφή…)"
        persistKey={`admin.${variant}.table.v1`}
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
