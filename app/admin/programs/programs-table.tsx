'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { type ColumnDef } from '@tanstack/react-table';
import {
  FiMoreVertical, FiEdit3, FiRefreshCw, FiTrash2, FiExternalLink, FiFile,
  FiClock, FiCheckCircle,
} from 'react-icons/fi';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

export interface ProgramRow {
  id: string;
  title: string;
  referenceCode: string | null;
  summary: string | null;
  publicationDate: string | null;
  submissionStart: string | null;
  submissionEnd:   string | null;
  totalBudget: number | null;
  fundingRate: number | null;
  durationMonths: number | null;
  status: string;
  extractStatus: string;
  errorMessage: string | null;
  sourceFileName: string | null;
  createdAt: string;
  kadCount: number;
  expenseCount: number;
  regionCount: number;
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Πρόχειρο', REVIEWING: 'Σε επεξεργασία', PUBLISHED: 'Δημοσιευμένο', ARCHIVED: 'Αρχείο',
};
const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  DRAFT: 'outline', REVIEWING: 'secondary', PUBLISHED: 'default', ARCHIVED: 'outline',
};
const EXTRACT_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  COMPLETED: 'default', PROCESSING: 'secondary', PENDING: 'outline', FAILED: 'destructive',
};

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('el-GR');
}
function fmtMoney(v: number | null) {
  if (v == null) return '—';
  return new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
}
function fmtPct(v: number | null) {
  if (v == null) return '—';
  return `${Number(v).toFixed(0)}%`;
}

/** Compute deadline distance and color. */
function deadlineState(end: string | null): { label: string; tone: 'green' | 'amber' | 'red' | 'gray' } {
  if (!end) return { label: '—', tone: 'gray' };
  const t = new Date(end).getTime() - Date.now();
  if (Number.isNaN(t)) return { label: '—', tone: 'gray' };
  const days = Math.ceil(t / (24 * 3600 * 1000));
  if (days < 0)  return { label: `Έληξε πριν ${-days}η`, tone: 'red' };
  if (days <= 7) return { label: `${days}η μέχρι λήξης`, tone: 'red' };
  if (days <= 30) return { label: `${days}η μέχρι λήξης`, tone: 'amber' };
  return { label: `${days}η μέχρι λήξης`, tone: 'green' };
}

