'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { type ColumnDef } from '@tanstack/react-table';
import { FiMoreVertical, FiFile, FiExternalLink, FiSend, FiTrash2, FiEye, FiUserPlus, FiRefreshCw, FiSearch, FiCheck, FiChevronDown, FiChevronRight, FiAlertCircle, FiCheckCircle, FiSlash, FiRotateCcw } from 'react-icons/fi';
import { SoftoneAfmDialog } from '@/components/admin/softone-afm-dialog';
import { OcrDayProblemsModal } from '@/components/admin/ocr-day-problems-modal';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { reconMeta } from '@/lib/ocr/recon-status';
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
  softoneTrdr: number | null;
  softoneCode: string | null;
  softoneName: string | null;
  softoneKind: string | null;
  softoneChecked: string | null;
  softoneDocExists: boolean | null;
  reconOverride: string | null;
  itemsTotal: number | null;
  itemsMatched: number | null;
  softoneSeries: string | null;
}

/** A SoftOne purchase document SERIES (PurchaseDocType) offered in the «Τύπος παραστατικού» picker. */
export interface SeriesOption {
  code: string;
  abbrev: string | null;
  name: string;
  section: string | null;
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

/** Stable per-day key in the user's local timezone (YYYY-MM-DD). */
function localDayKey(iso: string) {
  const d = new Date(iso);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Greek long date label from a YYYY-MM-DD key, parsed as local date. */
function greekDayLabel(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('el-GR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

/* ------------------------------------------------------------------ */
/* Duplicate-invoice detection                                         */
/* Same invoice scanned multiple times is allowed. Two scans are the   */
/* same invoice when their ΜΑΡΚ ΑΑΔΕ matches, or — when no ΜΑΡΚ — when  */
/* both Αρ. Τιμολογίου and Ημερομηνία match.                           */
/* ------------------------------------------------------------------ */

/** Stable invoice fingerprint, or null when the row lacks enough data to dedupe. */
function invoiceFingerprint(r: OcrRow): string | null {
  const mark = String(r.extractedData?.aadeMark ?? '').trim();
  if (mark) return `mark:${mark.toUpperCase()}`;
  const num = String(r.docNumber ?? '').trim().toUpperCase();
  const date = String(r.docDate ?? '').trim();
  if (num && date) return `num:${num}|${date}`;
  return null;
}

/** Distinct invoices among a set of rows (rows with no fingerprint each count as one). */
function uniqueInvoiceCount(rows: OcrRow[]): number {
  const seen = new Set<string>();
  let standalone = 0;
  for (const r of rows) {
    const fp = invoiceFingerprint(r);
    if (fp) seen.add(fp); else standalone++;
  }
  return seen.size + standalone;
}

export function OcrTable({
  rows, canCategorize, canPost, canDelete, canCreateCompany, seriesOptions = [],
}: {
  rows: OcrRow[];
  canCategorize: boolean;
  canPost: boolean;
  canDelete: boolean;
  canCreateCompany: boolean;
  seriesOptions?: SeriesOption[];
}) {
  const router = useRouter();

  // Map of row id → its position within a set of identical-invoice scans.
  // The oldest scan is the "original" (ordinal 1); later scans are flagged copies.
  const dupInfo = React.useMemo(() => {
    const groups = new Map<string, OcrRow[]>();
    for (const r of rows) {
      const fp = invoiceFingerprint(r);
      if (!fp) continue;
      const list = groups.get(fp);
      if (list) list.push(r); else groups.set(fp, [r]);
    }
    const info = new Map<string, { ordinal: number; total: number }>();
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      // Oldest first → ordinal 1 is the original scan.
      const sorted = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      sorted.forEach((r, i) => info.set(r.id, { ordinal: i + 1, total: sorted.length }));
    }
    return info;
  }, [rows]);

  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [reextractingId, setReextractingId] = React.useState<string | null>(null);
  const [lookupAfm, setLookupAfm] = React.useState<string | null>(null);
  const [lookupCtx, setLookupCtx] = React.useState<string | undefined>(undefined);
  const [problemsDay, setProblemsDay] = React.useState<{ label: string; rows: OcrRow[] } | null>(null);

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

  // Hybrid status override: lock a document as RESOLVED / IGNORED, or null = back to auto.
  async function handleOverride(row: OcrRow, value: 'RESOLVED' | 'IGNORED' | null) {
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/admin/ocr/${row.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reconOverride: value }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(value === 'RESOLVED' ? 'Σημειώθηκε ως ολοκληρωμένο' : value === 'IGNORED' ? 'Αγνοήθηκε' : 'Επαναφορά σε αυτόματο');
      router.refresh();
    } catch (err: any) {
      toast.error(`Αποτυχία: ${err?.message ?? err}`);
    } finally {
      setBusyId(null);
    }
  }

  // ---- Day-level (group header) bulk actions ----
  async function handleBulkPost(dayRows: OcrRow[]) {
    const ready = dayRows.filter((r) => reconMeta(r).status === 'READY');
    if (ready.length === 0) { toast.info('Κανένα έτοιμο προς ανάρτηση παραστατικό αυτή την ημέρα.'); return; }
    if (!confirm(`Ανάρτηση ${ready.length} παραστατικών στο SoftOne;`)) return;
    const t = toast.loading(`Ανάρτηση 0/${ready.length}…`);
    let ok = 0, fail = 0;
    for (const r of ready) {
      try {
        const res = await fetch(`/api/admin/ocr/${r.id}/post-softone`, { method: 'POST' });
        if (!res.ok) throw new Error();
        ok++;
      } catch { fail++; }
      toast.loading(`Ανάρτηση ${ok + fail}/${ready.length}…`, { id: t });
    }
    toast.success(`Ολοκληρώθηκε: ${ok} επιτυχία${fail ? `, ${fail} αποτυχία` : ''}`, { id: t });
    router.refresh();
  }

  async function handleBulkDelete(dayRows: OcrRow[], label: string) {
    if (!confirm(`Διαγραφή ΟΛΩΝ των ${dayRows.length} παραστατικών της ${label};\nΑυτή η ενέργεια δεν αναιρείται.`)) return;
    const t = toast.loading(`Διαγραφή 0/${dayRows.length}…`);
    let ok = 0, fail = 0;
    for (const r of dayRows) {
      try {
        const res = await fetch(`/api/admin/ocr/${r.id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error();
        ok++;
      } catch { fail++; }
      toast.loading(`Διαγραφή ${ok + fail}/${dayRows.length}…`, { id: t });
    }
    toast.success(`Διαγράφηκαν: ${ok}${fail ? `, ${fail} αποτυχία` : ''}`, { id: t });
    router.refresh();
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
        const dup = dupInfo.get(r.id);
        const isCopy = dup && dup.ordinal > 1;
        return (
          <button type="button" onClick={() => row.toggleExpanded()} className="text-left">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-medium text-foreground hover:underline">{r.fileName}</span>
              {isCopy && (
                <span
                  className="inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold"
                  style={{ backgroundColor: '#FEF3C7', color: '#92400E', borderColor: '#FDE68A' }}
                  title="Το ίδιο τιμολόγιο έχει σαρωθεί ξανά (ίδιο ΜΑΡΚ ΑΑΔΕ ή ίδιος αριθμός + ημερομηνία)"
                >
                  Διπλότυπο {dup!.ordinal}/{dup!.total}
                </span>
              )}
            </div>
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
      id: 'softone',
      header: 'SoftOne',
      cell: ({ row }) => {
        const r = row.original;
        if (r.softoneTrdr) {
          // Προμηθευτής = πράσινο, Πιστωτής = πορτοκαλί.
          const isCreditor = r.softoneKind === 'Πιστωτής';
          const st = isCreditor
            ? { bg: '#FFF1E6', fg: '#C2410C', bd: '#FFD8B5' }
            : { bg: '#ECFDF5', fg: '#047857', bd: '#A7F3D0' };
          return (
            <div className="flex flex-col items-start gap-0.5 min-w-[110px]" title={`${r.softoneName ?? ''} (TRDR ${r.softoneTrdr})`}>
              <span
                className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold"
                style={{ backgroundColor: st.bg, color: st.fg, borderColor: st.bd }}
              >
                <FiCheck className="size-3" /> {r.softoneKind ?? 'SoftOne'}
              </span>
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{r.softoneCode ?? r.softoneTrdr}</span>
            </div>
          );
        }
        if (r.softoneChecked) {
          return (
            <span
              className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-medium"
              style={{ backgroundColor: '#FFF8EE', color: '#92400E', borderColor: '#FCD9A8' }}
              title="Δεν βρέθηκε προμηθευτής με αυτό το ΑΦΜ στο SoftOne"
            >
              Δεν βρέθηκε
            </span>
          );
        }
        return <span className="text-xs text-muted-foreground">—</span>;
      },
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
      id: 'recon',
      header: 'Κατάσταση',
      cell: ({ row }) => {
        const m = reconMeta(row.original);
        return (
          <span
            className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold"
            style={{ backgroundColor: m.tone.bg, color: m.tone.fg, borderColor: m.tone.bd }}
            title={m.problem ?? m.label}
          >
            {m.pending && <span className="inline-block size-1.5 rounded-full" style={{ backgroundColor: m.tone.fg }} />}
            {m.label}
          </span>
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
              <DropdownMenuItem
                onClick={() => { setLookupCtx(r.vatNumber ? `Εκδότης ${r.vatNumber}` : undefined); setLookupAfm(r.vatNumber); }}
                disabled={!r.vatNumber}
              >
                <FiSearch className="size-4" /> Έλεγχος ΑΦΜ στο SoftOne
              </DropdownMenuItem>
              {r.customerVatNumber && r.customerVatNumber !== r.vatNumber && (
                <DropdownMenuItem
                  onClick={() => { setLookupCtx(`Πελάτης ${r.customerVatNumber}`); setLookupAfm(r.customerVatNumber); }}
                >
                  <FiSearch className="size-4" /> Έλεγχος ΑΦΜ πελάτη στο SoftOne
                </DropdownMenuItem>
              )}
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
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Εκκρεμότητα</DropdownMenuLabel>
              {r.reconOverride ? (
                <DropdownMenuItem onClick={() => handleOverride(r, null)}>
                  <FiRotateCcw className="size-4" /> Επαναφορά σε αυτόματο
                </DropdownMenuItem>
              ) : (
                <>
                  <DropdownMenuItem onClick={() => handleOverride(r, 'RESOLVED')}>
                    <FiCheckCircle className="size-4" /> Σήμανση ως ολοκληρωμένο
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleOverride(r, 'IGNORED')}>
                    <FiSlash className="size-4" /> Αγνόηση εκκρεμότητας
                  </DropdownMenuItem>
                </>
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
  ], [busyId, canPost, canDelete, reextractingId, dupInfo]);

  return (
    <>
      <DataTable
        columns={columns}
        data={rows}
        searchKey="fileName"
        searchPlaceholder="Αναζήτηση εγγράφου…"
        persistKey="admin.ocr.table.v1"
        enableSelection
        groupBy={{
          getKey: (r) => localDayKey(r.createdAt),
          renderHeader: (key, dayRows, ctx) => {
            const label = greekDayLabel(key);
            const count = dayRows.length;
            const unique = uniqueInvoiceCount(dayRows);
            const pending = dayRows.filter((r) => reconMeta(r).pending).length;
            return (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={ctx.toggleCollapsed}
                  className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10"
                  aria-label={ctx.collapsed ? 'Ανάπτυξη ημέρας' : 'Σύμπτυξη ημέρας'}
                >
                  {ctx.collapsed ? <FiChevronRight className="size-3.5" /> : <FiChevronDown className="size-3.5" />}
                </button>
                <span className="capitalize">{label}</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-sisyphus-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sisyphus-600">
                  {count} {count === 1 ? 'σκανάρισμα' : 'σκαναρίσματα'}
                  {unique !== count && <span className="text-muted-foreground">· {unique} μοναδικά</span>}
                </span>
                {pending > 0 && (
                  <button
                    type="button"
                    onClick={() => setProblemsDay({ label, rows: dayRows })}
                    className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                    style={{ backgroundColor: '#FFF8EE', color: '#92400E', borderColor: '#FCD9A8' }}
                    title="Δες προβλήματα & λύσεις"
                  >
                    <FiAlertCircle className="size-3" /> {pending} {pending === 1 ? 'εκκρεμότητα' : 'εκκρεμότητες'}
                  </button>
                )}
                <div className="ml-auto">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="inline-flex size-6 items-center justify-center rounded-md border border-transparent hover:bg-black/5 dark:hover:bg-white/10 hover:border-border"
                      aria-label="Ενέργειες ημέρας"
                    >
                      <FiMoreVertical className="size-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>{label}</DropdownMenuLabel>
                      <DropdownMenuItem onClick={ctx.toggleCollapsed}>
                        {ctx.collapsed ? <FiChevronRight className="size-4" /> : <FiChevronDown className="size-4" />}
                        {ctx.collapsed ? 'Ανάπτυξη ημέρας' : 'Σύμπτυξη ημέρας'}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setProblemsDay({ label, rows: dayRows })}>
                        <FiAlertCircle className="size-4" /> Προβλήματα & λύσεις
                      </DropdownMenuItem>
                      {canPost && (
                        <DropdownMenuItem onClick={() => handleBulkPost(dayRows)}>
                          <FiSend className="size-4" /> Ανάρτηση όλων (SoftOne)
                        </DropdownMenuItem>
                      )}
                      {canDelete && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onClick={() => handleBulkDelete(dayRows, label)}>
                            <FiTrash2 className="size-4" /> Διαγραφή όλων της ημέρας
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            );
          },
        }}
        expandable={(row) => (
          <OcrRowDetail row={row} canCategorize={canCategorize} canPost={canPost} seriesOptions={seriesOptions} />
        )}
      />
      <SoftoneAfmDialog afm={lookupAfm} contextLabel={lookupCtx} onClose={() => setLookupAfm(null)} />
      <OcrDayProblemsModal
        open={problemsDay !== null}
        onOpenChange={(v) => { if (!v) setProblemsDay(null); }}
        dayLabel={problemsDay?.label ?? ''}
        rows={problemsDay?.rows ?? []}
      />
    </>
  );
}
