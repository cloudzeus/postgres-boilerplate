'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FiLink, FiRefreshCw } from 'react-icons/fi';
import { StatCard } from '@/components/admin/stat-card';
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
    <StatCard
      label="Αντιστοίχιση" value={pct} unit="%" icon={<FiLink />} tone="emerald" progress={pct}
      sub={<>{coverage.matched}/{coverage.total} γραμμές · {coverage.docsComplete}/{coverage.docs} παραστατικά πλήρη</>}
      aside={canRematch ? (
        <button
          type="button" onClick={rematch} disabled={busy}
          title="Επανεφαρμογή μνήμης: ό,τι έχει μάθει η εφαρμογή, σε όλα τα ανοιχτά παραστατικά"
          aria-label="Επανεφαρμογή μνήμης"
          className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
        >
          <FiRefreshCw className={`size-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden />
        </button>
      ) : undefined}
    />
  );
}
