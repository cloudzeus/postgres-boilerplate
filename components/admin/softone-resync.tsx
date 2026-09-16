'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { FiRefreshCw, FiCheckCircle, FiXCircle, FiClock, FiAlertTriangle } from 'react-icons/fi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * «Συγχρονισμός όλων των βοηθητικών πινάκων».
 *
 * Η ΣΕΙΡΑ και η λογική ζουν στον server (`lib/softone/resync.ts`): εδώ ζητάμε πρώτα τη σειρά
 * (`GET`) και μετά τρέχουμε έναν πίνακα τη φορά (`POST { only: [table] }`). Έτσι ο χρήστης βλέπει
 * ΠΡΑΓΜΑΤΙΚΗ πρόοδο αντί για ένα δεκάλεπτο spinner, και καμία κλήση δεν κρατάει ανοιχτό ένα
 * αίτημα για όλους τους πίνακες μαζί. Ο client δεν αποφασίζει τίποτα — ούτε σειρά, ούτε τι κάνει
 * κάθε βήμα.
 */

export type ResyncStep = { table: string; label: string };
type Outcome = {
  table: string; label: string; ok: boolean;
  created: number; updated: number; skipped: number; error: string | null; ms: number;
};
type State = 'idle' | 'pending' | 'running' | 'ok' | 'fail';

const ENDPOINT = '/api/admin/metadata/resync-all-softone';

