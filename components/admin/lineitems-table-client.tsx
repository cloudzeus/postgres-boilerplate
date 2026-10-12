'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { type ColumnDef } from '@tanstack/react-table';
import { FiRefreshCw, FiCheck, FiSlash, FiAlertTriangle, FiArchive, FiSearch } from 'react-icons/fi';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { InactiveLineItem } from '@/lib/softone-sync/lineitem-activate';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { syncErrorMessage } from '@/lib/softone-sync/sync-error';
import type { AccountCheckLine } from '@/lib/ocr/account-check';
import { AccountLine } from '@/components/admin/account-line';

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
  /** Ο λογαριασμός γενικής (ACNMSK) όπως τον βλέπει ο έλεγχος πριν την καταχώριση. */
  account: AccountCheckLine | null;
  /** Κείμενο του λογαριασμού για αναζήτηση/ταξινόμηση («61.02.00.0024 Προμήθειες…»). */
  accountText: string;
};

const DASH = <span className="text-muted-foreground/40">—</span>;

/**
 * Οι ΑΝΕΝΕΡΓΕΣ χρεοπιστώσεις του SoftOne. Ο συγχρονισμός (GetTable) δεν τις φέρνει, οπότε χωρίς
 * αυτό η εφαρμογή πρότεινε νέες με κωδικό που ήδη υπήρχε. Εδώ φαίνονται από τη λίστα του SoftOne
 * και ενεργοποιούνται — προαιρετικά και για παραστατικά πιστωτών.
 */
