'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { type ColumnDef } from '@tanstack/react-table';
import { FiRefreshCw, FiCheck, FiSlash } from 'react-icons/fi';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';

// Κατηγορίες δαπανών SoftOne (object LINCATEGORY → MTRCATEGORY με SODTYPE 53). Είναι η
// ΟΜΑΔΟΠΟΙΗΣΗ πάνω από τις χρεοπιστώσεις — αυτή που κάνει την επιλογή δαπάνης εφικτή.
export type LineCategoryRecord = {
  mtrCategory: number;
  code: string;
  name: string;
  vat: string | null;
  acnmsk: string | null;
  lineItems: number;
  isActive: boolean;
};

const DASH = <span className="text-muted-foreground/40">—</span>;

export function LineCategoriesTableClient({
  rows,
  canManage,
  lastSync,
}: {
  rows: LineCategoryRecord[];
  canManage: boolean;
  lastSync: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  const sync = async () => {
    setBusy(true);
    const res = await fetch('/api/admin/metadata/sync-linecategories-softone', { method: 'POST' });
    setBusy(false);
    if (res.ok) {
      const d = await res.json();
      toast.success(`Κατηγορίες δαπανών: ${d.total.toLocaleString('el-GR')} (νέες ${d.created}, ενημερώσεις ${d.updated})`);
      router.refresh();
    } else {
      const e = await res.json().catch(() => ({}));
      toast.error(e.error === 'softone_error' ? `Σφάλμα SoftOne: ${e.message ?? ''}` : 'Αποτυχία συγχρονισμού');
    }
  };

  const columns = React.useMemo<ColumnDef<LineCategoryRecord>[]>(() => [
    {
      accessorKey: 'code', header: 'Σύντμηση', size: 130,
      cell: ({ row }) => <span className="font-mono text-[12px] tabular-nums text-foreground">{row.original.code || '—'}</span>,
    },
    {
      accessorKey: 'name', header: 'Περιγραφή', size: 360,
      cell: ({ row }) => <span className="text-[12px] font-medium text-foreground">{row.original.name || '—'}</span>,
    },
    {
      accessorKey: 'lineItems', header: 'Χρεοπιστώσεις', size: 130,
      cell: ({ row }) => (
        <span className="text-[12px] tabular-nums text-foreground/80">
          {row.original.lineItems.toLocaleString('el-GR')}
        </span>
      ),
    },
    {
      accessorKey: 'acnmsk', header: 'Λογ/σμός', size: 160,
      cell: ({ row }) => (row.original.acnmsk
        ? <span className="font-mono text-[12px] text-muted-foreground">{row.original.acnmsk}</span>
        : DASH),
    },
    {
      accessorKey: 'vat', header: 'ΦΠΑ', size: 80,
      cell: ({ row }) => (row.original.vat
        ? <span className="font-mono text-[12px] tabular-nums text-muted-foreground">{row.original.vat}</span>
        : DASH),
    },
    {
      accessorKey: 'isActive', header: 'Ενεργή', size: 100,
      cell: ({ row }) => (row.original.isActive ? (
        <span className="inline-flex items-center gap-1 text-[12px]" style={{ color: '#047857' }}>
          <FiCheck className="h-3.5 w-3.5" aria-hidden /> Ναι
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">
          <FiSlash className="h-3.5 w-3.5" aria-hidden /> Όχι
        </span>
      )),
    },
  ], []);

  const toolbar = canManage ? (
    <Button variant="secondary" size="sm" onClick={sync} disabled={busy}>
      <FiRefreshCw className={cn('mr-1.5 h-3.5 w-3.5', busy && 'animate-spin')} />
      {busy ? 'Συγχρονισμός…' : 'Συγχρονισμός από SoftOne'}
    </Button>
  ) : undefined;

  return (
    <div className="space-y-2">
      <p className="text-[12px] text-muted-foreground">
        Η κατηγορία δαπάνης είναι το φίλτρο της αναζήτησης χρεοπιστώσεων στην ουρά «Είδη &amp; έξοδα».
      </p>
      <DataTable
        columns={columns}
        data={rows}
        searchKey="name"
        searchPlaceholder="Αναζήτηση (σύντμηση, περιγραφή…)"
        persistKey="admin.linecategories.table.v1"
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
