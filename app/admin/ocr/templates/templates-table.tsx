'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { type ColumnDef } from '@tanstack/react-table';
import { FiEdit3, FiTrash2 } from 'react-icons/fi';
import { toast } from 'sonner';
import { DataTable, RowActionsTrigger } from '@/components/ui/data-table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { MODE_LABEL, STATUS_LABEL } from '@/lib/templates/labels';
import { templatesApi, errorMessage } from '@/components/templates/api';

export type TemplateRow = {
  id: string; name: string; vatNumber: string; supplierName: string | null; docType: string;
  mode: 'AUTO' | 'SEMI_AUTO' | 'MANUAL'; status: 'DRAFT' | 'ACTIVE'; version: number;
  fieldsCount: number; runsCount: number; timesUsed: number; hasSample: boolean; updatedAt: string;
};

// Inline hex (DG palette) so the JIT never purges them.
const MODE_STYLE: Record<TemplateRow['mode'], { bg: string; fg: string }> = {
  AUTO: { bg: '#E8F7F0', fg: '#047857' }, SEMI_AUTO: { bg: '#EAF4FC', fg: '#0078D4' }, MANUAL: { bg: '#F3F2F1', fg: '#5C5C5C' },
};
const STATUS_STYLE = { ACTIVE: { bg: '#E8F7F0', fg: '#047857' }, DRAFT: { bg: '#FDF3E3', fg: '#B45309' } } as const;

const Pill = ({ text, bg, fg }: { text: string; bg: string; fg: string }) => (
  <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: bg, color: fg }}>{text}</span>
);

export function TemplatesTable({ rows, canManage }: { rows: TemplateRow[]; canManage: boolean }) {
  const router = useRouter();
  const remove = async (r: TemplateRow) => {
    if (!confirm(`Διαγραφή του προτύπου «${r.name}»;`)) return;
    try { await templatesApi.remove(r.id); toast.success('Διαγράφηκε'); router.refresh(); }
    catch (e) { toast.error(errorMessage(e)); }
  };
  const columns = React.useMemo<ColumnDef<TemplateRow>[]>(() => [
    { accessorKey: 'supplierName', header: 'Προμηθευτής', size: 260, cell: ({ row }) => (
      <div className="min-w-0"><div className="truncate text-[12px] font-medium">{row.original.supplierName || '—'}</div><div className="font-mono text-[10px] text-muted-foreground">{row.original.vatNumber}</div></div>) },
    // Hidden by default: the ΑΦΜ is already printed under the supplier name, but the
    // global filter only sees accessor columns — without this the placeholder lies.
    { accessorKey: 'vatNumber', header: 'ΑΦΜ', size: 110, enableHiding: true, cell: ({ row }) => <span className="font-mono text-[12px]">{row.original.vatNumber}</span> },
    { accessorKey: 'name', header: 'Πρότυπο', size: 220, cell: ({ row }) => <button type="button" onClick={() => router.push(`/admin/ocr/templates/${row.original.id}`)} className="cursor-pointer text-[13px] font-medium text-sisyphus-700 hover:underline">{row.original.name}</button> },
    { accessorKey: 'docType', header: 'Τύπος', size: 100, cell: ({ row }) => <span className="text-[12px]">{row.original.docType === 'RECEIPT' ? 'Απόδειξη' : 'Τιμολόγιο'}</span> },
    { accessorKey: 'mode', header: 'Λειτουργία', size: 120, cell: ({ row }) => <Pill text={MODE_LABEL[row.original.mode]} {...MODE_STYLE[row.original.mode]} /> },
    { accessorKey: 'status', header: 'Κατάσταση', size: 100, cell: ({ row }) => <Pill text={STATUS_LABEL[row.original.status]} {...STATUS_STYLE[row.original.status]} /> },
    { accessorKey: 'fieldsCount', header: 'Πεδία', size: 70, cell: ({ row }) => <span className="tabular-nums">{row.original.fieldsCount}</span> },
    { accessorKey: 'timesUsed', header: 'Χρήσεις', size: 80, cell: ({ row }) => <span className="tabular-nums">{row.original.timesUsed}</span> },
    { accessorKey: 'updatedAt', header: 'Ενημ.', size: 110, cell: ({ row }) => <span className="text-[11px] text-muted-foreground">{new Date(row.original.updatedAt).toLocaleDateString('el-GR')}</span> },
    { id: 'actions', header: '', size: 48, enableSorting: false, cell: ({ row }) => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild><RowActionsTrigger /></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => router.push(`/admin/ocr/templates/${row.original.id}`)}><FiEdit3 /> Άνοιγμα</DropdownMenuItem>
          {canManage && <DropdownMenuItem onClick={() => remove(row.original)} className="text-dg-red-600"><FiTrash2 /> Διαγραφή</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>) },
  ], [canManage, router]);

  return (
    <DataTable
      columns={columns}
      data={rows}
      searchKey="name"
      searchPlaceholder="Αναζήτηση (προμηθευτής, ΑΦΜ, πρότυπο…)"
      persistKey="admin.templates.table.v1"
      initialColumnVisibility={{ vatNumber: false }}
      emptyState="Δεν υπάρχουν πρότυπα. Πάτησε «Νέο πρότυπο»."
    />
  );
}
