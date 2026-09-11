'use client';

import * as React from 'react';
import { FiAlertTriangle, FiRefreshCw, FiSearch, FiX } from 'react-icons/fi';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** Ένα αποτέλεσμα από `GET /api/admin/softone/search?type=traders`. */
export interface TraderHit {
  id: number;
  code: string | null;
  name: string;
  sub: string;
  afm: string | null;
}

export interface TraderSearchProps {
  /** Καλείται όταν ο χρήστης διαλέξει συναλλασσόμενο από τη λίστα. */
  onPick: (hit: TraderHit) => void;
  id?: string;
  label?: string;
  placeholder?: string;
  /** Αρχικό κείμενο αναζήτησης (π.χ. η επωνυμία του εκδότη από το OCR). */
  initialQuery?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
}

const MIN_CHARS = 2;
const DEBOUNCE_MS = 250;

/**
 * Combobox πάνω στους συναλλασσόμενους SoftOne (SODTYPE 12 προμηθευτές + 16
 * πιστωτές) του τοπικού μητρώου. Πληκτρολόγιο: ↑/↓ μετακίνηση, Enter επιλογή,
 * Esc κλείσιμο — τα πλήκτρα της ουράς δεν ενεργοποιούνται όσο η εστίαση είναι εδώ.
 */
export function TraderSearch({
  onPick,
  id = 'trader-search',
  label = 'Αναζήτηση σε προμηθευτές & πιστωτές',
  placeholder = 'Επωνυμία, κωδικός ή ΑΦΜ…',
  initialQuery = '',
  autoFocus,
  disabled,
  className,
}: TraderSearchProps) {
  const [q, setQ] = React.useState(initialQuery);
  const [results, setResults] = React.useState<TraderHit[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [searched, setSearched] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [reload, setReload] = React.useState(0);
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const listId = `${id}-list`;

  React.useEffect(() => {
    const term = q.trim();
    if (term.length < MIN_CHARS) {
      setResults([]);
      setSearched(false);
      setFailed(false);
      setLoading(false);
      return;
    }
    // `ignore`: ένα αργό αίτημα δεν πρέπει να προσπεράσει νεότερο.
    let ignore = false;
    setLoading(true);
    const h = setTimeout(() => {
      fetch(`/api/admin/softone/search?type=traders&q=${encodeURIComponent(term)}`)
        .then(async (r) => {
          // 4xx/5xx δεν σημαίνει «κανένα αποτέλεσμα» — το δείχνουμε ως σφάλμα.
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return (await r.json()) as { results?: TraderHit[] };
        })
        .then((d) => {
          if (ignore) return;
          setResults(d.results ?? []);
          setFailed(false);
          setActive(0);
          setSearched(true);
          setOpen(true);
        })
        .catch(() => {
          if (!ignore) { setResults([]); setSearched(false); setFailed(true); setOpen(true); }
        })
        .finally(() => { if (!ignore) setLoading(false); });
    }, DEBOUNCE_MS);
    return () => { ignore = true; clearTimeout(h); };
  }, [q, reload]);

  // Κλικ εκτός: κλείνει η λίστα, το κείμενο μένει.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (hit: TraderHit) => {
    setOpen(false);
    setResults([]);
    setSearched(false);
    onPick(hit);
  };

  const showList = open && !failed && results.length > 0;
  const showError = open && failed && !loading;
  const showEmpty = open && searched && !failed && !loading && results.length === 0 && q.trim().length >= MIN_CHARS;

  return (
    <div className={cn('relative', className)} ref={rootRef}>
      <label htmlFor={id} className="text-[11px] font-medium text-muted-foreground">
        {label}
      </label>
      <div className="relative mt-1">
        <FiSearch
          aria-hidden
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id={id}
          value={q}
          disabled={disabled}
          autoFocus={autoFocus}
          autoComplete="off"
          role="combobox"
          aria-expanded={showList || showEmpty || showError}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList ? `${listId}-${active}` : undefined}
          placeholder={placeholder}
          className="h-9 pl-8 pr-8 text-[13px]"
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              if (!showList) return;
              e.preventDefault();
              setActive((a) => {
                const next = a + (e.key === 'ArrowDown' ? 1 : -1);
                return Math.min(results.length - 1, Math.max(0, next));
              });
              return;
            }
            if (e.key === 'Enter' && showList) {
              e.preventDefault();
              e.stopPropagation();
              pick(results[active]);
              return;
            }
            if (e.key === 'Escape') {
              e.stopPropagation();
              if (showList || showEmpty) setOpen(false);
              else e.currentTarget.blur();
            }
          }}
        />
        {q && !disabled && (
          <button
            type="button"
            aria-label="Καθαρισμός αναζήτησης"
            onClick={() => { setQ(''); setResults([]); setOpen(false); setSearched(false); setFailed(false); }}
            className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 cursor-pointer place-items-center rounded-sm text-muted-foreground outline-none cx-transition hover:bg-[var(--cx-hover)] focus-visible:ring-2 focus-visible:ring-sisyphus-500"
          >
            <FiX className="size-3.5" />
          </button>
        )}
      </div>

      {loading && (
        <p className="mt-1 text-[11px] text-muted-foreground" role="status">
          Αναζήτηση…
        </p>
      )}

      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Αποτελέσματα αναζήτησης"
          className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-neutral-0 shadow-fluent-8"
        >
          {results.map((r, i) => (
            <li key={r.id} role="presentation">
              <button
                type="button"
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(r)}
                className={cn(
                  'flex w-full cursor-pointer flex-col px-3 py-2 text-left outline-none cx-transition',
                  i === active ? 'bg-sisyphus-50' : 'hover:bg-[var(--cx-hover)]',
                )}
              >
                <span className="text-[13px] font-medium text-foreground">{r.name}</span>
                <span className="text-[11px] text-muted-foreground">
                  {[r.code, r.sub].filter(Boolean).join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {showError && (
        <div
          id={listId}
          role="status"
          className="absolute z-20 mt-1 flex w-full items-center gap-2 rounded-md border border-border bg-neutral-0 px-3 py-2 text-[12px] text-muted-foreground shadow-fluent-8"
        >
          <FiAlertTriangle aria-hidden className="size-3.5 shrink-0 text-warning-500" />
          <span>Σφάλμα φόρτωσης</span>
          <button
            type="button"
            onClick={() => { setFailed(false); setReload((n) => n + 1); }}
            className="ml-auto inline-flex cursor-pointer items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-medium text-sisyphus-700 outline-none hover:bg-[var(--cx-hover)] focus-visible:ring-2 focus-visible:ring-sisyphus-500"
          >
            <FiRefreshCw aria-hidden className="size-3" /> Δοκίμασε ξανά
          </button>
        </div>
      )}

      {showEmpty && (
        <div
          id={listId}
          role="status"
          className="absolute z-20 mt-1 w-full rounded-md border border-border bg-neutral-0 px-3 py-2 text-[12px] text-muted-foreground shadow-fluent-8"
        >
          Δεν βρέθηκε συναλλασσόμενος.
        </div>
      )}
    </div>
  );
}
