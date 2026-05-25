'use client';

import { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';

type AuditRow = {
  id: string; userEmail: string; action: string; resource: string;
  resourceId: string; metadata: string; ip: string; createdAt: string;
};

const actionColor = (a: string): 'default' | 'secondary' | 'destructive' | 'outline' => {
  if (a.endsWith('.delete')) return 'destructive';
  if (a.endsWith('.create')) return 'default';
  if (a.endsWith('.update') || a.endsWith('.assign_role') || a.endsWith('.password_reset')) return 'secondary';
  return 'outline';
};

export function AuditTable({ rows }: { rows: AuditRow[] }) {
  const columns: ColumnDef<AuditRow>[] = [
    {
      accessorKey: 'createdAt', header: 'Πότε', size: 160,
      cell: ({ row }) => (
        <span className="text-muted-foreground tabular-nums text-[12px]">
          {new Date(row.original.createdAt).toLocaleString('el-GR')}
        </span>
      ),
    },
    {
      accessorKey: 'userEmail', header: 'Χρήστης', size: 220,
      cell: ({ row }) => <span className="text-foreground text-[12px] truncate">{row.original.userEmail}</span>,
    },
    {
      accessorKey: 'action', header: 'Ενέργεια', size: 180,
      cell: ({ row }) => (
        <Badge variant={actionColor(row.original.action) as 'default' | 'secondary' | 'destructive' | 'outline'}>
          {row.original.action}
        </Badge>
      ),
    },
    {
      accessorKey: 'resource', header: 'Resource', size: 100,
      cell: ({ row }) => <span className="text-muted-foreground text-[12px]">{row.original.resource}</span>,
    },
    {
      accessorKey: 'ip', header: 'IP', size: 120,
      cell: ({ row }) => <span className="font-mono text-muted-foreground text-[12px]">{row.original.ip}</span>,
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={rows}
      searchPlaceholder="Αναζήτηση σε audit..."
      expandable={(r) => (
        <div className="grid sm:grid-cols-2 gap-3 text-[12px] px-1">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-0.5">Resource ID</div>
            <div className="font-mono text-foreground truncate">{r.resourceId || '—'}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-0.5">Metadata</div>
            <pre className="font-mono text-[11px] text-foreground bg-muted rounded p-2 overflow-x-auto whitespace-pre-wrap">{r.metadata || '—'}</pre>
          </div>
        </div>
      )}
    />
  );
}
