'use client';

import * as React from 'react';
import Link from 'next/link';
import { FiArrowRight, FiLoader, FiCheckCircle } from 'react-icons/fi';
import { blockerAction, sortBlockers, tallyBlockers } from '@/lib/ocr/blocker-actions';
import type { BlockerCode } from '@/lib/ocr/purdoc-payload';

export interface PendingDoc {
  id: string;
  fileName: string;
  issuer: string | null;
  docNumber: string | null;
  createdAt: string;
  statusLabel: string;
}

/**
 * Τα ΠΡΑΓΜΑΤΙΚΑ εμπόδια κάθε εκκρεμούς παραστατικού, από την ΙΔΙΑ προεπισκόπηση που κρίνει το
 * κουμπί «Καταχώριση».
 *
 * Γιατί από τον client: το `postingPreview` φορτώνει ολόκληρο το λογιστικό σχέδιο (5.203 γραμμές)
 * σε κάθε κλήση. Τριάντα κλήσεις σε server component θα κρατούσαν τη σελίδα κλειστή για δευτερόλεπτα.
 * Έτσι η λίστα εμφανίζεται αμέσως και τα εμπόδια συμπληρώνονται καθώς έρχονται, με φραγμό
 * ταυτόχρονων ώστε να μην πνιγεί ο server.
 */
const CONCURRENCY = 4;

type State = Record<string, BlockerCode[] | 'φόρτωση' | 'σφάλμα'>;

export function PendingBlockers({ docs }: { docs: PendingDoc[] }) {
  const [state, setState] = React.useState<State>(() =>
    Object.fromEntries(docs.map((d) => [d.id, 'φόρτωση' as const])));

  React.useEffect(() => {
    let alive = true;
    const queue = [...docs];
    async function worker() {
      while (alive) {
        const d = queue.shift();
        if (!d) return;
        try {
          const r = await fetch(`/api/admin/ocr/${d.id}/post-softone?dryRun=1`);
          const j = r.ok ? await r.json() : null;
          const codes: BlockerCode[] = j ? (j.blockers ?? []).map((b: { code: BlockerCode }) => b.code) : [];
          if (alive) setState((s) => ({ ...s, [d.id]: r.ok ? codes : 'σφάλμα' }));
        } catch {
          if (alive) setState((s) => ({ ...s, [d.id]: 'σφάλμα' }));
        }
      }
    }
    void Promise.all(Array.from({ length: Math.min(CONCURRENCY, docs.length) }, worker));
    return () => { alive = false; };
  }, [docs]);

  const resolved = docs.map((d) => state[d.id]).filter((v): v is BlockerCode[] => Array.isArray(v));
  const tally = tallyBlockers(resolved);
  const pendingCount = docs.length - resolved.length;

  return (
    <div className="space-y-4">
      {/* ── Τι εμποδίζει, συγκεντρωτικά ─────────────────────────────────────── */}
      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-fluent-2">
        <header className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
          <span className="text-[length:var(--fs-13)] font-semibold text-foreground">Τι εμποδίζει την καταχώριση</span>
          {pendingCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[length:var(--fs-11)] text-muted-foreground">
              <FiLoader className="size-3 animate-spin" /> έλεγχος {resolved.length}/{docs.length}
            </span>
          )}
        </header>
        {tally.length === 0 && pendingCount === 0 ? (
          <p className="flex items-center gap-2 px-4 py-4 text-[length:var(--fs-12)] text-emerald-700">
            <FiCheckCircle className="size-4" /> Κανένα εμπόδιο — όλα μπορούν να καταχωρηθούν.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {tally.map(({ code, docs: n }) => {
              const a = blockerAction(code);
              return (
                <li key={code} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2">
                  <span className="inline-flex min-w-[10rem] items-baseline gap-2">
                    <span className="inline-flex min-w-[2rem] justify-end text-[length:var(--fs-13)] font-bold tabular-nums text-foreground">{n}</span>
                    <span className="text-[length:var(--fs-12)] font-semibold text-foreground">{a.short}</span>
                  </span>
                  <span className="min-w-0 flex-1 text-[length:var(--fs-12)] text-muted-foreground">{a.fix}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Ανά παραστατικό ─────────────────────────────────────────────────── */}
      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-fluent-2">
        <ul className="divide-y divide-border">
          {docs.map((d) => {
            const v = state[d.id];
            return (
              <li key={d.id} className="px-4 py-2.5 hover:bg-muted/40">
                <Link href={`/admin/ocr/${d.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="min-w-0 flex-1 truncate text-[length:var(--fs-12)] font-medium text-foreground">{d.fileName}</span>
                  <span className="hidden min-w-0 flex-1 truncate text-[length:var(--fs-12)] text-muted-foreground sm:block">{d.issuer ?? '—'}</span>
                  <span className="hidden font-mono text-[length:var(--fs-11)] text-muted-foreground md:block">{d.docNumber ?? '—'}</span>
                  <span className="shrink-0 text-[length:var(--fs-11)] tabular-nums text-muted-foreground">{d.createdAt}</span>
                  <FiArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {v === 'φόρτωση' && <span className="text-[length:var(--fs-11)] text-muted-foreground">έλεγχος…</span>}
                  {v === 'σφάλμα' && <span className="text-[length:var(--fs-11)] text-destructive">ο έλεγχος απέτυχε</span>}
                  {Array.isArray(v) && v.length === 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[length:var(--fs-11)] font-semibold text-emerald-700 dark:text-emerald-300">
                      <FiCheckCircle className="size-3" /> έτοιμο για καταχώριση
                    </span>
                  )}
                  {Array.isArray(v) && sortBlockers(v).map((code) => {
                    const a = blockerAction(code);
                    return (
                      <Link
                        key={code}
                        href={a.anchor.startsWith('/') ? a.anchor : `/admin/ocr/${d.id}${a.anchor}`}
                        title={a.fix}
                        className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[length:var(--fs-11)] font-semibold text-amber-700 transition hover:bg-amber-500/20 dark:text-amber-300"
                      >
                        {a.short}
                      </Link>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
