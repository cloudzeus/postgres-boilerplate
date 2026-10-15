'use client';

// Ο ΚΑΔ της ΑΑΔΕ όπως θα γραφτεί στην καρτέλα SoftOne (κύρια → KAD, δευτερεύουσα → KAD1).
// Ο server έχει ήδη κάνει την αντιστοίχιση (`lib/kad.ts`): εδώ μόνο φαίνεται ΤΙ θα γραφτεί και
// ΓΙΑΤΙ (ίδιος κωδικός ή κατά περιγραφή), και ο χρήστης μπορεί να τον αφαιρέσει.
import * as React from 'react';
import { FiX, FiRotateCcw } from 'react-icons/fi';
import { formatAadeKad, type KadMapping } from '@/lib/kad';

export interface TraderKads { primary: KadMapping | null; secondary: KadMapping | null }
export type KadSlot = 'primary' | 'secondary';

/** Τα κλειδιά KADTAXIS που θα σταλούν (`null` = κενό), χωρίς όσα αφαίρεσε ο χρήστης. */
export function kadPayload(k: TraderKads | null | undefined, removed: ReadonlySet<KadSlot>): { kad: number | null; kad1: number | null } {
  const kad = !removed.has('primary') ? k?.primary?.row?.id ?? null : null;
  const kad1 = !removed.has('secondary') ? k?.secondary?.row?.id ?? null : null;
  return { kad, kad1: kad1 === kad ? null : kad1 };
}

function Slot({ label, m, removed, onToggle }: { label: string; m: KadMapping | null; removed: boolean; onToggle: () => void }) {
  if (!m) return null;
  return (
    <div className="min-w-0 py-0.5">
      <div className="flex min-w-0 items-start gap-1.5">
        <span className="w-[5.5rem] shrink-0 pt-px text-[length:var(--fs-11)] text-muted-foreground">{label}</span>
        <div className="min-w-0 flex-1">
          {m.row ? (
            <p className={`text-[length:var(--fs-12)] leading-snug ${removed ? 'text-muted-foreground line-through' : ''}`}>
              <span className="font-mono tabular-nums">{m.row.code}</span> {m.row.name}
              {!removed && (
                <span className={`ml-1.5 inline-block rounded px-1 text-[length:var(--fs-10)] font-medium ${m.status === 'matched'
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'}`}>
                  {m.status === 'matched' ? 'ίδιος με ΑΑΔΕ' : 'κατά περιγραφή — έλεγξε'}
                </span>
              )}
            </p>
          ) : (
            <p className="text-[length:var(--fs-12)] leading-snug text-amber-700 dark:text-amber-300">{m.note} Θα μείνει κενός.</p>
          )}
          {m.row && m.aade && (
            <p className="truncate text-[length:var(--fs-11)] text-muted-foreground" title={m.aade.descr}>
              ΑΑΔΕ: <span className="font-mono tabular-nums">{formatAadeKad(m.aade.code)}</span> {m.aade.descr}
            </p>
          )}
        </div>
        {m.row && (
          <button
            type="button" onClick={onToggle}
            className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={removed ? `Επαναφορά ${label.toLowerCase()} ΚΑΔ` : `Χωρίς ${label.toLowerCase()} ΚΑΔ`}
            title={removed ? 'Επαναφορά' : 'Να μη γραφτεί'}
          >
            {removed ? <FiRotateCcw aria-hidden className="size-3.5" /> : <FiX aria-hidden className="size-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
}

export function KadField({ kads, removed, onToggle }: { kads: TraderKads | null | undefined; removed: ReadonlySet<KadSlot>; onToggle: (s: KadSlot) => void }) {
  if (!kads || (!kads.primary && !kads.secondary)) return null;
  return (
    <div className="min-w-0">
      <Slot label="Κύρια" m={kads.primary} removed={removed.has('primary')} onToggle={() => onToggle('primary')} />
      <Slot label="Δευτερεύουσα" m={kads.secondary} removed={removed.has('secondary')} onToggle={() => onToggle('secondary')} />
    </div>
  );
}

/** Κατάσταση «αφαιρεμένων» ΚΑΔ — μηδενίζεται όταν έρθει νέα απάντηση ΑΑΔΕ. */
export function useKadRemoved(reset: unknown): [ReadonlySet<KadSlot>, (s: KadSlot) => void] {
  const [removed, setRemoved] = React.useState<ReadonlySet<KadSlot>>(new Set());
  React.useEffect(() => { setRemoved(new Set()); }, [reset]);
  const toggle = React.useCallback((s: KadSlot) => setRemoved((prev) => {
    const next = new Set(prev);
    if (next.has(s)) next.delete(s); else next.add(s);
    return next;
  }), []);
  return [removed, toggle];
}
