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

// Λίστες χαρακτηρισμού myDATA (EditLists MYDATACLTYPE / MYDATACLCATEGORY). Μητρώα ΑΝΑΦΟΡΑΣ:
// εξηγούν τι σημαίνει ο χαρακτηρισμός που κουβαλά κάθε είδος / υπηρεσία / χρεοπίστωση / έξοδο.
export type MyDataClassRecord = {
  kind: 'type' | 'category';
  sotype: number;
  code: number;
  myDataCode: string | null;
  name: string;
};

const DASH = <span className="text-muted-foreground/40">—</span>;
const KIND_LABEL: Record<MyDataClassRecord['kind'], string> = {
  type: 'Τύπος',
  category: 'Κατηγορία',
};

export function MyDataClassesTableClient({
  rows,
  canManage,
  lastSync,
}: {
  rows: MyDataClassRecord[];
  canManage: boolean;
  lastSync: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  const sync = async () => {
    setBusy(true);
    const res = await fetch('/api/admin/metadata/sync-mydata-classes-softone', { method: 'POST' });
    setBusy(false);
    if (res.ok) {
      const d = await res.json();
      toast.success(`Χαρακτηρισμοί myDATA: ${Number(d.types ?? 0)} τύποι, ${Number(d.categories ?? 0)} κατηγορίες`);
      router.refresh();
    } else {
      // Ένα μήνυμα, μία μετάφραση: το ίδιο helper με τα υπόλοιπα κουμπιά συγχρονισμού.
      toast.error(syncErrorMessage(await res.json().catch(() => ({}))));
    }
  };

  const columns = React.useMemo<ColumnDef<MyDataClassRecord>[]>(() => [
    {
      accessorKey: 'kind', header: 'Λίστα', size: 110,
      cell: ({ row }) => <span className="text-[12px] text-foreground/80">{KIND_LABEL[row.original.kind]}</span>,
    },
    {
      accessorKey: 'code', header: 'Κωδικός', size: 90,
      cell: ({ row }) => <span className="font-mono text-[12px] tabular-nums text-muted-foreground">{row.original.code}</span>,
    },
    {
      accessorKey: 'name', header: 'Περιγραφή', size: 420,
      cell: ({ row }) => <span className="text-[12px] font-medium text-foreground">{row.original.name}</span>,
    },
    {
      accessorKey: 'myDataCode', header: 'Χαρακτηρισμός ΑΑΔΕ', size: 200,
      cell: ({ row }) => (row.original.myDataCode
        ? <span className="font-mono text-[12px] text-muted-foreground">{row.original.myDataCode}</span>
        : DASH),
    },
    {
      accessorKey: 'sotype', header: 'SOTYPE', size: 90,
      cell: ({ row }) => <span className="font-mono text-[12px] tabular-nums text-muted-foreground">{row.original.sotype}</span>,
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
        Λίστες αναφοράς. Ο χαρακτηρισμός μιας γραμμής δεν επιλέγεται εδώ: τον κουβαλά το μητρώο του
        είδους / της υπηρεσίας / της χρεοπίστωσης / του εξόδου στο SoftOne. Αν ένας χαρακτηρισμός
        είναι λάθος, διορθώνεται στο ίδιο το ERP.
      </p>
      <DataTable
        columns={columns}
        data={rows}
        searchKey="name"
        searchPlaceholder="Αναζήτηση (περιγραφή, χαρακτηρισμός…)"
        persistKey="admin.mydataclasses.table.v1"
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
