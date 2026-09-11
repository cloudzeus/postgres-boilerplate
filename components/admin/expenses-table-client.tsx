'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { type ColumnDef } from '@tanstack/react-table';
import { FiRefreshCw, FiCheck, FiSlash } from 'react-icons/fi';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';

// Μητρώο εξόδων SoftOne (object EXPENSES → πίνακας EXPN), καθρέφτης του SoftoneExpense.
export type ExpenseRecord = {
  expn: number;
  code: string;
  name: string;
  vat: string | null;
  isActive: boolean;
};

const DASH = <span className="text-muted-foreground/40">—</span>;

export function ExpensesTableClient({
  rows,
  canManage,
  lastSync,
}: {
  rows: ExpenseRecord[];
  canManage: boolean;
  lastSync: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  const sync = async () => {
    setBusy(true);
    const res = await fetch('/api/admin/metadata/sync-expenses-softone', { method: 'POST' });
    setBusy(false);
    if (res.ok) {
      const d = await res.json();
      const extra = d.deactivated ? ` · ${d.deactivated} απενεργοποιήσεις` : '';
      toast.success(`Έξοδα: ${d.total.toLocaleString('el-GR')} (νέα ${d.created}, ενημερώσεις ${d.updated})${extra}`);
      router.refresh();
    } else {
      const e = await res.json().catch(() => ({}));
      toast.error(e.error === 'softone_error' ? `Σφάλμα SoftOne: ${e.message ?? ''}` : 'Αποτυχία συγχρονισμού');
    }
  };

  const columns = React.useMemo<ColumnDef<ExpenseRecord>[]>(() => [
    {
      accessorKey: 'code', header: 'Σύντμηση', size: 130,
      cell: ({ row }) => <span className="font-mono text-[12px] tabular-nums text-foreground">{row.original.code || '—'}</span>,
    },
    {
      accessorKey: 'name', header: 'Περιγραφή', size: 380,
      cell: ({ row }) => <span className="font-medium text-foreground text-[12px]">{row.original.name || '—'}</span>,
    },
    {
      accessorKey: 'vat', header: 'ΦΠΑ', size: 90,
      cell: ({ row }) => (row.original.vat
        ? <span className="font-mono text-[12px] tabular-nums text-muted-foreground">{row.original.vat}</span>
        : DASH),
    },
    {
      accessorKey: 'isActive', header: 'Ενεργό', size: 100,
      // Κατάσταση = εικονίδιο + κείμενο (όχι μόνο χρώμα).
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
      <DataTable
        columns={columns}
        data={rows}
        searchKey="name"
        searchPlaceholder="Αναζήτηση (σύντμηση, περιγραφή…)"
        persistKey="admin.expenses.table.v1"
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
