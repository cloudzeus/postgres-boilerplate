'use client';

import * as React from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { FiCheck, FiX } from 'react-icons/fi';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';

type Row = {
  code: string; description: string;
  parentCode: string | null; category: string | null;
  isActive: boolean;
};

export function KadCodesTable({ rows }: { rows: Row[] }) {
  const columns: ColumnDef<Row>[] = [
    {
      accessorKey: 'code', header: 'ΚΑΔ', size: 110,
      cell: ({ row }) => <span className="font-mono text-[12px] tabular-nums">{row.original.code}</span>,
    },
    {
      accessorKey: 'description', header: 'Περιγραφή', size: 520,
      cell: ({ row }) => <span className="text-[12px] text-foreground">{row.original.description}</span>,
    },
    {
      accessorKey: 'parentCode', header: 'Τμήμα', size: 80,
      cell: ({ row }) => <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{row.original.parentCode ?? '—'}</span>,
    },
    {
      accessorKey: 'isActive', header: 'Κατάσταση', size: 110,
      cell: ({ row }) => row.original.isActive
        ? <Badge variant="outline" className="border-emerald-300 text-emerald-700"><FiCheck /> Ενεργός</Badge>
        : <Badge variant="outline"><FiX /> Ανενεργός</Badge>,
    },
  ];

  return <DataTable columns={columns} data={rows} searchPlaceholder="Αναζήτηση ΚΑΔ ή περιγραφής..." />;
}
