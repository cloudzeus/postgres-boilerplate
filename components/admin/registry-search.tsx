'use client';

import * as React from 'react';
import { FiLoader, FiSearch } from 'react-icons/fi';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** Ποιο μητρώο ψάχνουμε — ίδιες τιμές με το `MatchKind` της ουράς. */
export type RegistryKind = 'product' | 'service' | 'expense';

export interface RegistryPick {
  /** MTRL για είδος/υπηρεσία, EXPN για έξοδο. */
  id: number;
  kind: RegistryKind;
  code: string;
  name: string;
}

type Result = { id: number; code: string; name: string; sub?: string; isService?: boolean };

const ENDPOINT: Record<RegistryKind, string> = {
  product: 'products',
  service: 'services',
  expense: 'expenses',
};

const PLACEHOLDER: Record<RegistryKind, string> = {
  product: 'Αναζήτηση είδους (κωδικός ή περιγραφή)…',
  service: 'Αναζήτηση υπηρεσίας (κωδικός ή περιγραφή)…',
  expense: 'Αναζήτηση εξόδου (κωδικός ή περιγραφή)…',
};

/**
 * Combobox πάνω στα τοπικά μητρώα SoftOne (είδη / υπηρεσίες / έξοδα) για την
 * ουρά «Είδη & έξοδα»: debounced αναζήτηση ≥ 2 χαρακτήρων, πλοήγηση με βέλη,
 * Enter επιλέγει, Escape κλείνει τη λίστα χωρίς να αδειάσει το πεδίο.
 */
export function RegistrySearch({
  kind,
  onPick,
  disabled,
  label = 'Άλλο είδος/έξοδο…',
  id = 'registry-search',
}: {
  kind: RegistryKind;
  onPick: (pick: RegistryPick) => void | Promise<void>;
  disabled?: boolean;
  label?: string;
  id?: string;
}) {
  const [q, setQ] = React.useState('');
  const [results, setResults] = React.useState<Result[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const listId = `${id}-list`;

  // Αλλαγή μητρώου (segmented) ⇒ τα προηγούμενα αποτελέσματα δεν ισχύουν πια.
  React.useEffect(() => { setResults([]); setOpen(false); setActive(0); }, [kind]);

  React.useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); setLoading(false); return; }
    // `ignore` ώστε μια αργή απάντηση να μην προσπεράσει μια νεότερη.
    let ignore = false;
    setLoading(true);
    const h = setTimeout(() => {
      fetch(`/api/admin/softone/search?type=${ENDPOINT[kind]}&q=${encodeURIComponent(term)}`)
        .then((r) => r.json())
        .then((d: { results?: Result[] }) => {
          if (ignore) return;
          setResults(d.results ?? []);
          setActive(0);
          setOpen(true);
        })
        .catch(() => { if (!ignore) setResults([]); })
        .finally(() => { if (!ignore) setLoading(false); });
    }, 250);
    return () => { ignore = true; clearTimeout(h); };
  }, [q, kind]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const choose = async (r: Result) => {
    setOpen(false);
    setQ('');
    setResults([]);
    await onPick({
      id: r.id,
      kind: kind === 'expense' ? 'expense' : r.isService ? 'service' : 'product',
      code: r.code,
      name: r.name,
    });
  };

  const showList = open && results.length > 0;
  const showEmpty = open && !loading && q.trim().length >= 2 && results.length === 0;

  return (
    <div className="relative" ref={rootRef}>
      <label htmlFor={id} className="text-caption font-medium text-muted-foreground">
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
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); return; }
            if (!showList) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(results.length - 1, i + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
            else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void choose(results[active]); }
          }}
          role="combobox"
          aria-expanded={showList || showEmpty}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList ? `${listId}-${active}` : undefined}
          placeholder={PLACEHOLDER[kind]}
          autoComplete="off"
          className="h-9 pl-8 pr-8 text-[13px]"
        />
        {loading && (
          <FiLoader
            aria-hidden
            className="absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground motion-reduce:animate-none"
          />
        )}
      </div>

      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Αποτελέσματα μητρώου"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-border bg-card shadow-fluent-8"
        >
          {results.map((r, i) => (
            <li key={`${r.id}-${r.code}`} role="presentation">
              <button
                type="button"
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => void choose(r)}
                className={cn(
                  'flex w-full cursor-pointer flex-col items-start gap-0.5 px-3 py-1.5 text-left',
                  'cx-transition motion-reduce:transition-none',
                  i === active ? 'bg-sisyphus-50' : 'hover:bg-[var(--cx-hover)]',
                )}
              >
                <span className="line-clamp-1 text-[13px] font-medium text-foreground">{r.name}</span>
                <span className="text-caption text-muted-foreground">
                  <span className="font-mono">{r.code}</span>
                  {r.sub ? ` · ${r.sub}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {showEmpty && (
        <p
          id={listId}
          className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-body-sm text-muted-foreground shadow-fluent-8"
        >
          Δεν βρέθηκε εγγραφή στο μητρώο.
        </p>
      )}
    </div>
  );
}
