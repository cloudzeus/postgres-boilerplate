'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FiRefreshCw } from 'react-icons/fi';
import type { LineCoverage } from '@/lib/ocr/coverage';

/**
 * Η ΚΑΛΥΨΗ ΤΗΣ ΑΝΤΙΣΤΟΙΧΙΣΗΣ — πόσες γραμμές ανοιχτών παραστατικών έχουν ήδη στόχο — μαζί με την
 * «Επανεφαρμογή μνήμης»: ό,τι έμαθε η εφαρμογή (κείμενα, είδη χρέωσης, οικογένειες δαπάνης)
 * εφαρμόζεται ξανά σε όλα τα ανοιχτά παραστατικά, με ένα πάτημα.
 */
export function MatchCoverage({ coverage, canRematch }: { coverage: LineCoverage; canRematch: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const pct = coverage.total ? Math.round((coverage.matched / coverage.total) * 100) : 0;

  const rematch = async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/admin/ocr/rematch-all', { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d.message ?? 'Η επανεφαρμογή απέτυχε.'); return; }
      toast.success(d.filled ? `Συμπληρώθηκαν ${d.filled} γραμμές από τη μνήμη (${d.docs} παραστατικά).` : 'Καμία νέα γραμμή — η μνήμη είχε ήδη εφαρμοστεί.');
      router.refresh();
    } catch {
      toast.error('Σφάλμα δικτύου.');
    } finally { setBusy(false); }
  };

  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-card px-4 py-3 shadow-fluent-2">
      <span className="absolute left-0 top-0 h-full w-1 bg-emerald-500" />
      <div className="flex items-start justify-between gap-2">
        <p className="text-[length:var(--fs-10)] font-bold uppercase tracking-wider text-muted-foreground">Αντιστοίχιση γραμμών</p>
        {canRematch && (
          <button
            type="button" onClick={rematch} disabled={busy}
            title="Εφαρμόζει ξανά ό,τι έχει μάθει η εφαρμογή σε όλα τα ανοιχτά παραστατικά"
            aria-label="Επανεφαρμογή μνήμης"
            className="-mr-1 -mt-1 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
          >
            <FiRefreshCw className={`size-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden />
          </button>
        )}
      </div>
      <p className="mt-0.5 text-title-2 font-bold tabular-nums tracking-tight text-foreground">{pct}%</p>
      <p className="text-[length:var(--fs-11)] tabular-nums text-muted-foreground">
        {coverage.matched}/{coverage.total} γραμμές · {coverage.docsComplete}/{coverage.docs} παραστατικά πλήρη
      </p>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
