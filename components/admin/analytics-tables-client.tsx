'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { type ColumnDef } from '@tanstack/react-table';
import { FiRefreshCw } from 'react-icons/fi';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { syncErrorMessage } from '@/lib/softone-sync/sync-error';

// Τα τρία μητρώα της ΑΝΑΛΥΤΙΚΗΣ ανά γραμμή: κέντρα κόστους (PRSCOSTCNTR), έργα (PRJC) και
// κατηγορίες δραστηριότητας (PRJCSTAGE). Ίδιος πίνακας, ίδιος συγχρονισμός — μόνο ανάγνωση.
export type AnalyticsRecord = {
  id: number;
  code: string;
  name: string;
  /** Δεύτερη γραμμή πληροφορίας (ιεραρχία, λογαριασμός, συναλλασσόμενος…). */
  sub: string | null;
};

const DASH = <span className="text-muted-foreground/40">—</span>;

export function AnalyticsTableClient({
  rows, canManage, lastSync, endpoint, title, subHeader, hint,
}: {
  rows: AnalyticsRecord[];
  canManage: boolean;
  lastSync: string | null;
  endpoint: string;
  title: string;
  subHeader: string;
  hint: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  const sync = async () => {
    setBusy(true);
    const res = await fetch(`/api/admin/metadata/${endpoint}`, { method: 'POST' });
    setBusy(false);
    if (res.ok) {
      const d = await res.json();
      toast.success(`${title}: ${Number(d.total ?? 0).toLocaleString('el-GR')} (νέα ${d.created}, ενημερώσεις ${d.updated})`);
      router.refresh();
    } else {
      // Ένα μήνυμα, μία μετάφραση: το ίδιο helper με τα υπόλοιπα κουμπιά συγχρονισμού.
      toast.error(syncErrorMessage(await res.json().catch(() => ({}))));
    }
  };

  const columns = React.useMemo<ColumnDef<AnalyticsRecord>[]>(() => [
    {
      accessorKey: 'code', header: 'Κωδικός', size: 140,
      cell: ({ row }) => <span className="font-mono text-[12px] tabular-nums text-foreground">{row.original.code || '—'}</span>,
    },
    {
      accessorKey: 'name', header: 'Περιγραφή', size: 420,
      cell: ({ row }) => <span className="text-[12px] font-medium text-foreground">{row.original.name || '—'}</span>,
    },
    {
      accessorKey: 'sub', header: subHeader, size: 240,
      cell: ({ row }) => (row.original.sub
        ? <span className="text-[12px] text-muted-foreground">{row.original.sub}</span>
        : DASH),
    },
  ], [subHeader]);

  const toolbar = canManage ? (
    <Button variant="secondary" size="sm" onClick={sync} disabled={busy}>
      <FiRefreshCw className={cn('mr-1.5 h-3.5 w-3.5', busy && 'animate-spin')} />
      {busy ? 'Συγχρονισμός…' : 'Συγχρονισμός από SoftOne'}
    </Button>
  ) : undefined;

  return (
    <div className="space-y-2">
      <p className="text-[12px] text-muted-foreground">{hint}</p>
      <DataTable
        columns={columns}
        data={rows}
        searchKey="name"
        searchPlaceholder="Αναζήτηση (κωδικός, περιγραφή…)"
        persistKey={`admin.${endpoint}.table.v1`}
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
