'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { type ColumnDef } from '@tanstack/react-table';
import { FiRefreshCw, FiEdit2, FiSlash } from 'react-icons/fi';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { syncErrorMessage } from '@/lib/softone-sync/sync-error';

export type ItemRecord = {
  mtrl: number;
  code: string;
  code1: string | null;
  code2: string | null;
  name: string;
  name2: string | null;
  price: number | null;
  isService: boolean;
  isActive?: boolean;
};

/**
 * Διόρθωση ΥΠΑΡΧΟΥΣΑΣ εγγραφής στο SoftOne: νέος κωδικός ή αδρανοποίηση. Ποτέ διαγραφή — η
 * αδρανοποίηση αναιρείται από το SoftOne, η διαγραφή όχι.
 */
function ItemActions({ row, onDone }: { row: ItemRecord; onDone: () => void }) {
  const [mode, setMode] = React.useState<'code' | 'deactivate' | null>(null);
  const [code, setCode] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const openCode = async () => {
    setMode('code');
    setCode('');
    // Πρόταση από την αρίθμηση της εγκατάστασης — ο χρήστης μπορεί να γράψει άλλον.
    const r = await fetch(`/api/admin/ocr/new-items/next-code?kind=${row.isService ? 'service' : 'product'}`).catch(() => null);
    const d = r?.ok ? await r.json().catch(() => null) : null;
    if (d?.code) setCode((c) => c || String(d.code));
  };

  const submit = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/softone/items/${row.mtrl}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'code' ? { code } : { deactivate: true }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.message ?? 'Η ενημέρωση απέτυχε.'); return; }
      toast.success(mode === 'code'
        ? `Νέος κωδικός ${d.after.code} (ήταν ${d.before.code}) — επαληθεύτηκε στο SoftOne.`
        : `Η εγγραφή ${d.before.code} αδρανοποιήθηκε στο SoftOne.`);
      setMode(null);
      onDone();
    } catch {
      toast.error('Σφάλμα δικτύου — δεν έγινε καμία αλλαγή.');
    } finally { setBusy(false); }
  };

  return (
    <div className="flex justify-end gap-1">
      <button type="button" onClick={openCode} title="Αλλαγή κωδικού στο SoftOne" aria-label={`Αλλαγή κωδικού ${row.code}`}
        className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
        <FiEdit2 className="size-3.5" aria-hidden />
      </button>
      {row.isActive !== false && (
        <button type="button" onClick={() => setMode('deactivate')} title="Αδρανοποίηση στο SoftOne" aria-label={`Αδρανοποίηση ${row.code}`}
          className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive">
          <FiSlash className="size-3.5" aria-hidden />
        </button>
      )}
      <Dialog open={mode !== null} onOpenChange={(o) => { if (!o && !busy) setMode(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{mode === 'code' ? 'Αλλαγή κωδικού' : 'Αδρανοποίηση εγγραφής'}</DialogTitle>
            <DialogDescription>
              {row.code} — {row.name}
            </DialogDescription>
          </DialogHeader>
          {mode === 'code' ? (
            <label className="block space-y-1">
              <span className="text-[length:var(--fs-12)] font-semibold text-foreground">Νέος κωδικός</span>
              <input value={code} onChange={(e) => setCode(e.target.value)} autoFocus
                className="h-10 w-full rounded-md border border-input bg-background px-3 font-mono text-[length:var(--fs-14)]" />
              <span className="block text-[length:var(--fs-11)] text-muted-foreground">
                Ελέγχεται η μάσκα και η μοναδικότητα σε όλο το μητρώο. Οι γραμμές παραστατικών μένουν συνδεδεμένες.
              </span>
            </label>
          ) : (
            <p className="text-[length:var(--fs-13)] text-foreground">
              Η εγγραφή θα γίνει <strong>ανενεργή</strong> στο SoftOne και δεν θα προτείνεται για νέες γραμμές. Δεν διαγράφεται:
              αν χρειαστεί, ενεργοποιείται ξανά από το SoftOne.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMode(null)} disabled={busy}>Άκυρο</Button>
            <Button onClick={submit} disabled={busy || (mode === 'code' && !code.trim())}
              variant={mode === 'deactivate' ? 'destructive' : 'default'}>
              {busy ? 'Αποστολή…' : mode === 'code' ? 'Αλλαγή στο SoftOne' : 'Αδρανοποίηση'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const DASH = <span className="text-muted-foreground/40">—</span>;
const mono = (v: string | null) =>
  v ? <span className="font-mono text-[length:var(--fs-12)] tabular-nums text-muted-foreground">{v}</span> : DASH;

function fmtPrice(n: number | null) {
  if (n == null || n === 0) return DASH;
  return <span className="tabular-nums">{new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' }).format(n)}</span>;
}

export function ItemsTableClient({
  rows,
  variant,
  canManage,
  lastSync,
}: {
  rows: ItemRecord[];
  variant: 'products' | 'services';
  canManage: boolean;
  lastSync: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  const sync = async () => {
    setBusy(true);
    const res = await fetch('/api/admin/metadata/sync-items-softone', { method: 'POST' });
    setBusy(false);
    if (res.ok) {
      const d = await res.json();
      toast.success(`Συγχρονίστηκαν ${d.products.toLocaleString('el-GR')} είδη + ${d.services.toLocaleString('el-GR')} υπηρεσίες`);
      router.refresh();
    } else {
      const e = await res.json().catch(() => ({}));
      toast.error(syncErrorMessage(e, 'Αποτυχία συγχρονισμού'));
    }
  };

  const columns = React.useMemo<ColumnDef<ItemRecord>[]>(() => {
    const base: ColumnDef<ItemRecord>[] = [
      {
        accessorKey: 'code', header: 'Κωδικός', size: 130,
        cell: ({ row }) => <span className="font-mono text-[length:var(--fs-12)] tabular-nums text-foreground">{row.original.code || '—'}</span>,
      },
      {
        accessorKey: 'name', header: 'Περιγραφή', size: 320,
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="font-medium text-foreground text-[length:var(--fs-12)] truncate">
              {row.original.name || '—'}
              {row.original.isActive === false && <span className="ml-1.5 rounded bg-muted px-1.5 py-px text-[length:var(--fs-10)] font-semibold text-muted-foreground">ανενεργό</span>}
            </div>
            {row.original.name2 && <div className="text-[length:var(--fs-10)] text-muted-foreground truncate">{row.original.name2}</div>}
          </div>
        ),
      },
    ];
    // EAN + factory code only matter for products.
    if (variant === 'products') {
      base.push(
        { accessorKey: 'code1', header: 'Barcode / EAN', size: 150, cell: ({ row }) => mono(row.original.code1) },
        { accessorKey: 'code2', header: 'Κωδ. εργοστασίου', size: 160, cell: ({ row }) => mono(row.original.code2) },
      );
    }
    base.push({
      accessorKey: 'price', header: () => <span className="block text-right">Τιμή λιανικής</span>, size: 130,
      cell: ({ row }) => <span className="block text-right">{fmtPrice(row.original.price)}</span>,
    });
    if (canManage) {
      base.push({
        id: 'actions', header: () => <span className="sr-only">Ενέργειες</span>, size: 90, enableSorting: false,
        cell: ({ row }) => <ItemActions row={row.original} onDone={() => router.refresh()} />,
      });
    }
    return base;
  }, [variant, canManage, router]);

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
        searchPlaceholder="Αναζήτηση (κωδικός, EAN, εργοστασίου, περιγραφή…)"
        persistKey={`admin.${variant}.table.v1`}
        toolbar={toolbar}
        pageSize={50}
      />
      {lastSync && (
        <p className="text-[length:var(--fs-11)] text-muted-foreground">
          Τελευταίος συγχρονισμός: {new Date(lastSync).toLocaleString('el-GR')}
        </p>
      )}
    </div>
  );
}
