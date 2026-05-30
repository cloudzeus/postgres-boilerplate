'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { type ColumnDef } from '@tanstack/react-table';
import { FiMoreVertical, FiFile, FiExternalLink, FiSend, FiTrash2, FiEye, FiUserPlus, FiRefreshCw } from 'react-icons/fi';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { OcrRowDetail } from './row-detail';

export interface OcrRow {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  docType: string;
  language: string;
  status: string;
  category: string | null;
  postStatus: string;
  postedRef: string | null;
  createdAt: string;
  thumbUrl: string | null;
  issuer: string | null;
  docNumber: string | null;
  docDate: string | null;
  vatNumber: string | null;
  customerVatNumber: string | null;
  total: number | null;
  extractedData: any;
  errorMessage: string | null;
}

const CATEGORY_LABEL: Record<string, string> = {
  EXPENSE: 'Έξοδο',
  INVOICE_IN: 'Τιμολόγιο αγοράς',
  INVOICE_OUT: 'Τιμολόγιο πώλησης',
  RECEIPT: 'Απόδειξη',
  CREDIT_NOTE: 'Πιστωτικό',
  PAYROLL: 'Μισθοδοσία',
  TAX: 'Φόρος',
  OTHER: 'Άλλο',
};

const DOC_LABEL: Record<string, string> = {
  INVOICE: 'Τιμολόγιο', RECEIPT: 'Απόδειξη', GENERAL_TEXT: 'Κείμενο',
};

const POST_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  POSTED: 'default', PENDING: 'secondary', FAILED: 'destructive', NONE: 'outline',
};
const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  COMPLETED: 'default', PROCESSING: 'secondary', PENDING: 'outline', FAILED: 'destructive',
};

function fmtMoney(n: number | null) {
  if (n == null) return '-';
  return new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' }).format(n);
}

