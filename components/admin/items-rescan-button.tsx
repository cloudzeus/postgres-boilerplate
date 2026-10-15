'use client';

// «Επανέλεγχος στο SoftOne»: για είδη που καταχωρήθηκαν στη SoftOne ΑΦΟΥ τα ψάξαμε και δεν τα βρήκαμε.
// Φέρνει μόνο τα νέα/αλλαγμένα είδη και ξαναψάχνει ΜΟΝΟ τις γραμμές χωρίς είδος (βλ.
// `lib/softone-sync/items-rescan.ts`). Ό,τι έχει ήδη αντιστοιχιστεί δεν αλλάζει.
import * as React from 'react';
import { FiLoader, FiRefreshCw } from 'react-icons/fi';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

export function ItemsRescanButton({ docId, onDone, className, label = 'Επανέλεγχος στο SoftOne' }: {
  /** Χωρίς `docId` ⇒ όλες οι γραμμές χωρίς είδος, σε όλα τα μη καταχωρισμένα παραστατικά. */
  docId?: string;
  onDone?: (matched: number) => void;
  className?: string;
  label?: string;
}) {
  const [busy, setBusy] = React.useState(false);
  const router = useRouter();
  const run = async () => {
    if (busy) return;
    setBusy(true);
    const id = toast.loading('Αναζήτηση νέων ειδών στο SoftOne…');
    try {
      const res = await fetch('/api/admin/ocr/items-rescan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(docId ? { docId } : {}),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) {
        toast.error(d?.message ?? 'Ο επανέλεγχος απέτυχε.', { id });
        return;
      }
      const { pull, rematch } = d as { pull: { added: number; updated: number }; rematch: { checked: number; matched: number; docs: number } };
      const fresh = pull.added + pull.updated;
      const head = rematch.matched > 0
        ? `Βρέθηκε είδος για ${rematch.matched} από ${rematch.checked} γραμμές`
        : rematch.checked > 0 ? `Καμία από τις ${rematch.checked} γραμμές δεν βρήκε ακόμη είδος` : 'Δεν υπάρχουν γραμμές χωρίς είδος';
      const tail = fresh > 0 ? `Από το SoftOne: ${pull.added} νέα, ${pull.updated} αλλαγμένα είδη.` : 'Κανένα νέο ή αλλαγμένο είδος στο SoftOne.';
      (rematch.matched > 0 ? toast.success : toast.info)(head, { id, description: tail });
      // Χωρίς δικό του χειρισμό (σελίδα server component): ανανέωση της σελίδας όταν βρέθηκε κάτι.
      if (onDone) onDone(rematch.matched);
      else if (rematch.matched > 0) router.refresh();
    } catch {
      toast.error('Σφάλμα δικτύου.', { id });
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button" onClick={() => void run()} disabled={busy} aria-busy={busy || undefined}
      title="Ξαναψάχνει στο SoftOne είδη που καταχωρήθηκαν στο μεταξύ — μόνο για γραμμές χωρίς είδος"
      className={cn('inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[length:var(--fs-12)] font-medium text-foreground transition hover:bg-muted disabled:cursor-wait disabled:opacity-70', className)}
    >
      {busy ? <FiLoader aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" /> : <FiRefreshCw aria-hidden className="size-3.5" />}
      {busy ? 'Επανέλεγχος…' : label}
    </button>
  );
}