export function ProgramsTable({
  rows, canUpdate, canDelete, canCreate,
}: {
  rows: ProgramRow[];
  canUpdate: boolean;
  canDelete: boolean;
  canCreate: boolean;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = React.useState<string | null>(null);

  async function handleReextract(row: ProgramRow) {
    if (!confirm('Επανεκτέλεση ανάλυσης από το αρχικό PDF;\nΗ τρέχουσα εξαγωγή θα αντικατασταθεί (διατηρούνται status & σημειώσεις).')) return;
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/admin/programs/${row.id}/reextract`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      toast.success(`Επανεκτέλεση ΟΚ (${json.model})`);
      router.refresh();
    } catch (err: any) {
      toast.error(`Αποτυχία: ${err?.message ?? err}`);
      router.refresh();
    } finally { setBusyId(null); }
  }

  async function handleDelete(row: ProgramRow) {
    if (!confirm(`Διαγραφή προγράμματος "${row.title}" και του PDF του;`)) return;
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/admin/programs/${row.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Διαγράφηκε');
      router.refresh();
    } catch (err: any) {
      toast.error(`Αποτυχία: ${err?.message ?? err}`);
    } finally { setBusyId(null); }
  }

  const columns: ColumnDef<ProgramRow>[] = React.useMemo(() => [
    {
      accessorKey: 'title',
      header: 'Πρόσκληση',
      cell: ({ row }) => {
        const r = row.original;
        return (
          <Link
            href={`/admin/programs/${r.id}`}
            className="block group"
          >
            <div className="flex items-start gap-3">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-sisyphus-500/10 text-sisyphus-600 group-hover:bg-sisyphus-500/20 transition">
                <FiFile className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 font-medium text-foreground group-hover:text-sisyphus-600 group-hover:underline">
                  {r.title}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                  {r.referenceCode && <span className="font-mono">{r.referenceCode}</span>}
                  {r.referenceCode && <span className="text-border">·</span>}
                  <span className="tabular-nums">{new Date(r.createdAt).toLocaleDateString('el-GR')}</span>
                </div>
              </div>
            </div>
          </Link>
        );
      },
    },
    {
      id: 'deadline',
      header: 'Προθεσμία',
      cell: ({ row }) => {
        const r = row.original;
        const d = deadlineState(r.submissionEnd);
        const toneMap = {
          green: 'text-emerald-700 bg-emerald-500/10 border-emerald-500/30',
          amber: 'text-amber-700 bg-amber-500/10 border-amber-500/30',
          red:   'text-dg-red-700 bg-dg-red-500/10 border-dg-red-500/30',
          gray:  'text-muted-foreground bg-neutral-8 border-border',
        } as const;
        return (
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-[12px] tabular-nums">{fmtDate(r.submissionEnd)}</span>
            <span className={`inline-flex w-fit items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-medium ${toneMap[d.tone]}`}>
              <FiClock className="size-2.5" /> {d.label}
            </span>
          </div>
        );
      },
    },
    {
      accessorKey: 'totalBudget',
      header: () => <span className="block text-right">Π/Υ</span>,
      cell: ({ row }) => <span className="block text-right font-semibold tabular-nums">{fmtMoney(row.original.totalBudget)}</span>,
    },
    {
      accessorKey: 'fundingRate',
      header: () => <span className="block text-right">Επιχ.</span>,
      cell: ({ row }) => {
        const v = row.original.fundingRate;
        if (v == null) return <span className="block text-right text-muted-foreground">—</span>;
        return (
          <div className="flex items-center justify-end gap-1.5">
            <div className="h-1 w-10 rounded-full bg-neutral-8 overflow-hidden">
              <div className="h-full rounded-full bg-sisyphus-500" style={{ width: `${Math.min(100, v)}%` }} />
            </div>
            <span className="text-[12px] font-medium tabular-nums">{fmtPct(v)}</span>
          </div>
        );
      },
    },
    {
      id: 'counts',
      header: 'Συντελεστές',
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="flex gap-1.5 text-[11px]">
            <span className="inline-flex items-center gap-0.5 rounded-sm bg-neutral-8 px-1.5 py-0.5 font-mono">ΚΑΔ <strong className="text-foreground">{r.kadCount}</strong></span>
            <span className="inline-flex items-center gap-0.5 rounded-sm bg-neutral-8 px-1.5 py-0.5 font-mono">Δαπ. <strong className="text-foreground">{r.expenseCount}</strong></span>
            <span className="inline-flex items-center gap-0.5 rounded-sm bg-neutral-8 px-1.5 py-0.5 font-mono">Περ. <strong className="text-foreground">{r.regionCount}</strong></span>
          </div>
        );
      },
    },
    {
      accessorKey: 'status',
      header: 'Κατάσταση',
      cell: ({ row }) => (
        <div className="flex flex-col items-start gap-1">
          <Badge variant={STATUS_VARIANT[row.original.status] ?? 'outline'}>
            {STATUS_LABEL[row.original.status] ?? row.original.status}
          </Badge>
          {row.original.extractStatus !== 'COMPLETED' && (
            <Badge variant={EXTRACT_VARIANT[row.original.extractStatus] ?? 'outline'}>
              {row.original.extractStatus === 'PROCESSING' ? 'Σκανάρισμα…' : row.original.extractStatus}
            </Badge>
          )}
        </div>
      ),
    },
    {
      id: 'actions',
      header: '',
      size: 48,
      cell: ({ row }) => {
        const r = row.original;
        const isBusy = busyId === r.id || r.extractStatus === 'PROCESSING';
        return (
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={isBusy}
              className="inline-flex size-8 items-center justify-center rounded-md border border-transparent text-muted-foreground transition hover:border-border hover:bg-neutral-8 hover:text-foreground disabled:opacity-50"
              aria-label="Ενέργειες"
            >
              {isBusy ? <FiRefreshCw className="size-3.5 animate-spin" /> : <FiMoreVertical className="size-4" />}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[220px]">
              <DropdownMenuLabel>Ενέργειες</DropdownMenuLabel>
              <DropdownMenuItem asChild>
                <Link href={`/admin/programs/${r.id}`}>
                  <FiEdit3 className="size-4" /> Επεξεργασία
                </Link>
              </DropdownMenuItem>
              {r.sourceFileName && (
                <DropdownMenuItem asChild>
                  <a href={`/api/admin/programs/${r.id}/file`} target="_blank" rel="noreferrer">
                    <FiExternalLink className="size-4" /> Άνοιγμα PDF
                  </a>
                </DropdownMenuItem>
              )}
              {canCreate && (
                <DropdownMenuItem onClick={() => handleReextract(r)} disabled={isBusy}>
                  <FiRefreshCw className="size-4" /> Επανανάλυση (HQ)
                </DropdownMenuItem>
              )}
              {canDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => handleDelete(r)}>
                    <FiTrash2 className="size-4" /> Διαγραφή
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [busyId, canCreate, canDelete, canUpdate]);

  return (
    <DataTable
      columns={columns}
      data={rows}
      searchKey="title"
      searchPlaceholder="Αναζήτηση προγράμματος…"
      persistKey="admin.programs.table.v1"
      emptyState={
        <div className="px-4 py-12 text-center">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-sisyphus-500/10 text-sisyphus-600">
            <FiCheckCircle className="size-5" />
          </div>
          <p className="text-sm font-medium text-foreground">Καμία πρόσκληση ακόμη</p>
          <p className="mt-1 text-xs text-muted-foreground">Σύρε ένα PDF προσκλήσεως ΕΣΠΑ/EU στην παραπάνω περιοχή για να ξεκινήσει η ανάλυση.</p>
        </div>
      }
    />
  );
}
