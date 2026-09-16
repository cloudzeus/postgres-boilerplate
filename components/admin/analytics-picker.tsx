'use client';

import * as React from 'react';
import { FiAlertTriangle, FiLoader, FiSearch, FiX } from 'react-icons/fi';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Ένα combobox για ένα πεδίο της ΑΝΑΛΥΤΙΚΗΣ μιας γραμμής: κέντρο κόστους, έργο ή κατηγορία
 * δραστηριότητας. Αναζήτηση σε κωδικό και περιγραφή, καθαρισμός με ένα κλικ, και ρητή ένδειξη
 * όταν η τιμή είναι ΠΡΟΤΑΣΗ (μνήμη ή AI) και όχι κάτι που έγραψε ο χρήστης.
 *
 * Όλα τα πεδία είναι ΠΡΟΑΙΡΕΤΙΚΑ στο SoftOne: κενό δεν εμποδίζει ποτέ καταχώριση.
 */
export type AnalyticsKind = 'costcenters' | 'projects' | 'projectstages';

export interface AnalyticsValue {
  id: number | null;
  label: string | null;
  /** Από πού ήρθε η τιμή — `manual` = την επέλεξε ο χρήστης. */
  source: 'manual' | 'memory' | 'ai' | null;
}

type Result = { id: number; code: string; name: string; sub?: string };

const SOURCE_LABEL: Record<'memory' | 'ai', string> = {
  memory: 'από μνήμη — έλεγξέ το',
  ai: 'πρόταση AI — έλεγξέ το',
};

export function AnalyticsPicker({
  kind,
  label,
  value,
  onChange,
  disabled,
  id,
  trdr,
  scopeAll,
  onScopeAll,
  note,
}: {
  kind: AnalyticsKind;
  label: string;
  value: AnalyticsValue;
  onChange: (v: AnalyticsValue) => void;
  disabled?: boolean;
  id: string;
  /** Μόνο για έργα: ο TRDR του εκδότη, ώστε να δείχνουμε πρώτα τα δικά του. */
  trdr?: number | null;
  scopeAll?: boolean;
  onScopeAll?: (v: boolean) => void;
  /** Επεξήγηση κάτω από το πεδίο (π.χ. γιατί είναι ανενεργό). */
  note?: string;
}) {
  const [q, setQ] = React.useState('');
  const [results, setResults] = React.useState<Result[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const listId = `${id}-list`;

  React.useEffect(() => { setResults([]); setOpen(false); setActive(0); setFailed(false); }, [kind, trdr, scopeAll]);

  React.useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); setLoading(false); setFailed(false); return; }
    let ignore = false;
    setLoading(true);
    const h = setTimeout(() => {
      const extra = kind === 'projects'
        ? `${trdr && !scopeAll ? `&trdr=${trdr}` : ''}${scopeAll ? '&scope=all' : ''}`
        : '';
      fetch(`/api/admin/softone/search?type=${kind}&q=${encodeURIComponent(term)}${extra}`)
        .then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return (await r.json()) as { results?: Result[] };
        })
        .then((d) => {
          if (ignore) return;
          setResults(d.results ?? []);
          setFailed(false);
          setActive(0);
          setOpen(true);
        })
        .catch(() => { if (!ignore) { setResults([]); setFailed(true); setOpen(true); } })
        .finally(() => { if (!ignore) setLoading(false); });
    }, 250);
    return () => { ignore = true; clearTimeout(h); };
  }, [q, kind, trdr, scopeAll]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const choose = (r: Result) => {
    setOpen(false);
    setQ('');
    setResults([]);
    onChange({ id: r.id, label: `${r.code} — ${r.name}`, source: 'manual' });
  };

  const showList = open && !failed && results.length > 0;
  const suggested = value.id != null && value.source && value.source !== 'manual';

  return (
    <div className="relative" ref={rootRef}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-caption font-medium text-muted-foreground">{label}</label>
        {kind === 'projects' && trdr != null && onScopeAll && (
          <button
            type="button"
            onClick={() => onScopeAll(!scopeAll)}
            className="cursor-pointer text-caption text-sisyphus-700 hover:underline"
          >
            {scopeAll ? 'Μόνο του εκδότη' : 'Όλα τα έργα'}
          </button>
        )}
      </div>

      {value.id != null ? (
        <div className="mt-1 flex items-center gap-1.5 rounded-lg border border-input bg-background px-2.5 py-1.5">
          <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{value.label ?? value.id}</span>
          {suggested && (
            <span className="shrink-0 text-caption" style={{ color: '#B45309' }}>
              {SOURCE_LABEL[value.source as 'memory' | 'ai']}
            </span>
          )}
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange({ id: null, label: null, source: 'manual' })}
            aria-label={`Καθαρισμός: ${label}`}
            className="shrink-0 cursor-pointer rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <FiX className="size-3.5" aria-hidden />
          </button>
        </div>
      ) : (
        <div className="relative mt-1">
          <FiSearch aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={id}
            value={q}
            disabled={disabled}
            onChange={(e) => { setQ(e.target.value); setOpen(true); }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); return; }
              if (!showList) return;
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(results.length - 1, i + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
              else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); choose(results[active]); }
            }}
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            placeholder={`Αναζήτηση: ${label.toLowerCase()}…`}
            autoComplete="off"
            className="h-9 pl-8 pr-8 text-[13px]"
          />
          {loading && (
            <FiLoader aria-hidden className="absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground motion-reduce:animate-none" />
          )}
        </div>
      )}

      {note && <p className="mt-1 text-caption text-muted-foreground">{note}</p>}

      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-border bg-card shadow-fluent-8"
        >
          {results.map((r, i) => (
            <li key={r.id} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(r)}
                className={cn(
                  'flex w-full cursor-pointer flex-col items-start gap-0.5 px-3 py-1.5 text-left',
                  i === active ? 'bg-sisyphus-50' : 'hover:bg-[var(--cx-hover)]',
                )}
              >
                <span className="line-clamp-1 text-[13px] font-medium text-foreground">{r.name}</span>
                <span className="text-caption text-muted-foreground">
                  <span className="font-mono">{r.code}</span>{r.sub ? ` · ${r.sub}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && failed && !loading && (
        <p id={listId} role="status" className="absolute z-20 mt-1 flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-body-sm text-muted-foreground shadow-fluent-8">
          <FiAlertTriangle aria-hidden className="size-3.5 shrink-0 text-warning-500" /> Σφάλμα φόρτωσης
        </p>
      )}

      {open && !failed && !loading && q.trim().length >= 2 && results.length === 0 && (
        <p id={listId} className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-body-sm text-muted-foreground shadow-fluent-8">
          Δεν βρέθηκε εγγραφή στο μητρώο.
        </p>
      )}
    </div>
  );
}