export function useSoftoneResync() {
  const router = useRouter();
  const [steps, setSteps] = React.useState<ResyncStep[]>([]);
  const [state, setState] = React.useState<Record<string, State>>({});
  const [results, setResults] = React.useState<Outcome[]>([]);
  const [running, setRunning] = React.useState(false);
  const [done, setDone] = React.useState(false);

  const run = React.useCallback(async (only?: string[]) => {
    setRunning(true);
    setDone(false);
    setResults([]);
    try {
      const res = await fetch(ENDPOINT);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const all: ResyncStep[] = (await res.json()).steps ?? [];
      const list = only?.length ? all.filter((s) => only.includes(s.table)) : all;
      setSteps(list);
      setState(Object.fromEntries(list.map((s) => [s.table, 'pending' as State])));

      const acc: Outcome[] = [];
      for (const step of list) {
        setState((m) => ({ ...m, [step.table]: 'running' }));
        try {
          const r = await fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ only: [step.table] }),
          });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const report = await r.json();
          const outcome: Outcome = report.results?.[0] ?? {
            table: step.table, label: step.label, ok: false,
            created: 0, updated: 0, skipped: 0, error: 'κενή απάντηση', ms: 0,
          };
          acc.push(outcome);
          setResults([...acc]);
          setState((m) => ({ ...m, [step.table]: outcome.ok ? 'ok' : 'fail' }));
        } catch (e) {
          const outcome: Outcome = {
            table: step.table, label: step.label, ok: false,
            created: 0, updated: 0, skipped: 0, error: (e as Error).message, ms: 0,
          };
          acc.push(outcome);
          setResults([...acc]);
          setState((m) => ({ ...m, [step.table]: 'fail' }));
        }
      }

      const failed = acc.filter((r) => !r.ok);
      if (failed.length === 0) toast.success(`Συγχρονίστηκαν ${acc.length} βοηθητικοί πίνακες`);
      else toast.error(`${failed.length} από ${acc.length} πίνακες απέτυχαν: ${failed.map((f) => f.label).join(', ')}`);
      setDone(true);
      router.refresh();
    } catch (e) {
      toast.error(`Αποτυχία συγχρονισμού: ${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  }, [router]);

  const reset = React.useCallback(() => {
    setSteps([]); setState({}); setResults([]); setDone(false);
  }, []);

  return { steps, state, results, running, done, run, reset };
}

const ICON: Record<State, React.ReactNode> = {
  idle: <FiClock className="h-3.5 w-3.5 text-muted-foreground/50" />,
  pending: <FiClock className="h-3.5 w-3.5 text-muted-foreground/50" />,
  running: <FiRefreshCw className="h-3.5 w-3.5 animate-spin text-sisyphus-600" />,
  ok: <FiCheckCircle className="h-3.5 w-3.5 text-emerald-600" />,
  fail: <FiXCircle className="h-3.5 w-3.5 text-destructive" />,
};

/** Η λίστα προόδου + ο τελικός απολογισμός. Δεν εμφανίζεται πριν πατηθεί το κουμπί. */
export function SoftoneResyncProgress({
  steps, state, results, done, running, onRetryFailed,
}: ReturnType<typeof useSoftoneResync> & { onRetryFailed?: () => void }) {
  if (steps.length === 0) return null;
  const byTable = new Map(results.map((r) => [r.table, r]));
  const failed = results.filter((r) => !r.ok);

  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/20 p-3">
      <ul className="grid gap-1">
        {steps.map((s) => {
          const st = state[s.table] ?? 'pending';
          const r = byTable.get(s.table);
          return (
            <li key={s.table} className="flex items-center justify-between gap-2 text-[12px]">
              <span className="inline-flex min-w-0 items-center gap-2">
                {ICON[st]}
                <span className={cn('truncate', st === 'pending' && 'text-muted-foreground')}>{s.label}</span>
              </span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                {r
                  ? r.ok
                    ? `νέα ${r.created} · ενημ. ${r.updated}${r.skipped ? ` · παράλειψη ${r.skipped}` : ''}`
                    : (r.error ?? 'σφάλμα')
                  : st === 'running' ? 'σε εξέλιξη…' : '—'}
              </span>
            </li>
          );
        })}
      </ul>

      {done && (
        <div
          className={cn(
            'mt-3 rounded-md border px-2.5 py-2 text-[12px]',
            failed.length === 0
              ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
              : 'border-destructive/30 bg-destructive/5 text-destructive',
          )}
        >
          <p className="font-semibold">
            {failed.length === 0
              ? `Ολοκληρώθηκε: ${results.length} πίνακες συγχρονίστηκαν.`
              : `Ολοκληρώθηκε με σφάλματα: ${results.length - failed.length} επιτυχίες, ${failed.length} αποτυχίες.`}
          </p>
          {failed.length > 0 && (
            <>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {failed.map((f) => (
                  <li key={f.table}><strong>{f.label}</strong>: {f.error}</li>
                ))}
              </ul>
              {onRetryFailed && (
                <Button
                  type="button" variant="secondary" size="sm" className="mt-2 h-7 text-[11px]"
                  disabled={running} onClick={onRetryFailed}
                >
                  <FiRefreshCw className="h-3 w-3" /> Επανάληψη μόνο για όσους απέτυχαν
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Το πλήρες πάνελ: κουμπί + πρόοδος. `variant="alert"` είναι η μορφή που βγαίνει στις Ρυθμίσεις
 * αμέσως μετά από αλλαγή της σύνδεσης SoftOne — με την προειδοποίηση ότι τα μητρώα περιγράφουν
 * πλέον την ΠΡΟΗΓΟΥΜΕΝΗ σύνδεση.
 */
export function SoftoneResyncPanel({
  variant = 'plain', title, description, buttonLabel = 'Συγχρονισμός όλων', disabled,
}: {
  variant?: 'plain' | 'alert';
  title?: string;
  description?: string;
  buttonLabel?: string;
  disabled?: boolean;
}) {
  const resync = useSoftoneResync();
  const failedTables = resync.results.filter((r) => !r.ok).map((r) => r.table);

  return (
    <div
      className={cn(
        variant === 'alert' && 'rounded-lg border border-amber-500/40 bg-amber-500/5 p-3',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {title && (
            <p className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
              {variant === 'alert' && <FiAlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />}
              {title}
            </p>
          )}
          {description && (
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{description}</p>
          )}
        </div>
        <Button
          type="button"
          variant={variant === 'alert' ? 'default' : 'secondary'}
          disabled={disabled || resync.running}
          onClick={() => resync.run()}
        >
          <FiRefreshCw className={cn('h-3.5 w-3.5', resync.running && 'animate-spin')} />
          {resync.running ? 'Συγχρονισμός…' : buttonLabel}
        </Button>
      </div>

      <SoftoneResyncProgress
        {...resync}
        onRetryFailed={failedTables.length ? () => resync.run(failedTables) : undefined}
      />
    </div>
  );
}