function InactiveLineItems({ open, onClose, onActivated }: { open: boolean; onClose: () => void; onActivated: () => void }) {
  const [items, setItems] = React.useState<InactiveLineItem[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [q, setQ] = React.useState('');
  const [creditors, setCreditors] = React.useState(true);
  const [busy, setBusy] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!open || items) return;
    fetch('/api/admin/softone/lineitems/inactive', { cache: 'no-store' })
      .then(async (r) => { const d = await r.json(); if (r.ok) setItems(d.items); else setError(d.message ?? 'Η ανάγνωση απέτυχε.'); })
      .catch(() => setError('Σφάλμα δικτύου.'));
  }, [open, items]);

  const activate = async (it: InactiveLineItem) => {
    setBusy(it.mtrl);
    try {
      const r = await fetch(`/api/admin/softone/lineitems/${it.mtrl}/activate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allowCreditors: creditors }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d.message ?? 'Η ενεργοποίηση απέτυχε.'); return; }
      toast.success(`Ενεργοποιήθηκε ${d.code}${d.creditorsAdded ? ' — δέχεται πλέον και πιστωτές' : ''}.`);
      setItems((list) => (list ?? []).filter((x) => x.mtrl !== it.mtrl));
      onActivated();
    } catch {
      toast.error('Σφάλμα δικτύου — έλεγξε στο SoftOne πριν ξαναπροσπαθήσεις.');
    } finally { setBusy(null); }
  };

  const nq = q.trim().toLowerCase();
  const shown = (items ?? []).filter((it) => !nq || it.code.toLowerCase().includes(nq) || it.name.toLowerCase().includes(nq) || (it.acnmsk ?? '').includes(nq));
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && busy == null) onClose(); }}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Ανενεργές χρεοπιστώσεις στο SoftOne{items ? ` · ${items.length}` : ''}</DialogTitle>
          <DialogDescription>Υπάρχουν στο SoftOne αλλά δεν χρησιμοποιούνται. Ενεργοποίησε όποια χρειάζεσαι αντί να φτιάξεις νέα με τον ίδιο λογαριασμό.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative flex-1">
            <span className="sr-only">Αναζήτηση</span>
            <FiSearch className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Κωδικός, περιγραφή ή λογαριασμός"
              className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-[length:var(--fs-13)]" />
          </label>
          <label className="inline-flex min-h-9 items-center gap-2 text-[length:var(--fs-12)] text-foreground">
            <input type="checkbox" checked={creditors} onChange={(e) => setCreditors(e.target.checked)} className="size-4 rounded border-input" />
            Να δέχεται και παραστατικά πιστωτών
          </label>
        </div>
        <div className="max-h-[55vh] overflow-auto rounded-md border border-border">
          {error ? <p className="p-4 text-[length:var(--fs-12)] text-destructive">{error}</p>
            : !items ? <p className="p-4 text-[length:var(--fs-12)] text-muted-foreground">Ανάγνωση από το SoftOne…</p>
              : shown.length === 0 ? <p className="p-4 text-[length:var(--fs-12)] text-muted-foreground">Καμία δεν ταιριάζει.</p>
                : (
                  <ul className="divide-y divide-border">
                    {shown.slice(0, 200).map((it) => (
                      <li key={it.mtrl} className="flex items-center justify-between gap-3 px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-[length:var(--fs-12)] font-semibold text-foreground">
                            <span className="font-mono">{it.code}</span> · {it.name}
                          </p>
                          <p className="text-[length:var(--fs-11)] text-muted-foreground">
                            Λογ. {it.acnmsk ?? '—'} · {it.vat ?? 'χωρίς ΦΠΑ'} · {it.acceptsCreditors ? 'δέχεται πιστωτές' : 'όχι πιστωτές'}
                          </p>
                        </div>
                        <Button size="sm" variant="secondary" onClick={() => activate(it)} disabled={busy != null}>
                          {busy === it.mtrl ? 'Ενεργοποίηση…' : 'Ενεργοποίηση'}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

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
      cell: ({ row }) => <span className="font-mono text-[length:var(--fs-12)] tabular-nums text-foreground">{row.original.code || '—'}</span>,
    },
    {
      accessorKey: 'name', header: 'Περιγραφή', size: 340,
      cell: ({ row }) => <span className="text-[length:var(--fs-12)] font-medium text-foreground">{row.original.name || '—'}</span>,
    },
    {
      // Ο λογαριασμός ΜΕ το όνομά του στο λογιστικό σχέδιο: ο λογιστής βλέπει εδώ, για όλες τις
      // χρεοπιστώσεις μαζί, ποια δείχνει σε λογαριασμό που δεν υπάρχει ή που σημαίνει κάτι άλλο.
      accessorKey: 'accountText', header: 'Λογαριασμός γενικής', size: 320,
      cell: ({ row }) => (row.original.account ? <AccountLine line={row.original.account} compact /> : DASH),
    },
    {
      accessorKey: 'category', header: 'Κατηγορία δαπάνης', size: 220,
      cell: ({ row }) => (row.original.category
        ? <span className="text-[length:var(--fs-12)] text-foreground/80">{row.original.category}</span>
        : DASH),
    },
    {
      accessorKey: 'myData', header: 'Χαρακτηρισμός myDATA', size: 260,
      // Μια χρεοπίστωση χωρίς χαρακτηρισμό θα καταχωρίσει αχαρακτήριστη γραμμή: το λέμε ρητά,
      // με εικονίδιο και κείμενο (ποτέ μόνο χρώμα). Η διόρθωση γίνεται στο ίδιο το SoftOne.
      cell: ({ row }) => (row.original.myData
        ? <span className="text-[length:var(--fs-12)]" style={{ color: '#047857' }}>{row.original.myData}</span>
        : (
          <span className="inline-flex items-center gap-1 text-[length:var(--fs-12)]" style={{ color: '#B45309' }}>
            <FiAlertTriangle className="h-3.5 w-3.5" aria-hidden /> Κανένας
          </span>
        )),
    },
    {
      accessorKey: 'vat', header: 'ΦΠΑ', size: 80,
      cell: ({ row }) => (row.original.vat
        ? <span className="font-mono text-[length:var(--fs-12)] tabular-nums text-muted-foreground">{row.original.vat}</span>
        : DASH),
    },
    {
      accessorKey: 'isActive', header: 'Ενεργή', size: 100,
      cell: ({ row }) => (row.original.isActive ? (
        <span className="inline-flex items-center gap-1 text-[length:var(--fs-12)]" style={{ color: '#047857' }}>
          <FiCheck className="h-3.5 w-3.5" aria-hidden /> Ναι
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-[length:var(--fs-12)] text-muted-foreground">
          <FiSlash className="h-3.5 w-3.5" aria-hidden /> Όχι
        </span>
      )),
    },
  ], []);

  const [inactiveOpen, setInactiveOpen] = React.useState(false);
  const toolbar = canManage ? (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={() => setInactiveOpen(true)}>
        <FiArchive className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Ανενεργές στο SoftOne
      </Button>
      <Button variant="secondary" size="sm" onClick={sync} disabled={busy}>
        <FiRefreshCw className={cn('mr-1.5 h-3.5 w-3.5', busy && 'animate-spin')} />
        {busy ? 'Συγχρονισμός…' : 'Συγχρονισμός από SoftOne'}
      </Button>
    </div>
  ) : undefined;

  return (
    <div className="space-y-2">
      {canManage && <InactiveLineItems open={inactiveOpen} onClose={() => setInactiveOpen(false)} onActivated={() => router.refresh()} />}
      <p className="text-[length:var(--fs-12)] text-muted-foreground">
        Οι χρεοπιστώσεις είναι ό,τι δέχεται μια γραμμή «Ειδικών συναλλαγών» (LINLINES) — εκεί
        καταχωρούνται τα τιμολόγια δαπανών. Ο χαρακτηρισμός myDATA ανήκει στο μητρώο του SoftOne·
        η εφαρμογή τον δείχνει, δεν τον αλλάζει.
      </p>
      <DataTable
        /* ΣΕΙΡΑ ΘΥΣΙΑΣ: πρώτη η λιγότερο χρήσιμη. Κρύβονται όσες χρειαστεί ώστε ο πίνακας να
           ΧΩΡΑΕΙ — ποτέ οριζόντιο scroll. Το «Στήλες» υπερισχύει. */
        growColumnId="name"
        responsiveHide={['myData', 'category', 'vat']}
        columns={columns}
        data={rows}
        searchKey="name"
        searchPlaceholder="Αναζήτηση (κωδικός, περιγραφή…)"
        persistKey="admin.lineitems.table.v1"
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