export function OcrTable({
  rows, canCategorize, canPost, canDelete, canCreateCompany,
}: {
  rows: OcrRow[];
  canCategorize: boolean;
  canPost: boolean;
  canDelete: boolean;
  canCreateCompany: boolean;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [reextractingId, setReextractingId] = React.useState<string | null>(null);

  async function handlePost(row: OcrRow) {
    if (!row.category) { toast.error('Όρισε πρώτα κατηγορία (κάνε expand τη γραμμή).'); return; }
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/admin/ocr/${row.id}/post-softone`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      toast.success(`Αναρτήθηκε στο SoftOne (ref: ${json.ref})`);
      router.refresh();
    } catch (err: any) {
      toast.error(`Αποτυχία ανάρτησης: ${err?.message ?? err}`);
    } finally {
      setBusyId(null);
    }
  }

  async function handleReextract(row: OcrRow) {
    if (!confirm('Επανασκανάρισμα με ισχυρότερο μοντέλο (gemini-2.5-pro);\nΠιο αργό & ακριβό, αλλά αποδίδει καλύτερα σε δύσκολα scans.')) return;
    setReextractingId(row.id);
    // Mark row as PROCESSING in UI right away so the progress bar appears.
    router.refresh();
    try {
      const res = await fetch(`/api/admin/ocr/${row.id}/reextract`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      toast.success(`Επανασκανάρισμα ΟΚ (${json.model})`);
      router.refresh();
    } catch (err: any) {
      toast.error(`Αποτυχία: ${err?.message ?? err}`);
      router.refresh();
    } finally {
      setReextractingId(null);
    }
  }

  async function handleCreateCompany(row: OcrRow, role: 'SUPPLIER' | 'CUSTOMER') {
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/admin/ocr/${row.id}/create-supplier?role=${role}`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      const name = json.company?.name ?? '';
      const noun = role === 'CUSTOMER' ? 'πελάτης' : 'προμηθευτής';
      toast.success(json.reused ? `Υπήρχε ήδη: ${name}` : `Δημιουργήθηκε ${noun}: ${name}`);
      router.refresh();
    } catch (err: any) {
      toast.error(`Αποτυχία: ${err?.message ?? err}`);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(row: OcrRow) {
    if (!confirm(`Διαγραφή του εγγράφου "${row.fileName}";`)) return;
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/admin/ocr/${row.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Διαγράφηκε');
      router.refresh();
    } catch (err: any) {
      toast.error(`Αποτυχία διαγραφής: ${err?.message ?? err}`);
    } finally {
      setBusyId(null);
    }
  }

  const columns: ColumnDef<OcrRow>[] = React.useMemo(() => [
    {
      id: 'thumb',
      header: '',
      size: 56,
      cell: ({ row }) => {
        const r = row.original;
        return (
          <button
            type="button"
            onClick={() => row.toggleExpanded()}
            className="block size-10 overflow-hidden rounded-md border border-border bg-muted/40 hover:ring-2 hover:ring-primary/40 transition"
            aria-label="Toggle"
          >
            {r.thumbUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.thumbUrl} alt="" className="size-full object-cover" />
            ) : (
              <span className="flex size-full items-center justify-center text-muted-foreground">
                <FiFile className="size-4" />
              </span>
            )}
          </button>
        );
      },
    },
    {
      accessorKey: 'fileName',
      header: 'Αρχείο',
      cell: ({ row }) => {
        const r = row.original;
        return (
          <button type="button" onClick={() => row.toggleExpanded()} className="text-left">
            <div className="truncate font-medium text-foreground hover:underline">{r.fileName}</div>
            <div className="text-xs text-muted-foreground">
              {DOC_LABEL[r.docType] ?? r.docType} · {r.language.toUpperCase()} · {new Date(r.createdAt).toLocaleString('el-GR')}
            </div>
          </button>
        );
      },
    },
    {
      accessorKey: 'issuer',
      header: 'Εκδότης / Τίτλος',
      cell: ({ row }) => row.original.issuer ?? <span className="text-muted-foreground">-</span>,
    },
    {
      accessorKey: 'docNumber',
      header: 'Αρ. Παραστατικού',
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.docNumber ?? '-'}</span>
      ),
    },
    {
      accessorKey: 'docDate',
      header: 'Ημερομηνία',
      cell: ({ row }) => row.original.docDate ?? <span className="text-muted-foreground">-</span>,
    },
    {
      accessorKey: 'vatNumber',
      header: 'ΑΦΜ',
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.vatNumber ?? '-'}</span>,
    },
    {
      accessorKey: 'total',
      header: () => <span className="block text-right">Σύνολο</span>,
      cell: ({ row }) => <span className="block text-right font-semibold">{fmtMoney(row.original.total)}</span>,
    },
    {
      accessorKey: 'category',
      header: 'Κατηγορία',
      cell: ({ row }) => row.original.category
        ? <Badge variant="outline">{CATEGORY_LABEL[row.original.category] ?? row.original.category}</Badge>
        : <span className="text-xs text-muted-foreground">—</span>,
    },
    {
      accessorKey: 'status',
      header: 'OCR',
      cell: ({ row }) => {
        const r = row.original;
        const isProcessing = r.status === 'PROCESSING' || reextractingId === r.id;
        if (isProcessing) {
          return (
            <div className="flex flex-col gap-1 min-w-[120px]">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-sisyphus-600">
                <span className="inline-block size-1.5 animate-pulse rounded-full bg-sisyphus-500" />
                Σκανάρισμα HQ…
              </div>
              <div className="relative h-1 overflow-hidden rounded-full bg-neutral-8">
                <div className="absolute inset-y-0 w-1/3 animate-[ocrProgress_1.4s_ease-in-out_infinite] rounded-full bg-sisyphus-500" />
              </div>
            </div>
          );
        }
        return <Badge variant={STATUS_VARIANT[r.status] ?? 'outline'}>{r.status}</Badge>;
      },
    },
    {
      accessorKey: 'postStatus',
      header: 'SoftOne',
      cell: ({ row }) => {
        const r = row.original;
        if (r.postStatus === 'NONE') return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <div className="flex flex-col items-start gap-0.5">
            <Badge variant={POST_VARIANT[r.postStatus] ?? 'outline'}>{r.postStatus}</Badge>
            {r.postedRef && <span className="font-mono text-[10px] text-muted-foreground">{r.postedRef}</span>}
          </div>
        );
      },
    },
    {
      id: 'actions',
      header: '',
      size: 48,
      cell: ({ row }) => {
        const r = row.original;
        const disabled = busyId === r.id;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={disabled}
              className="inline-flex size-7 items-center justify-center rounded-md border border-transparent hover:bg-muted hover:border-border disabled:opacity-50"
              aria-label="Ενέργειες"
            >
              <FiMoreVertical className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Ενέργειες</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => row.toggleExpanded()}>
                <FiEye className="size-4" /> Προβολή / Κατηγοριοποίηση
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleReextract(r)}
                disabled={r.status === 'PROCESSING'}
              >
                <FiRefreshCw className="size-4" /> Επανασκανάρισμα παραστατικού (HQ)
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={`/api/admin/ocr/${r.id}/file`} target="_blank" rel="noreferrer">
                  <FiExternalLink className="size-4" /> Άνοιγμα πρωτότυπου
                </a>
              </DropdownMenuItem>
              {canCreateCompany && (
                <>
                  <DropdownMenuItem
                    onClick={() => handleCreateCompany(r, 'SUPPLIER')}
                    disabled={r.status !== 'COMPLETED' || !r.vatNumber}
                  >
                    <FiUserPlus className="size-4" /> Προσθήκη Προμηθευτή (ΑΑΔΕ)
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleCreateCompany(r, 'CUSTOMER')}
                    disabled={r.status !== 'COMPLETED' || !r.customerVatNumber}
                  >
                    <FiUserPlus className="size-4" /> Προσθήκη Πελάτη (ΑΑΔΕ)
                  </DropdownMenuItem>
                </>
              )}
              {canPost && (
                <DropdownMenuItem
                  onClick={() => handlePost(r)}
                  disabled={r.status !== 'COMPLETED' || r.postStatus === 'POSTED'}
                >
                  <FiSend className="size-4" /> Ανάρτηση στο SoftOne
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
  ], [busyId, canPost, canDelete, reextractingId]);

  return (
    <DataTable
      columns={columns}
      data={rows}
      searchKey="fileName"
      searchPlaceholder="Αναζήτηση εγγράφου…"
      persistKey="admin.ocr.table.v1"
      enableSelection
      expandable={(row) => (
        <OcrRowDetail row={row} canCategorize={canCategorize} canPost={canPost} />
      )}
    />
  );
}
