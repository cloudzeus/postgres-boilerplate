'use client';

import * as React from 'react';
import { FiSearch, FiX } from 'react-icons/fi';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { templatesApi } from './api';

export type SupplierPick = { id: number | null; name: string; vat: string };
type Result = { id: number; code: string; name: string; sub: string; afm: string | null };

/** SoftOne supplier lookup (≥2 chars, debounced). `value` null = no supplier linked. */
export function SupplierSearch({ value, onChange, disabled, id = 'sup' }: { value: SupplierPick | null; onChange: (v: SupplierPick | null) => void; disabled?: boolean; id?: string }) {
  const [q, setQ] = React.useState(value?.name ?? '');
  const [results, setResults] = React.useState<Result[]>([]);
  const [open, setOpen] = React.useState(false);
  const [empty, setEmpty] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const listId = `${id}-list`;
  // Seed the box from a supplier that came with the DTO. It must NOT run when `value`
  // goes null — that is the user typing over a linked supplier, and re-syncing would
  // wipe the first keystroke. The clear button resets `q` itself.
  React.useEffect(() => { if (value) setQ(value.name); }, [value]);
  React.useEffect(() => {
    if (value || q.trim().length < 2) { setResults([]); setEmpty(false); return; }
    // `ignore` so a slow in-flight search cannot land after a newer query's results.
    let ignore = false;
    const h = setTimeout(() => {
      templatesApi.searchSuppliers(q.trim())
        .then((r) => { if (!ignore) { setResults(r.results); setEmpty(r.results.length === 0); setOpen(true); } })
        .catch(() => { if (!ignore) { setResults([]); setEmpty(false); } });
    }, 250);
    return () => { ignore = true; clearTimeout(h); };
  }, [q, value]);
  // A click anywhere outside dismisses the list (the input keeps what was typed).
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (s: Result) => { onChange({ id: s.id, name: s.name, vat: s.afm ?? '' }); setResults([]); setEmpty(false); setOpen(false); };
  const showList = open && results.length > 0;
  const showEmpty = open && empty && results.length === 0;
  return (
    <div className="relative" ref={rootRef}>
      <Label htmlFor={id}>Προμηθευτής SoftOne (προαιρετικό)</Label>
      <div className="relative mt-1">
        <FiSearch className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input id={id} value={q} disabled={disabled}
          onChange={(e) => { setQ(e.target.value); setOpen(true); if (value) onChange(null); }}
          onKeyDown={(e) => { if (e.key === 'Escape' && (showList || showEmpty)) { e.stopPropagation(); setOpen(false); } }}
          role="combobox" aria-expanded={showList || showEmpty} aria-controls={listId} aria-autocomplete="list"
          placeholder="Αναζήτηση επωνυμίας / ΑΦΜ…" className="pl-8 pr-8" autoComplete="off" />
        {value && !disabled && <button type="button" aria-label="Καθαρισμός προμηθευτή" onClick={() => { onChange(null); setQ(''); setOpen(false); }} className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 cursor-pointer place-items-center rounded-sm text-muted-foreground hover:bg-[var(--cx-hover)]"><FiX className="size-3.5" /></button>}
      </div>
      {showList && (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-white shadow-fluent-8">
          {results.map((s) => (
            <li key={s.id} role="presentation"><button type="button" role="option" aria-selected={false} onClick={() => pick(s)} className="flex w-full cursor-pointer flex-col px-3 py-2 text-left hover:bg-[var(--cx-hover)]">
              <span className="text-[13px] font-medium">{s.name}</span><span className="text-[11px] text-muted-foreground">{s.sub}</span></button></li>
          ))}
        </ul>
      )}
      {showEmpty && (
        <div id={listId} className="absolute z-20 mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-[12px] text-muted-foreground shadow-fluent-8">Δεν βρέθηκαν</div>
      )}
    </div>
  );
}
