'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { type ColumnDef } from '@tanstack/react-table';
import { FiRefreshCw, FiCheck, FiSlash, FiAlertTriangle } from 'react-icons/fi';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { syncErrorMessage } from '@/lib/softone-sync/sync-error';

// Μητρώο ΧΡΕΟΠΙΣΤΩΣΕΩΝ SoftOne (object LINEITEM → MTRL με SODTYPE 53), καθρέφτης του
// `SoftoneLineItem`. Είναι το μόνο πράγμα που δέχεται το `MTRL` μιας γραμμής «Ειδικών
// συναλλαγών» (LINLINES) — δεν είναι είδος, δεν είναι υπηρεσία, δεν είναι έξοδο EXPN.
export type LineItemRecord = {
  mtrl: number;
  code: string;
  name: string;
  vat: string | null;
  category: string | null;
  /** Ο χαρακτηρισμός myDATA του μητρώου, ήδη σε ελληνικά (null = κανένας). */
  myData: string | null;
  isActive: boolean;
};

const DASH = <span className="text-muted-foreground/40">—</span>;

export function LineItemsTableClient({
  rows,
  canManage,
  lastSync,
}: {
  rows: LineItemRecord[];
  canManage: boolean;
  lastSync: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  const sync = async () => {
    setBusy(true);
    const res = await fetch('/api/admin/metadata/sync-lineitems-softone', { method: 'POST' });
    setBusy(false);
    if (res.ok) {
      const d = await res.json();
      const extra = d.deactivated ? ` · ${d.deactivated} απενεργοποιήσεις` : '';
      toast.success(`Χρεοπιστώσεις: ${d.total.toLocaleString('el-GR')} (νέες ${d.created}, ενημερώσεις ${d.updated})${extra}`);
      router.refresh();
    } else {
      // Ένα μήνυμα, μία μετάφραση: το ίδιο helper με τα υπόλοιπα κουμπιά συγχρονισμού.
      toast.error(syncErrorMessage(await res.json().catch(() => ({}))));
    }
  };

  const columns = React.useMemo<ColumnDef<LineItemRecord>[]>(() => [
    {
      accessorKey: 'code', header: 'Κωδικός', size: 140,
      cell: ({ row }) => <span className="font-mono text-[12px] tabular-nums text-foreground">{row.original.code || '—'}</span>,
    },
    {
      accessorKey: 'name', header: 'Περιγραφή', size: 340,
      cell: ({ row }) => <span className="text-[12px] font-medium text-foreground">{row.original.name || '—'}</span>,
    },
    {
      accessorKey: 'category', header: 'Κατηγορία δαπάνης', size: 220,
      cell: ({ row }) => (row.original.category
        ? <span className="text-[12px] text-foreground/80">{row.original.category}</span>
        : DASH),
    },
    {
      accessorKey: 'myData', header: 'Χαρακτηρισμός myDATA', size: 260,
      // Μια χρεοπίστωση χωρίς χαρακτηρισμό θα καταχωρίσει αχαρακτήριστη γραμμή: το λέμε ρητά,
      // με εικονίδιο και κείμενο (ποτέ μόνο χρώμα). Η διόρθωση γίνεται στο ίδιο το SoftOne.
      cell: ({ row }) => (row.original.myData
        ? <span className="text-[12px]" style={{ color: '#047857' }}>{row.original.myData}</span>
        : (
          <span className="inline-flex items-center gap-1 text-[12px]" style={{ color: '#B45309' }}>
            <FiAlertTriangle className="h-3.5 w-3.5" aria-hidden /> Κανένας
          </span>
        )),
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
        Οι χρεοπιστώσεις είναι ό,τι δέχεται μια γραμμή «Ειδικών συναλλαγών» (LINLINES) — εκεί
        καταχωρούνται τα τιμολόγια δαπανών. Ο χαρακτηρισμός myDATA ανήκει στο μητρώο του SoftOne·
        η εφαρμογή τον δείχνει, δεν τον αλλάζει.
      </p>
      <DataTable
        columns={columns}
        data={rows}
        searchKey="name"
        searchPlaceholder="Αναζήτηση (κωδικός, περιγραφή…)"
        persistKey="admin.lineitems.table.v1"
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
